/**
 * 效果列表 → 分类型定长 uniform 数组（+ 计数）。
 *
 * 方案按 spec §6.1：每种效果各开一档定长数组 + 一个计数，着色器按**固定类型序**
 * 逐档循环。这里只做纯数据打包，不含任何 three 依赖，故可零依赖单测。
 *
 * 相位组的固定类型序（moire → gradient）由着色器保证，本函数只按 kind
 * 分桶、保持同类型内的列表顺序——那正是「同类型多条按列表序累加」的依据。
 */
import type { Effect } from "@prismwright/schema"
import {
  EFFECT_REGISTRY,
  MOIRE_MAX,
  GRADIENT_MAX,
  GLOSS_MAX,
  HOLO_GRID_MAX,
  MASK_PRESET_MAX,
  type PackedUniforms,
} from "./registry"

/** 打好的 uniform 值集合（键即着色器 uniform 名）。 */
export interface EffectUniformArrays {
  // 相位：摩尔纹
  uMoireCount: number
  uMoireMode: number[]
  uMoireAngle: number[]
  uMoireDensity: number[]
  uMoireDepth: number[]
  uMoireTwist: number[]
  uMoireTwistSeed: number[]
  uMoireContentRelief: number[]
  // 相位：渐变
  uGradientCount: number
  uGradientMode: number[]
  uGradientDensity: number[]
  uGradientAngle: number[]
  uGradientTwist: number[]
  uGradientTwistSeed: number[]
  /** 整齐度：0 = 保留原有扰动，1 = 只留斜坡本身。全局标量（渐变最多一条），取首条的值。 */
  uGradientStraight: number
  // 颜色：独立网格（线族参数与刻纹同构，count 打包为 families）
  uHoloGridCount: number
  uHoloGridFamilies: number[]
  uHoloGridAngle: number[]
  uHoloGridDensity: number[]
  uHoloGridWidth: number[]
  uHoloGridStrength: number[]
  uHoloGridOffsetX: number[]
  uHoloGridOffsetY: number[]
  // 颜色：光泽
  uGlossCount: number
  uGlossMode: number[]
  uGlossBands: number[]
  uGlossSpacing: number[]
  uGlossWidth: number[]
  uGlossAngle: number[]
  uGlossTwist: number[]
  uGlossTwistSeed: number[]
  uGlossIntensity: number[]
  /** 1 = 该条作为蒙版：着色器在颜色通路里跳过它（见 shaders/common.ts 的 glossBands）。 */
  uGlossAsMask: number[]
  /** 光带整场平移（UV 域）；缺省 0 = 图案钉在原位。 */
  uGlossOffsetX: number[]
  uGlossOffsetY: number[]
  /** 羽化（0–1）：1 = 从中心一路渐隐（旧画法），0 = 硬边。 */
  uGlossSoftness: number[]
  // alpha：程序化蒙版
  uMaskPresetCount: number
  uMaskPresetSides: number[]
  uMaskPresetSpike: number[]
  uMaskPresetIrregular: number[]
  uMaskPresetEquilateral: number[]
  uMaskPresetDensity: number[]
  uMaskPresetSize: number[]
  uMaskPresetSizeJitter: number[]
  uMaskPresetArrangement: number[]
  uMaskPresetSoftness: number[]
  uMaskPresetSeed: number[]
  uMaskPresetOffset: [number, number][]
  uMaskPresetFlipX: number[]
  uMaskPresetFlipY: number[]
  uMaskPresetRotation: number[]
  uMaskPresetInvert: number[]
}

/** 一个定长数组的填充器：按列表序写入前 n 个槽位，其余保留 0。 */
function fill(max: number, values: readonly number[]): number[] {
  const out = new Array<number>(max)
  for (let i = 0; i < max; i++) out[i] = i < values.length ? values[i] : 0
  return out
}

/** 同 {@link fill}，但元素是 vec2（掩码预设的整场位移）。 */
function fillVec2(max: number, values: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < max; i++) out.push(i < values.length ? values[i] : [0, 0])
  return out
}

/** 取某 kind 的启用条目（保持列表序），并按上限截断。 */
function pick<K extends Effect["kind"]>(
  effects: readonly Effect[],
  kind: K,
  max: number,
): Array<Extract<Effect, { kind: K }>> {
  const out: Array<Extract<Effect, { kind: K }>> = []
  for (const e of effects) {
    if (e.kind === kind && e.enabled && out.length < max)
      out.push(e as Extract<Effect, { kind: K }>)
  }
  return out
}

/** 打包一组同 kind 条目：packed[key] 取各条的值。 */
function pack<K extends Effect["kind"]>(
  items: Array<Extract<Effect, { kind: K }>>,
  key: string,
): number[] {
  return items.map((e) => {
    // packUniforms 的值类型是按 kind 收窄的函数联合，在 strictFunctionTypes 下无法同时满足所有分支的参数类型，故用 never 收窄到「调用即可校验」的形态（与 registry.ts 的 parseParams cast 同理）。
    const packed: PackedUniforms = EFFECT_REGISTRY[e.kind].packUniforms(e.params as never)
    const v = packed[key]
    if (v === undefined) throw new Error(`packUniforms 缺少键 ${e.kind}.${key}`)
    return Array.isArray(v) ? v[0] : v
  })
}

/** 同 {@link pack}，但取 vec2 值（掩码预设的整场位移）。 */
function packVec2<K extends Effect["kind"]>(
  items: Array<Extract<Effect, { kind: K }>>,
  key: string,
): [number, number][] {
  return items.map((e) => {
    // packUniforms 的值类型是按 kind 收窄的函数联合，在 strictFunctionTypes 下无法同时满足所有分支的参数类型，故用 never 收窄到「调用即可校验」的形态（与 registry.ts 的 parseParams cast 同理）。
    const packed: PackedUniforms = EFFECT_REGISTRY[e.kind].packUniforms(e.params as never)
    const v = packed[key]
    if (!Array.isArray(v) || v.length !== 2)
      throw new Error(`packUniforms 缺少 vec2 键 ${e.kind}.${key}`)
    return v
  })
}

/**
 * 把目标的 `effects` 打成定长数组 uniform。
 *
 * @param effects - 目标自身的效果列表（卡面或图层）。
 * @param inheritedMoire - moire 继承源：本目标的 moire 为空时整体取它的 moire（见 spec §6.4）。
 *   对卡面自身传 `[]`。
 */
export function toEffectUniforms(
  effects: readonly Effect[],
  inheritedMoire: readonly Effect[],
): EffectUniformArrays {
  const moireItems = pick(effects, "moire", MOIRE_MAX)
  const effectiveMoire =
    moireItems.length > 0 ? moireItems : pick(inheritedMoire, "moire", MOIRE_MAX)

  const gradientItems = pick(effects, "gradient", GRADIENT_MAX)
  const glossItems = pick(effects, "gloss", GLOSS_MAX)
  const gridItems = pick(effects, "holoGrid", HOLO_GRID_MAX)
  const maskItems = pick(effects, "maskPreset", MASK_PRESET_MAX)

  return {
    uMoireCount: effectiveMoire.length,
    uMoireMode: fill(MOIRE_MAX, pack(effectiveMoire, "mode")),
    uMoireAngle: fill(MOIRE_MAX, pack(effectiveMoire, "angle")),
    uMoireDensity: fill(MOIRE_MAX, pack(effectiveMoire, "density")),
    uMoireDepth: fill(MOIRE_MAX, pack(effectiveMoire, "depth")),
    uMoireTwist: fill(MOIRE_MAX, pack(effectiveMoire, "twist")),
    uMoireTwistSeed: fill(MOIRE_MAX, pack(effectiveMoire, "twistSeed")),
    uMoireContentRelief: fill(MOIRE_MAX, pack(effectiveMoire, "contentRelief")),

    uGradientCount: gradientItems.length,
    uGradientMode: fill(GRADIENT_MAX, pack(gradientItems, "mode")),
    uGradientDensity: fill(GRADIENT_MAX, pack(gradientItems, "density")),
    uGradientAngle: fill(GRADIENT_MAX, pack(gradientItems, "angle")),
    uGradientTwist: fill(GRADIENT_MAX, pack(gradientItems, "twist")),
    uGradientTwistSeed: fill(GRADIENT_MAX, pack(gradientItems, "twistSeed")),
    uGradientStraight: pack(gradientItems, "straight")[0] ?? 0,

    uGlossCount: glossItems.length,
    uGlossMode: fill(GLOSS_MAX, pack(glossItems, "mode")),
    uGlossBands: fill(GLOSS_MAX, pack(glossItems, "bands")),
    uGlossSpacing: fill(GLOSS_MAX, pack(glossItems, "spacing")),
    uGlossWidth: fill(GLOSS_MAX, pack(glossItems, "width")),
    uGlossAngle: fill(GLOSS_MAX, pack(glossItems, "angle")),
    uGlossTwist: fill(GLOSS_MAX, pack(glossItems, "twist")),
    uGlossTwistSeed: fill(GLOSS_MAX, pack(glossItems, "twistSeed")),
    uGlossIntensity: fill(GLOSS_MAX, pack(glossItems, "intensity")),
    uGlossAsMask: fill(GLOSS_MAX, pack(glossItems, "asMask")),
    uGlossOffsetX: fill(GLOSS_MAX, pack(glossItems, "offsetX")),
    uGlossOffsetY: fill(GLOSS_MAX, pack(glossItems, "offsetY")),
    uGlossSoftness: fill(GLOSS_MAX, pack(glossItems, "softness")),

    uHoloGridCount: gridItems.length,
    uHoloGridFamilies: fill(HOLO_GRID_MAX, pack(gridItems, "families")),
    uHoloGridAngle: fill(HOLO_GRID_MAX, pack(gridItems, "angle")),
    uHoloGridDensity: fill(HOLO_GRID_MAX, pack(gridItems, "density")),
    uHoloGridWidth: fill(HOLO_GRID_MAX, pack(gridItems, "width")),
    uHoloGridStrength: fill(HOLO_GRID_MAX, pack(gridItems, "strength")),
    uHoloGridOffsetX: fill(HOLO_GRID_MAX, pack(gridItems, "offsetX")),
    uHoloGridOffsetY: fill(HOLO_GRID_MAX, pack(gridItems, "offsetY")),

    uMaskPresetCount: maskItems.length,
    uMaskPresetSides: fill(MASK_PRESET_MAX, pack(maskItems, "sides")),
    uMaskPresetSpike: fill(MASK_PRESET_MAX, pack(maskItems, "spike")),
    uMaskPresetIrregular: fill(MASK_PRESET_MAX, pack(maskItems, "irregular")),
    uMaskPresetEquilateral: fill(MASK_PRESET_MAX, pack(maskItems, "equilateral")),
    uMaskPresetDensity: fill(MASK_PRESET_MAX, pack(maskItems, "density")),
    uMaskPresetSize: fill(MASK_PRESET_MAX, pack(maskItems, "size")),
    uMaskPresetSizeJitter: fill(MASK_PRESET_MAX, pack(maskItems, "sizeJitter")),
    uMaskPresetArrangement: fill(MASK_PRESET_MAX, pack(maskItems, "arrangement")),
    uMaskPresetSoftness: fill(MASK_PRESET_MAX, pack(maskItems, "softness")),
    uMaskPresetSeed: fill(MASK_PRESET_MAX, pack(maskItems, "seed")),
    // 位移是 vec2，标量 fill 不适用，单独走 fillVec2 生成 [x, y] 数组。
    uMaskPresetOffset: fillVec2(MASK_PRESET_MAX, packVec2(maskItems, "offset")),
    uMaskPresetFlipX: fill(MASK_PRESET_MAX, pack(maskItems, "flipX")),
    uMaskPresetFlipY: fill(MASK_PRESET_MAX, pack(maskItems, "flipY")),
    uMaskPresetRotation: fill(MASK_PRESET_MAX, pack(maskItems, "rotation")),
    // invert 在注册表 packUniforms 里已转成 1/0，故此处直接按 number 打包，无需再转布尔。
    uMaskPresetInvert: fill(MASK_PRESET_MAX, pack(maskItems, "invert")),
  }
}
