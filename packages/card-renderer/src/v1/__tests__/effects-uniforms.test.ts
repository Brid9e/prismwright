/**
 * toEffectUniforms：效果列表 → 分类型定长 uniform 数组 + 计数。
 *
 * 钉住四件事：空列表的零值形状（消费方无需判空）、禁用条目被剔除、同类型按列表序填入并截断、
 * 以及 moire 的继承规则（目标为空才整体接管根）。这些是着色器定长循环与「图层继承卡面摩尔纹」
 * 的唯一依据，任一处漂移都会让画面静默错位。
 */
import { describe, it, expect } from "vitest"
import { EffectSchema, type Effect } from "@prismwright/schema"
import { toEffectUniforms } from "../effects/uniforms"
import {
  MOIRE_MAX,
  GRADIENT_MAX,
  GLOSS_MAX,
  MASK_PRESET_MAX,
} from "../effects/registry"

const effect = (kind: string, params: Record<string, unknown>, enabled = true): Effect =>
  EffectSchema.parse({ kind, id: `${kind}-${Math.random()}`, enabled, params }) as Effect

describe("toEffectUniforms", () => {
  it("空列表 → 所有计数为 0，数组按上限填 0", () => {
    const u = toEffectUniforms([], [])
    expect(u.uGradientCount).toBe(0)
    expect(u.uMoireCount).toBe(0)
    expect(u.uGlossCount).toBe(0)
    expect(u.uGradientMode).toHaveLength(GRADIENT_MAX)
    expect(u.uMoireMode).toHaveLength(MOIRE_MAX)
    expect(u.uGlossMode).toHaveLength(GLOSS_MAX)
  })

  it("禁用条目不计入（count 与数组内容都不含它）", () => {
    const u = toEffectUniforms([effect("gradient", {}, false)], [])
    expect(u.uGradientCount).toBe(0)
  })

  it("同类型多条按列表序填入切片（未超上限时逐条入位）", () => {
    const list = [effect("moire", { density: 5 }), effect("moire", { density: 9 })]
    const u = toEffectUniforms(list, [])
    expect(u.uMoireCount).toBe(2)
    expect(u.uMoireDensity.slice(0, 2)).toEqual([5, 9])
  })

  it("同类型条目超出上限时按列表序截断到 GLOSS_MAX", () => {
    // 造 GLOSS_MAX + 1 条 gloss，验证 pick() 的 `out.length < max` 截断：计数被封顶，
    // 数组只有前 GLOSS_MAX 条，末条（intensity=0.3）无槽位可放。
    const list = [
      effect("gloss", { intensity: 0.1 }),
      effect("gloss", { intensity: 0.2 }),
      effect("gloss", { intensity: 0.3 }),
    ]
    const u = toEffectUniforms(list, [])
    expect(u.uGlossCount).toBe(GLOSS_MAX)
    expect(u.uGlossIntensity.slice(0, GLOSS_MAX)).toEqual([0.1, 0.2])
    expect(u.uGlossIntensity).toHaveLength(GLOSS_MAX)
  })

  it("扭转种子随条目打包进各自的种子数组，未占用的槽位补 0", () => {
    // 种子是渲染期参数（决定扭转的「转法」，见 shaders/common.ts 的 twistPhase），
    // 故必须与 twist 同路打包；槽位补 0 正好等于「不随机」，与本字段的默认值同义。
    const u = toEffectUniforms(
      [
        effect("moire", { twistSeed: 42 }),
        effect("gradient", { twistSeed: 7 }),
        effect("gloss", { twistSeed: 99 }),
      ],
      [],
    )
    expect(u.uMoireTwistSeed[0]).toBe(42)
    expect(u.uGradientTwistSeed[0]).toBe(7)
    expect(u.uGlossTwistSeed[0]).toBe(99)
    expect(u.uMoireTwistSeed).toHaveLength(MOIRE_MAX)
    expect(u.uGradientTwistSeed.slice(1)).toEqual(new Array(GRADIENT_MAX - 1).fill(0))
    expect(u.uGlossTwistSeed.slice(1)).toEqual(new Array(GLOSS_MAX - 1).fill(0))
  })

  it("moire 继承：目标为空时取根（第二个参数）的 moire", () => {
    const rootMoire = effect("moire", { mode: "rays", depth: 0.5 })
    const u = toEffectUniforms([effect("gloss", {})], [rootMoire])
    expect(u.uMoireCount).toBe(1)
    expect(u.uMoireMode[0]).toBe(2)
  })

  it("目标自带 moire 时整体接管继承（不再叠加根的）", () => {
    const own = effect("moire", { mode: "parallel" })
    const rootMoire = effect("moire", { mode: "rays" })
    const u = toEffectUniforms([own], [rootMoire])
    expect(u.uMoireCount).toBe(1)
    expect(u.uMoireMode[0]).toBe(0)
  })

  // contentRelief 走同一条数组接缝。缺省 1 = 保持图层内容浮雕的现有行为。
  it("moire.contentRelief 逐条打进 uMoireContentRelief，缺省补 1", () => {
    const u = toEffectUniforms([effect("moire", { contentRelief: 0.7 })], [])
    expect(u.uMoireContentRelief).toHaveLength(MOIRE_MAX)
    expect(u.uMoireContentRelief[0]).toBe(0.7)
    expect(u.uMoireContentRelief[1]).toBe(0) // 未用槽位补 0

    expect(toEffectUniforms([effect("moire", {})], []).uMoireContentRelief[0]).toBe(1)
  })

  // asMask 走同一条数组接缝：着色器靠它把「当蒙版用」的光泽从颜色通路里跳过。
  // 缺省补 0 = 普通光泽，存量行为不变。
  it("gloss.asMask 逐条打进 uGlossAsMask（长度 GLOSS_MAX，未用槽位补 0）", () => {
    const u = toEffectUniforms(
      [effect("gloss", { asMask: true }), effect("gloss", {})],
      [],
    )
    expect(u.uGlossAsMask).toHaveLength(GLOSS_MAX)
    expect(u.uGlossAsMask.slice(0, 2)).toEqual([1, 0])
    expect(toEffectUniforms([effect("gloss", {})], []).uGlossAsMask[0]).toBe(0)
  })

  // 光带的整场平移与其它光泽参数同路：缺省 0 = 图案钉在原位，存量画面不变。
  it("gloss.offsetX / offsetY 逐条打进距离场数组，未用槽位补 0", () => {
    const u = toEffectUniforms(
      [effect("gloss", { offsetX: 0.3, offsetY: -0.4 }), effect("gloss", {})],
      [],
    )
    expect(u.uGlossOffsetX).toHaveLength(GLOSS_MAX)
    expect(u.uGlossOffsetX.slice(0, 2)).toEqual([0.3, 0])
    expect(u.uGlossOffsetY.slice(0, 2)).toEqual([-0.4, 0])
  })

  // 羽化缺省 1 = 从中心一路渐隐，与引入本参数前的画法逐像素一致；未用槽位补 0 也无妨
  // （只在 < uGlossCount 槽位被读）。
  it("gloss.softness 逐条打进 uGlossSoftness，缺省补 1", () => {
    const u = toEffectUniforms([effect("gloss", { softness: 0.25 }), effect("gloss", {})], [])
    expect(u.uGlossSoftness).toHaveLength(GLOSS_MAX)
    expect(u.uGlossSoftness.slice(0, 2)).toEqual([0.25, 1])
  })

  // 整齐缺省 0 = 保留原来的扰动。它是全局标量（渐变最多一条），取第一槽位。
  it("gradient.straight 打进标量 uGradientStraight，缺省补 0", () => {
    expect(toEffectUniforms([effect("gradient", { straight: 1 })], []).uGradientStraight).toBe(1)
    expect(toEffectUniforms([effect("gradient", {})], []).uGradientStraight).toBe(0)
    expect(toEffectUniforms([], []).uGradientStraight).toBe(0)
  })

  it("maskPreset 的 invert 逐条打进 uMaskPresetInvert（长度 MASK_PRESET_MAX，未用槽位补 0）", () => {
    const list = [
      effect("maskPreset", { id: "polygon", invert: true }),
      effect("maskPreset", { id: "polygon", invert: false }),
    ]
    const u = toEffectUniforms(list, [])
    expect(u.uMaskPresetCount).toBe(2)
    expect(u.uMaskPresetInvert).toHaveLength(MASK_PRESET_MAX)
    expect(u.uMaskPresetInvert.slice(0, 2)).toEqual([1, 0])
  })
})

describe("toEffectUniforms holoGrid", () => {
  it("holoGrid 打包成线族 uniform（count→families）与强度/偏移", () => {
    const u = toEffectUniforms(
      [
        effect("holoGrid", {
          count: 6,
          angle: 30,
          density: 55,
          width: 0.4,
          strength: 0.8,
          offsetX: 0.1,
          offsetY: -0.2,
        }),
      ],
      [],
    )
    expect(u.uHoloGridCount).toBe(1)
    expect(u.uHoloGridFamilies[0]).toBe(6)
    expect(u.uHoloGridAngle[0]).toBe(30)
    expect(u.uHoloGridDensity[0]).toBe(55)
    expect(u.uHoloGridWidth[0]).toBe(0.4)
    expect(u.uHoloGridStrength[0]).toBe(0.8)
    expect(u.uHoloGridOffsetX[0]).toBe(0.1)
    expect(u.uHoloGridOffsetY[0]).toBe(-0.2)
  })

  it("没有 holoGrid 时计数 0，数组填 0", () => {
    const u = toEffectUniforms([], [])
    expect(u.uHoloGridCount).toBe(0)
    expect(u.uHoloGridFamilies).toEqual([0])
    expect(u.uHoloGridAngle).toEqual([0])
    expect(u.uHoloGridDensity).toEqual([0])
    expect(u.uHoloGridWidth).toEqual([0])
    expect(u.uHoloGridStrength).toEqual([0])
    expect(u.uHoloGridOffsetX).toEqual([0])
    expect(u.uHoloGridOffsetY).toEqual([0])
  })
})
