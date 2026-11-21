/**
 * 内置蒙版预设注册表。
 *
 * 钉住三件事：id 唯一（供 UI 选择与落盘引用）、每条预设的参数都落在 schema 值域内
 * （越界会让「选中预设」写出非法图层）、labelKey 遵循约定命名（供 i18n 查找）。
 * 顺带覆盖 materializePreset 的物化规则。
 */
import { describe, it, expect } from "vitest"
import { MaskPresetParamsSchema } from "@prismwright/schema"
import { MASK_PRESETS, materializePreset } from "../mask-presets/registry"

/** schema 的全套默认（换个 id 即可，用于对照「位移 / 种子 / 整场变换」这些物化时应归位的项）。 */
const DEFAULTS = MaskPresetParamsSchema.parse({ id: "seed" })

describe("MASK_PRESETS", () => {
  it("id 唯一", () => {
    const ids = MASK_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("至少含多边形与五角星两类（覆盖规则 / 不规则多边形与尖角诉求）", () => {
    const ids = MASK_PRESETS.map((p) => p.id)
    expect(ids).toContain("polygon")
    expect(ids).toContain("stars")
  })

  // 多边形档的 spike 必须取 1：着色器里 spike < 1 会让相邻顶点之间凹进去（0.38 档是五角星），
  // 取 1 才是直边的正多边形。形状（边数 / 不规则）交给滑块，不再各占一档。
  it("含多边形（spike 1、不规则 0 = 规则直边多边形）", () => {
    const poly = MASK_PRESETS.find((p) => p.id === "polygon")
    expect(poly).toBeDefined()
    expect(poly?.params.spike).toBe(1)
    expect(poly?.params.irregular).toBe(0)
  })

  it("每条预设物化后都能过 schema 校验", () => {
    for (const preset of MASK_PRESETS) {
      expect(() => MaskPresetParamsSchema.parse(materializePreset(preset))).not.toThrow()
    }
  })

  it("labelKey 走 maskPreset.preset.<id> 约定，且与 id 一致", () => {
    for (const preset of MASK_PRESETS) {
      expect(preset.labelKey).toBe(`maskPreset.preset.${preset.id}`)
    }
  })
})

describe("materializePreset", () => {
  it("写入 id 与整组预设参数", () => {
    const preset = MASK_PRESETS[0]
    const spec = materializePreset(preset)
    expect(spec.id).toBe(preset.id)
    expect(spec.sides).toBe(preset.params.sides)
    expect(spec.spike).toBe(preset.params.spike)
    expect(spec.density).toBe(preset.params.density)
  })

  // 位移归零、种子取默认：让每次「选中预设」都是可预期的初始观感（不继承上一次的位移 / 重掷）。
  // 整场翻转 / 旋转同一口径：它们不是「形状档位」，物化时一律回到「不翻不转」。
  it("位移归零、种子取默认，与图层既有值无关", () => {
    const spec = materializePreset(MASK_PRESETS[0])
    expect(spec.offsetX).toBe(DEFAULTS.offsetX)
    expect(spec.offsetY).toBe(DEFAULTS.offsetY)
    expect(spec.flipX).toBe(DEFAULTS.flipX)
    expect(spec.flipY).toBe(DEFAULTS.flipY)
    expect(spec.rotation).toBe(DEFAULTS.rotation)
    expect(spec.seed).toBe(DEFAULTS.seed)
  })

  // 排布与形状正交：换预设只该换形状，用户的「规则 / 随机」选择必须挺过去。不传 keep 时
  // 排布仍取默认（random）——那是「整套初值」的口径，供别的调用方直接用。
  it("keep 只保得住与形状正交的排布，其余照旧重置", () => {
    const preset = MASK_PRESETS[0]
    expect(materializePreset(preset, { arrangement: "regular" }).arrangement).toBe("regular")
    expect(materializePreset(preset).arrangement).toBe("random")
    // keep 不是「什么都不重置」的后门：位移 / 种子仍归零。
    const kept = materializePreset(preset, { arrangement: "regular" })
    expect(kept.offsetX).toBe(DEFAULTS.offsetX)
    expect(kept.seed).toBe(DEFAULTS.seed)
  })

  // 直接钉死「多边形」物化后的完整取值：字段既不能少，预设档位与默认的位移 / 种子也不能被改写。
  it("产出完整且取值正确（多边形档位 + 默认位移 / 种子）", () => {
    expect(materializePreset(MASK_PRESETS[0])).toEqual({
      id: "polygon",
      sides: 4,
      spike: 1,
      irregular: 0,
      equilateral: DEFAULTS.equilateral,
      density: 14,
      size: 0.064,
      sizeJitter: 0.5,
      arrangement: DEFAULTS.arrangement,
      // invert 是 A1 给 maskPreset 新增的「反转权重」开关：与形状正交，物化取默认（不反转）。
      invert: DEFAULTS.invert,
      offsetX: DEFAULTS.offsetX,
      offsetY: DEFAULTS.offsetY,
      flipX: DEFAULTS.flipX,
      flipY: DEFAULTS.flipY,
      rotation: DEFAULTS.rotation,
      seed: DEFAULTS.seed,
      softness: 0.02,
    })
  })
})
