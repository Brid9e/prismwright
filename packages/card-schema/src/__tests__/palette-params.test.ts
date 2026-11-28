import { describe, it, expect } from "vitest"
import { GradientParamsSchema, DEFAULT_GRADIENT_PHASE } from "../schema.js"
import { EffectSchema, LayerSchema, PackSchema } from "../schema.js"

describe("GradientParamsSchema 的色标与合成参数", () => {
  it("默认 colors 为空数组（= 本目标不出全息）", () => {
    const parsed = GradientParamsSchema.parse({})
    expect(parsed.colors).toEqual([])
    expect(parsed.composite).toBe("palette")
    expect(parsed.hue).toBe(0.036)
    expect(parsed.sat).toBe(1.3)
    expect(parsed.lift).toBe(0.4)
    expect(parsed.tint).toBe(1)
    expect(parsed.deltaBase).toBe(0.2)
    expect(parsed.deltaContrast).toBe(0.3)
    expect(parsed.deltaBright).toBe(0.1)
  })

  it("旧的 composite=balatro 落到 tint", () => {
    expect(GradientParamsSchema.parse({ composite: "balatro" }).composite).toBe("tint")
  })

  it("旧格式（裸 hex 字符串数组）按下标等距展开并按 at 升序", () => {
    expect(
      GradientParamsSchema.parse({ colors: ["#111111", "#222222", "#333333"] }).colors,
    ).toEqual([
      { color: "#111111", at: 0 },
      { color: "#222222", at: 0.5 },
      { color: "#333333", at: 1 },
    ])
  })

  it("第 9 个色标被拒", () => {
    const colors = Array.from({ length: 9 }, (_, i) => ({ color: "#ffffff", at: i / 8 }))
    expect(() => GradientParamsSchema.parse({ colors })).toThrow()
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
    expect(GradientParamsSchema.parse({ tiltGain: 0 }).tiltGain).toBe(0)
    expect(GradientParamsSchema.parse({ tiltGain: 3 }).tiltGain).toBe(3)
    expect(() => GradientParamsSchema.parse({ tiltGain: 3.5 })).toThrow()
    expect(() => GradientParamsSchema.parse({ tiltGain: -0.1 })).toThrow()
    expect(() => GradientParamsSchema.parse({ noiseStrength: 1.1 })).toThrow()
    expect(() => GradientParamsSchema.parse({ transition: 3.1 })).toThrow()
    expect(GradientParamsSchema.parse({ transition: 2 }).transition).toBe(2)
    expect(GradientParamsSchema.parse({ offsetX: 3 }).offsetX).toBe(3)
    expect(GradientParamsSchema.parse({ offsetY: -3 }).offsetY).toBe(-3)
    expect(() => GradientParamsSchema.parse({ offsetX: 3.5 })).toThrow()
  })
})

describe("EffectSchema 不再接受 palette", () => {
  it("palette 条目被当作未知 kind 拒绝", () => {
    expect(() =>
      EffectSchema.parse({ kind: "palette", id: "p1", params: { colors: ["#fff"] } }),
    ).toThrow()
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

  it("PackSchema 的 schemaVersion 字面量为 10", () => {
    const base = {
      id: "p1",
      name: "包",
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
    }
    expect(PackSchema.parse({ ...base, schemaVersion: 10 }).schemaVersion).toBe(10)
    expect(() => PackSchema.parse({ ...base, schemaVersion: 9 })).toThrow()
  })
})
