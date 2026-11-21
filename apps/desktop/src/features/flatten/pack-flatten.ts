/**
 * 「把多个图片图层合并成一张」的系列级编排（纯编排，不含像素合成与 IO）。
 *
 * 两段式，因为中间挡着一个 `await`：
 * - {@link planFlatten}：扫全系列，挑出可合并的分组，逐组交给注入的 `compose` 合成，
 *   产出一份计划。**只读入系列、不改动它**——合成期间系列还在被用户编辑。
 * - {@link applyFlatten}：把计划套到一个草稿上（调用方在 `commit` 里传入深拷贝草稿）。
 *
 * 判定「哪些层能合」的算子在 `flatten.ts`；这里只负责把它们串到卡面 / 背面/ 隐藏款上。
 */
import {
  DEFAULT_BUMP_LIGHT_ANGLE,
  DEFAULT_BUMP_LIGHT_COLOR,
  createLayer,
  newId,
  resolveImage,
  type CardFace,
  type Layer,
  type Pack,
} from "@prismwright/schema"
import type { FaceRef } from "../../store/packStore"
import { findFlattenGroups, groupFingerprint, imageEffectPath } from "./flatten"

/**
 * 一个合成器：把一组图层（按绘制顺序）烤成一张 PNG，返回它在系列内的相对路径。
 *
 * 注入而非内置，是为了让本模块保持纯逻辑：真实实现要读文件、开画布、写 PNG（见
 * `compose.ts`），测试里换成假实现即可。
 */
export type Compose = (layers: readonly Layer[], aspect: number) => Promise<string>

/** 一处合并：某个卡面上的一组图层换成一层新图层。 */
export interface FlattenOp {
  /** 目标卡面。 */
  face: FaceRef
  /** 被替换掉的图层 id，按绘制顺序。 */
  layerIds: string[]
  /** 取而代之的新图层（尚未插入任何卡面）。 */
  layer: Layer
  /** 被合并那一组的指纹（见 `groupFingerprint`），供调用方记住「这组刚合过」。 */
  fingerprint: string
}

/** 待套用的合并计划。 */
export interface FlattenPlan {
  ops: FlattenOp[]
  /** 被取代的原图相对路径（去重）。落盘后由调用方核对是否还被别处引用。 */
  superseded: string[]
}

/** 遍历全系列的卡面：普通卡 → 隐藏款 → 背面（背面不存在时跳过）。 */
function* eachFace(pack: Pack): Generator<{ ref: FaceRef; face: CardFace }> {
  for (const card of pack.cards) {
    yield { ref: { kind: "card", cardId: card.id }, face: card }
  }
  for (const card of pack.hiddenCards) {
    yield { ref: { kind: "card", cardId: card.id }, face: card }
  }
  if (pack.back) yield { ref: { kind: "back" }, face: pack.back }
}

/** 卡面引用 → 查找键（与 `faceKey` 同构；此处不引 store 的运行时值，保持纯函数）。 */
function refKey(ref: FaceRef): string {
  return ref.kind === "back" ? "back" : `card:${ref.cardId}`
}

/**
 * 扫全系列，算出一次合并计划。
 *
 * 逐卡面找出可合并的分组，把每组交给 `compose` 合成一张图；新图层沿用组内第一层的名字
 * 与混合模式，效果只剩那条图片效果（其余效果本来就不在可合并的判据里）。
 *
 * 新图层的 `opacity` 回到 1：各层原来的不透明度在合成时已经乘进像素，这里再乘一次会淡。
 *
 * @param pack - 当前系列（不会被修改）。
 * @param compose - 合成器；抛错则整次计划失败并向上冒泡（调用方据此放弃合并，不影响保存）。
 * @param skip - 跳过这些指纹的组（「这组刚合过、用户又撤销回来了」，见 `groupFingerprint`）。
 * @returns 合并计划；没有任何可合并的组时返回 `null`。
 */
export async function planFlatten(
  pack: Pack,
  compose: Compose,
  skip: ReadonlySet<string> = new Set(),
): Promise<FlattenPlan | null> {
  const ops: FlattenOp[] = []
  const superseded = new Set<string>()

  for (const { ref, face } of eachFace(pack)) {
    for (const group of findFlattenGroups(face.layers)) {
      const layers = group.map((i) => face.layers[i])
      const fingerprint = groupFingerprint(layers)
      if (skip.has(fingerprint)) continue
      const path = await compose(layers, pack.aspect)

      const first = layers[0]
      const layer = createLayer(first.name)
      layer.blend = first.blend
      layer.effects = [
        {
          id: newId(),
          enabled: true,
          kind: "image",
          params: {
            path,
            x: 0,
            y: 0,
            rotation: 0,
            scale: 1,
            fit: "stretch",
            followFront: false,
            // 平铺出来的图是逐像素快照，不再生成法线：卡面法线仍会从卡面图继承到它上面。
            bumpStrength: 0,
            bumpDetail: 0.01,
            bumpFlow: 0.5,
            bumpLight: 1,
            bumpLightAngle: DEFAULT_BUMP_LIGHT_ANGLE,
            bumpLightColor: DEFAULT_BUMP_LIGHT_COLOR,
            bumpInvert: false,
            normalPath: "",
            normalFlipY: false,
          },
        },
      ]

      ops.push({ face: ref, layerIds: layers.map((l) => l.id), layer, fingerprint })
      for (const l of layers) {
        const rel = imageEffectPath(l)
        if (rel) superseded.add(rel)
        // 各层自己的法线贴图随之失效，一并交给回收站候选（真正的删除仍要过引用核对）。
        const normalRel = resolveImage(l.effects)?.normalPath
        if (normalRel) superseded.add(normalRel)
      }
    }
  }

  return ops.length > 0 ? { ops, superseded: [...superseded] } : null
}

/**
 * 把计划套用到一份系列草稿上（就地改写，调用方负责传入可改的草稿）。
 *
 * 新图层落在被替换的那组所占的**第一个位置**：它取代的正是这一段的叠放顺序，插回别处
 * 会改变它和相邻层的关系。目标卡面或图层在此期间已被删除（用户可以在合成那几秒里动手）
 * 时整条计划跳过——宁可这次不合并，也不能凭空多塞一层。
 *
 * @param pack - 草稿系列。
 * @param plan - {@link planFlatten} 的产物。
 */
export function applyFlatten(pack: Pack, plan: FlattenPlan): void {
  const byRef = new Map<string, CardFace>()
  for (const { ref, face } of eachFace(pack)) byRef.set(refKey(ref), face)

  for (const op of plan.ops) {
    const face = byRef.get(refKey(op.face))
    if (!face) continue
    const ids = new Set(op.layerIds)
    const firstAt = face.layers.findIndex((l) => ids.has(l.id))
    if (firstAt < 0) continue
    // 插入点 = 原位置之前「不会被删掉」的层数。分组本应连续（firstAt 之前没有本组成员），
    // 但按这个定义算，即使计划与现状有出入也落在正确位置。
    const insertAt = face.layers.slice(0, firstAt).filter((l) => !ids.has(l.id)).length
    face.layers = face.layers.filter((l) => !ids.has(l.id))
    face.layers.splice(insertAt, 0, op.layer)
  }
}
