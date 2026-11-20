import { describe, it, expect } from "vitest"
import { PaletteParamsSchema, GradientParamsSchema, DEFAULT_GRADIENT_PHASE } from "../schema.js"
import { EffectSchema, LayerSchema, PackSchema } from "../schema.js"

describe("PaletteParamsSchema", () => {
  it("默认 colors 为空数组（= 本目标不出全息）", () => {
    expect(PaletteParamsSchema.parse({})).toEqual({
      colors: [],
      composite: "palette",
      hue: 0.036,
      sat: 1.3,
      lift: 0.4,
      tint: 1,
      deltaBase: 0.2,
      deltaContrast: 0.3,
      deltaBright: 0.1,
      grid: 1,
      gridScale: 0.79,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it("旧的 composite=balatro 落到 tint", () => {
    expect(PaletteParamsSchema.parse({ composite: "balatro" }).composite).toBe("tint")
  })

  it("旧格式（裸 hex 字符串数组）按下标等距展开并按 at 升序", () => {
    expect(PaletteParamsSchema.parse({ colors: ["#111111", "#222222", "#333333"] }).colors).toEqual(
      [
        { color: "#111111", at: 0 },
        { color: "#222222", at: 0.5 },
        { color: "#333333", at: 1 },
      ],
    )
  })

  it("第 9 个色标被拒", () => {
    const colors = Array.from({ length: 9 }, (_, i) => ({ color: "#ffffff", at: i / 8 }))
    expect(() => PaletteParamsSchema.parse({ colors })).toThrow()
  })
})

describe("GradientParamsSchema 的 7 个相位参数", () => {
  it("默认值与 DEFAULT_GRADIENT_PHASE 逐项相等（单一来源）", () => {
    const parsed = GradientParamsSchema.parse({})
    expect(parsed.distortionStrength).toBe(DEFAULT_GRADIENT_PHASE.distortionStrength)
    expect(parsed.phaseSpeed).toBe(DEFAULT_GRADIENT_PHASE.phaseSpeed)
    expect(parsed.tiltGain).toBe(DEFAULT_GRADIENT_PHASE.tiltGain)
    expect(parsed.noiseStrength).toBe(DEFAULT_GRADIENT_PHASE.noiseStrength)
    expect(parsed.transition).toBe(DEFAULT_GRADIENT_PHASE.transition)
    expect(parsed.offsetX).toBe(DEFAULT_GRADIENT_PHASE.offsetX)
    expect(parsed.offsetY).toBe(DEFAULT_GRADIENT_PHASE.offsetY)
    expect(DEFAULT_GRADIENT_PHASE).toEqual({
      distortionStrength: 5,
      phaseSpeed: 1,
      tiltGain: 1,
      noiseStrength: 0,
      transition: 1,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it("取值域：distortionStrength 0–1000、phaseSpeed 0–5、tiltGain 0–3、noiseStrength 0–1、transition 0–3、偏移 ±3", () => {
    expect(() => GradientParamsSchema.parse({ distortionStrength: 1001 })).toThrow()
    expect(() => GradientParamsSchema.parse({ phaseSpeed: 6 })).toThrow()
    // 0 = 倾斜完全不改图案，1 = 现状，>1 = 夸张。默认 1 必须逐位等于改版前。
    expect(GradientParamsSchema.parse({ tiltGain: 0 }).tiltGain).toBe(0)
    expect(GradientParamsSchema.parse({ tiltGain: 3 }).tiltGain).toBe(3)
    expect(() => GradientParamsSchema.parse({ tiltGain: 3.5 })).toThrow()
    expect(() => GradientParamsSchema.parse({ tiltGain: -0.1 })).toThrow()
    expect(() => GradientParamsSchema.parse({ noiseStrength: 1.1 })).toThrow()
    expect(() => GradientParamsSchema.parse({ transition: 3.1 })).toThrow()
    // 上限抬到 3 后，1 以上仍然合法——「让过渡带跨出本段」正是要调的区间。
    expect(GradientParamsSchema.parse({ transition: 2 }).transition).toBe(2)
    // 偏移放宽到 ±3：图案是准周期的（色板以 cos 循环），默认 density 下约 0.9 UV 走完一圈色板，
    // 故 ±1 只够一圈、搬不动「整幅图案」的构图；±3 才够把光环 / 射线的中心推到卡外。
    expect(GradientParamsSchema.parse({ offsetX: 3 }).offsetX).toBe(3)
    expect(GradientParamsSchema.parse({ offsetY: -3 }).offsetY).toBe(-3)
    expect(() => GradientParamsSchema.parse({ offsetX: 3.5 })).toThrow()
  })
})

describe("EffectSchema 的 palette 支", () => {
  it("解析合法 palette 条目并补 enabled 默认 true", () => {
    const e = EffectSchema.parse({ kind: "palette", id: "p1", params: { colors: ["#fff"] } })
    expect(e.kind).toBe("palette")
    expect(e.enabled).toBe(true)
    expect(e.params).toMatchObject({ colors: [{ color: "#fff", at: 0.5 }] })
  })
})

describe("Layer 退役字段", () => {
  it("不再产出 colors 与 5 个相位参数（未知字段被 strip）", () => {
    const layer = LayerSchema.parse({
      id: "l1",
      colors: ["#ff0000"],
      distortionStrength: 42,
      phaseSpeed: 3,
      noiseStrength: 0.7,
      offsetX: 0.5,
      offsetY: -0.5,
    })
    expect("colors" in layer).toBe(false)
    expect("distortionStrength" in layer).toBe(false)
    expect("phaseSpeed" in layer).toBe(false)
    expect("noiseStrength" in layer).toBe(false)
    expect("offsetX" in layer).toBe(false)
    expect("offsetY" in layer).toBe(false)
  })

  it("旧字段 poleX / poleY 不再被吸收（transform 已删）", () => {
    const layer = LayerSchema.parse({ id: "l1", poleY: 2 })
    expect("offsetY" in layer).toBe(false)
  })

  it("PackSchema 的 schemaVersion 字面量为 8", () => {
    const base = {
      id: "p1",
      name: "包",
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
    }
    expect(PackSchema.parse({ ...base, schemaVersion: 8 }).schemaVersion).toBe(8)
    expect(() => PackSchema.parse({ ...base, schemaVersion: 6 })).toThrow()
  })
})
