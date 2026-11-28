/**
 * @prismwright/schema 的版本守卫与加载入口。
 *
 * 架构位置：位于数据层最外层，负责把任意来源（磁盘 `pack.json`、导入文件）的未知数据校验为
 * 当前版本的 {@link Pack}。
 *
 * 当前保留三条升级：
 * - v7 → v8：宽高比从每张卡收到系列上；
 * - v8 → v9：卡面降级为纯图层——旧 `front` 图与面级效果迁进最底层的 image 图层，
 *   整卡擦除迁成带 `maskErase` 的父级 group；
 * - v9 → v10：调色板并入渐变——同一效果列表里的第一条 `gradient` 与第一条 `palette`
 *   合成一条 `gradient`（色标 / 合成参数 + 斜坡 / 相位参数）。
 *
 * 对外暴露：`CURRENT_SCHEMA_VERSION` 常量、`migrate`、`migrateCardFace` 与 `parsePack`。
 */
import type { Pack } from "./types.js"
import { DEFAULT_CARD_ASPECT, GradientParamsSchema, PackSchema } from "./schema.js"

/** 当前数据格式版本。新增破坏性结构变更时递增。 */
export const CURRENT_SCHEMA_VERSION = 10

/** 从任意值里读一个可用的比例；不可用返回 `undefined`。 */
function readAspect(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 从 v7 及更早的系列里挑出「这个系列该用哪个比例」。 */
function aspectFromV7(obj: Record<string, unknown>): number {
  const faces = [
    ...(Array.isArray(obj.cards) ? obj.cards : []),
    ...(Array.isArray(obj.hiddenCards) ? obj.hiddenCards : []),
  ]
  const votes = new Map<number, number>()
  let winner: number | undefined
  let winnerCount = 0
  for (const face of faces) {
    const aspect = readAspect((face as Record<string, unknown> | null)?.aspect)
    if (aspect === undefined) continue
    const count = (votes.get(aspect) ?? 0) + 1
    votes.set(aspect, count)
    if (count > winnerCount) {
      winner = aspect
      winnerCount = count
    }
  }
  if (winner !== undefined) return winner
  const back = obj.back as Record<string, unknown> | null | undefined
  return readAspect(back?.aspect) ?? DEFAULT_CARD_ASPECT
}

/** 去掉卡面上的 `aspect`（v8 起卡面不再持有比例）。非对象原样返回。 */
function withoutAspect<T>(face: T): T {
  if (typeof face !== "object" || face === null) return face
  const copy = { ...(face as Record<string, unknown>) }
  delete copy.aspect
  return copy as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** v8 的面级效果里，哪一条是整卡擦除。 */
function isMaskErase(effect: unknown): boolean {
  return isRecord(effect) && effect.kind === "maskErase"
}

/** 旧面级 moire 的 faceStrength → 图层 moire 的 contentRelief。 */
function toLayerEffect(effect: unknown): unknown {
  if (!isRecord(effect) || effect.kind !== "moire" || !isRecord(effect.params)) return effect
  const params = { ...effect.params }
  const relief = typeof params.faceStrength === "number" ? params.faceStrength : 0
  delete params.faceStrength
  params.contentRelief = relief
  return { ...effect, params }
}

/** 旧面级的前景图 → 图片效果参数。 */
function legacyImageEffect(face: Record<string, unknown>): Record<string, unknown> {
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback
  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" ? v : fallback
  return {
    id: "legacy-front-image",
    enabled: true,
    kind: "image",
    params: {
      path: str(face.front, ""),
      fit: str(face.frontFit, "cover"),
      x: num(face.frontOffsetX, 0),
      y: num(face.frontOffsetY, 0),
      scale: num(face.frontScale, 1),
      rotation: num(face.frontRotation, 0),
      bumpStrength: num(face.frontBumpStrength, 0),
      bumpDetail: num(face.frontBumpDetail, 0.01),
      bumpFlow: num(face.frontBumpFlow, 0.5),
      bumpLight: num(face.frontBumpLight, 1),
      bumpLightAngle: num(face.frontBumpLightAngle, 127),
      bumpLightColor: str(face.frontBumpLightColor, "#ffffff"),
      bumpInvert: face.frontBumpInvert === true,
      normalPath: str(face.frontNormalPath, ""),
      normalFlipY: face.frontNormalFlipY === true,
    },
  }
}

/**
 * v8 → v9：把一个卡面迁移成纯图层。
 *
 * - 旧前景图 → 最底层的普通图层（image 效果 + 旧面级效果）；
 * - 旧面级 `maskErase`（整卡擦除）→ 父级 group 的祖先擦除；
 * - 旧面级 moire 的 `faceStrength` → 图层 moire 的 `contentRelief`；
 * - 删除 front* / 面级 effects。
 */
function migrateFaceV8toV9(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const face = { ...raw }
  const hasFront = typeof face.front === "string" && face.front !== ""
  const faceEffects = Array.isArray(face.effects) ? face.effects : []
  const oldLayers = Array.isArray(face.layers) ? face.layers : []

  const eraseEffects = faceEffects.filter(isMaskErase)
  const contentEffects = faceEffects.filter((e) => !isMaskErase(e)).map(toLayerEffect)

  const layerEffects: unknown[] = []
  if (hasFront) layerEffects.push(legacyImageEffect(face))
  layerEffects.push(...contentEffects)

  const contentLayers: unknown[] = []
  if (layerEffects.length > 0) {
    contentLayers.push({
      id: "legacy-front-layer",
      name: "",
      enabled: true,
      blend: "normal",
      opacity: 1,
      kind: "normal",
      effects: layerEffects,
      children: [],
    })
  }
  contentLayers.push(...oldLayers)

  // 旧面级擦除是整卡级：包一层 group，让祖先擦除继续裁切整棵子树。
  const layers =
    eraseEffects.length > 0 && contentLayers.length > 0
      ? [
          {
            id: "legacy-card-erase",
            name: "",
            enabled: true,
            blend: "normal",
            opacity: 1,
            kind: "normal",
            effects: eraseEffects,
            children: contentLayers,
          },
        ]
      : contentLayers

  for (const key of Object.keys(face)) {
    if (key.startsWith("front") || key === "effects") delete face[key]
  }
  face.layers = layers
  return face
}

/**
 * v9 → v10：把一个效果列表里的调色板并入渐变。
 *
 * - 两条都有：params 合并，`id` 取渐变，位置取靠前者，`enabled` 取调色板（用户感知的是「有没有全息」）；
 * - 仅调色板：补默认渐变参数（含 `straight: 1`）；
 * - 仅渐变：补 `colors: []`，保持「不出全息」；
 * - 同列表里多出的调色板 / 渐变：只保留合并后的第一条（渲染器本来就只读第一条）。
 */
function mergeEffectList(list: unknown): unknown {
  if (!Array.isArray(list)) return list
  let gradient: Record<string, unknown> | undefined
  let palette: Record<string, unknown> | undefined
  let gradientIndex = -1
  let paletteIndex = -1
  for (let i = 0; i < list.length; i++) {
    const effect = list[i]
    if (!isRecord(effect)) continue
    if (effect.kind === "gradient" && !gradient) {
      gradient = effect
      gradientIndex = i
    } else if (effect.kind === "palette" && !palette) {
      palette = effect
      paletteIndex = i
    }
  }
  if (!gradient && !palette) return list

  const defaults = GradientParamsSchema.parse({}) as Record<string, unknown>
  const gradientParams = gradient && isRecord(gradient.params) ? gradient.params : {}
  const paletteParams = palette && isRecord(palette.params) ? palette.params : {}
  const seed: Record<string, unknown> = { ...defaults, ...gradientParams }
  // v9 的渐变没有 straight 字段时保持旧观感（0）；新建 / 仅调色板的合并才吃 schema 的新默认 1。
  if (gradient && !("straight" in gradientParams)) seed.straight = 0
  if (palette) Object.assign(seed, paletteParams)
  // 没有调色板、且渐变本身也没有 colors（v9 的渐变从不带色标）时保持空色标：
  // 迁移前这条渐变不出全息，迁移后也不该凭空出。已经是 v10 的渐变则保留已有 colors。
  else if (!("colors" in gradientParams)) seed.colors = []
  // 走一遍 schema：旧格式裸字符串色标在这里归一，缺省字段补齐，保证迁移产物可直接解析。
  const params = GradientParamsSchema.parse(seed)
  const merged = {
    id: typeof gradient?.id === "string" ? gradient.id : palette?.id,
    kind: "gradient",
    enabled: palette ? palette.enabled !== false : gradient?.enabled !== false,
    params,
  }

  const first = [gradientIndex, paletteIndex].filter((i) => i >= 0)
  const insertAt = first.length > 0 ? Math.min(...first) : list.length
  const out: unknown[] = []
  for (let i = 0; i < list.length; i++) {
    if (i === insertAt) out.push(merged)
    const effect = list[i]
    if (isRecord(effect) && (effect.kind === "gradient" || effect.kind === "palette")) continue
    out.push(effect)
  }
  return out
}

/** 递归遍历一个图层的效果与子树。 */
function mergeLayerPaletteGradient(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const layer = { ...raw }
  if (Array.isArray(layer.effects)) layer.effects = mergeEffectList(layer.effects)
  if (Array.isArray(layer.children)) {
    layer.children = layer.children.map(mergeLayerPaletteGradient)
  }
  return layer
}

/** v9 → v10：卡面自身与其所有图层的效果列表都做合并。 */
function mergeFacePaletteGradient(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const face = { ...raw }
  if (Array.isArray(face.effects)) face.effects = mergeEffectList(face.effects)
  if (Array.isArray(face.layers)) face.layers = face.layers.map(mergeLayerPaletteGradient)
  return face
}

/**
 * 单卡导入入口：同时走 v8→v9 与 v9→v10。
 *
 * `.card` 包里的 `card.json` 可能停留在任一新旧版本；两段迁移都是幂等的。
 */
export function migrateCardFace(raw: unknown): unknown {
  return mergeFacePaletteGradient(migrateFaceV8toV9(raw))
}

/** v7 → v8：宽高比从每张卡收到系列上。 */
function migrateV7toV8(obj: Record<string, unknown>): Record<string, unknown> {
  const cards = Array.isArray(obj.cards) ? obj.cards.map(withoutAspect) : undefined
  const hiddenCards = Array.isArray(obj.hiddenCards)
    ? obj.hiddenCards.map(withoutAspect)
    : undefined
  const back = obj.back === undefined || obj.back === null ? obj.back : withoutAspect(obj.back)
  const aspect = readAspect(obj.aspect) ?? aspectFromV7(obj)
  return {
    ...obj,
    ...(cards ? { cards } : {}),
    ...(hiddenCards ? { hiddenCards } : {}),
    back,
    aspect,
  }
}

/** v8 → v9：系列里的每张卡 / 隐藏卡 / 卡背都降级为纯图层。 */
function migrateV8toV9(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    ...obj,
    ...(Array.isArray(obj.cards) ? { cards: obj.cards.map(migrateFaceV8toV9) } : {}),
    ...(Array.isArray(obj.hiddenCards)
      ? { hiddenCards: obj.hiddenCards.map(migrateFaceV8toV9) }
      : {}),
    ...(obj.back === undefined || obj.back === null
      ? {}
      : { back: migrateFaceV8toV9(obj.back) }),
  }
}

/** v9 → v10：系列里的每张卡 / 隐藏卡 / 卡背都把调色板并入渐变。 */
function migrateV9toV10(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    ...obj,
    ...(Array.isArray(obj.cards)
      ? { cards: obj.cards.map(mergeFacePaletteGradient) }
      : {}),
    ...(Array.isArray(obj.hiddenCards)
      ? { hiddenCards: obj.hiddenCards.map(mergeFacePaletteGradient) }
      : {}),
    ...(obj.back === undefined || obj.back === null
      ? {}
      : { back: mergeFacePaletteGradient(obj.back) }),
  }
}

/**
 * 版本守卫 + 升级。
 *
 * @param raw - 任意待迁移数据（通常来自 `JSON.parse`），可能不是对象。
 * @returns 迁移后的数据；对非对象入参、以及已经是当前版本的入参，返回原值（同一引用）。
 * @throws 当 `schemaVersion` 高于 {@link CURRENT_SCHEMA_VERSION} 时抛出错误。
 */
export function migrate(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`数据版本过新: ${version} > ${CURRENT_SCHEMA_VERSION}`)
  }
  if (version === CURRENT_SCHEMA_VERSION) return raw

  const v8 = version < 8 ? migrateV7toV8(raw) : raw
  const v9 = version < 9 ? migrateV8toV9(v8) : v8
  return { ...migrateV9toV10(v9), schemaVersion: CURRENT_SCHEMA_VERSION }
}

/** 解析并校验一个系列：先 `migrate` 过版本守卫，再交给 `PackSchema`。 */
export function parsePack(raw: unknown): Pack {
  return PackSchema.parse(migrate(raw))
}
