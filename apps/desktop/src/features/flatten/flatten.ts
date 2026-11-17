/**
 * 「把多个图片图层合并成一张」的判定与换算（纯函数，无 DOM / 无 IO）。
 *
 * 合并只在**观感可以逐像素复现**的前提下做。渲染器里一个图层是否只出图片像素，取决于它
 * 有没有调色板：没有 palette 时 `uHasHolo = 0`，片元里 `alpha` 归零，只剩
 * `imgC * imgA`——静态像素，与视角无关，才烤得进一张位图。反之：
 * - 全息（palette / gradient / 摩尔纹 / 光泽）随视角变，烤进静态图必然走样；
 * - 图蒙版 / 程序化蒙版把 `mw` 乘进图片 alpha，蒙版层还要留在树上裁切子树；
 * - screen / multiply 在 three 里的混合因子与画布 2D 的同名算子并不等价（见
 *   `resolveBlending`：screen 是 `One / OneMinusSrcColor`，无视源 alpha）；
 * - 被禁用的层本来不出图，合并进去会让它「复活」。
 *
 * 尺寸换算全部走渲染器自己的 `fitSpan` + `CARD_ASPECT`：合并产物要在同一套坐标系里
 * 摆放，公式抄两份必然漂移。
 */
import { CARD_ASPECT, fitSpan } from "@cardbara/renderer/v1"
import type { ImageParams, Layer } from "@cardbara/schema"

/**
 * 可以安全烤进位图的混合模式。
 *
 * - `add`：three 的 `AdditiveBlending`（`SrcAlpha / One`）即 `dst + src·a`，与画布
 *   `lighter` 的逐通道相加一致；
 * - `normal`：两边都是 Porter-Duff `over`，而 `over` 满足结合律，所以「合并后再 over」
 *   等于「依次 over」。
 */
const MERGEABLE_BLENDS: ReadonlySet<Layer["blend"]> = new Set(["add", "normal"])

/**
 * 合并产物画布的长边上限。
 *
 * 与小程序端的纹理上限同源（`tools/publish-pack.mjs` 的 `MAX_TEXTURE_EDGE` = 2048）：
 * 再大也会在加载时被缩小，白白多占体积与显存。
 */
export const MAX_FLATTEN_EDGE = 2048

/** 合并产物画布的短边下限：避免极端小图算出 1×2 的画布，把普通图形糊成马赛克。 */
export const MIN_FLATTEN_HEIGHT = 128

/**
 * 取图层里那条生效的图片效果路径。
 *
 * @returns 可合并时返回图片路径；否则返回 `null`（判据见文件头注释）。
 */
export function imageEffectPath(layer: Layer): string | null {
  if (!layer.enabled) return null
  // 有子层 = 它是别人的父层（可能正作为蒙版裁切子树），整棵子树都不能被烤平。
  if (layer.children.length > 0) return null
  if (!MERGEABLE_BLENDS.has(layer.blend)) return null
  // 只认「唯一一条生效效果且是 image」：多一条（调色板、蒙版、刻纹…）都不再是纯图片层。
  const active = layer.effects.filter((e) => e.enabled)
  if (active.length !== 1) return null
  const only = active[0]
  if (only.kind !== "image") return null
  // 空路径是「已加效果、还没选图」的中间态，没有像素可烤。
  return only.params.path || null
}

/** 该图层能否参与合并（判据见 {@link imageEffectPath}）。 */
export function isFlattenable(layer: Layer): boolean {
  return imageEffectPath(layer) !== null
}

/**
 * 在卡面顶层图层序列里找出可合并的连续分组。
 *
 * 只收**相邻**且**混合模式相同**的纯图片层：绘制顺序就是数组顺序，把中间隔着的层跨过去
 * 合并会改变叠放关系；混合模式不同的层合到一起则只能用其中一种算子。
 *
 * @param layers - 卡面顶层的图层数组（绘制顺序）。
 * @returns 每组是图层下标，长度均 ≥ 2（单层没有合并收益，反而多一次重采样）。
 */
export function findFlattenGroups(layers: readonly Layer[]): number[][] {
  const groups: number[][] = []
  let run: number[] = []
  let runBlend: Layer["blend"] | null = null
  const flush = () => {
    if (run.length >= 2) groups.push(run)
    run = []
  }
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (!isFlattenable(layer)) {
      flush()
      runBlend = null
      continue
    }
    if (run.length > 0 && layer.blend !== runBlend) flush()
    run.push(i)
    runBlend = layer.blend
  }
  flush()
  return groups
}

/**
 * 一组合并候选的指纹：这些层「是什么样」的稳定序列化。
 *
 * 用来记住「这一组刚合过」。`packStore` 自动保存是持续进行的，若用户在合并后撤销
 * （想回到分层状态继续调），撤销本身会再次标脏 → 下一次自动保存又把同一组合起来，
 * 撤销等于白按。拿到指纹就能说：这组原样不动过，别再合了。
 *
 * 只序列化与观感有关的字段；不含 `children`——可合并的层按判据没有子层。
 *
 * @param layers - 一组候选图层（绘制顺序）。
 * @returns 稳定字符串（同样的层 → 同样的串）。
 */
export function groupFingerprint(layers: readonly Layer[]): string {
  return JSON.stringify(
    layers.map((l) => ({
      id: l.id,
      blend: l.blend,
      enabled: l.enabled,
      opacity: l.opacity,
      holoMix: l.holoMix,
      effects: l.effects.map((e) => ({ id: e.id, kind: e.kind, enabled: e.enabled, params: e.params })),
    })),
  )
}

/** 一张图在卡面上的摆放尺寸（卡高 = 1 单位）。 */
export interface Sizing {
  naturalWidth: number
  naturalHeight: number
  /** 卡面单位下的宽（已乘 `ImageParams.scale`）。 */
  width: number
  /** 卡面单位下的高（已乘 `ImageParams.scale`）。 */
  height: number
}

/**
 * 按渲染器的同一套规则算出图片在卡面上的尺寸。
 *
 * @param params - 图片参数（用到 `scale` 与 `fit`）。
 * @param natural - 图片的自然像素尺寸；非正数按方图兜底（同材质侧的容错口径）。
 */
export function sizingOf(
  params: Pick<ImageParams, "scale" | "fit">,
  natural: { width: number; height: number },
  cardAspect: number = CARD_ASPECT,
): Sizing {
  const aspect = natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1
  const [fitWidth, fitHeight] = fitSpan(aspect, cardAspect, params.fit)
  const scale = params.scale > 0 ? params.scale : 1
  return {
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    width: fitWidth * scale,
    height: fitHeight * scale,
  }
}

/**
 * 定合并画布的像素尺寸。
 *
 * 取「不放大任何一张原图」的最高像素密度：某张图在卡面上占 `height` 个单位、自身高
 * `naturalHeight` 像素，则每单位至少要 `naturalHeight / height` 像素，各层取最大值。
 * 画布高即每单位像素数（卡高 = 1 单位），宽按卡面比例推得。
 *
 * @param sizings - 本组合并的各层尺寸。
 * @returns 画布像素尺寸；长边封顶 {@link MAX_FLATTEN_EDGE}。
 */
export function planCanvasSize(
  sizings: readonly Sizing[],
  cardAspect: number = CARD_ASPECT,
): { width: number; height: number } {
  let need = 0
  for (const s of sizings) {
    if (s.width <= 0 || s.height <= 0) continue
    need = Math.max(need, s.naturalWidth / s.width, s.naturalHeight / s.height)
  }
  const height = Math.round(
    Math.min(MAX_FLATTEN_EDGE, Math.max(MIN_FLATTEN_HEIGHT, need || MIN_FLATTEN_HEIGHT)),
  )
  return { width: Math.round(height * cardAspect), height }
}

/** 一张图在画布上的绘制参数（像素）。 */
export interface Placement {
  centerX: number
  centerY: number
  drawWidth: number
  drawHeight: number
  /** 弧度；正值 = 屏幕顺时针（与 `ImageParams.rotation` 的语义一致）。 */
  rotationRad: number
}

/**
 * 把「卡面单位下的摆放」换算成画布像素坐标。
 *
 * 与片元的取点方式同构：卡面点 `p` 相对 `center` 取差、绕图片中心转 `rotation`、
 * 再按 `size` 归一化取样。画布 y 轴朝下而卡面 y 轴朝上，故 `y` 的符号翻转；正是这次翻转
 * 让「画布 `rotate(θ)` 正角 = 屏幕顺时针」与数据里的角度约定对齐。
 *
 * @param params - 图片参数（偏移 / 缩放 / 旋转）。
 * @param natural - 图片的自然像素尺寸。
 * @param canvas - 画布像素尺寸（`height` 即每卡高单位的像素数）。
 */
export function placementFor(
  params: ImageParams,
  natural: { width: number; height: number },
  canvas: { width: number; height: number },
  cardAspect: number = CARD_ASPECT,
): Placement {
  const pxPerUnit = canvas.height
  const sizing = sizingOf(params, natural, cardAspect)
  return {
    centerX: (params.x + cardAspect / 2) * pxPerUnit,
    centerY: (0.5 - params.y) * pxPerUnit,
    drawWidth: sizing.width * pxPerUnit,
    drawHeight: sizing.height * pxPerUnit,
    rotationRad: (params.rotation * Math.PI) / 180,
  }
}
