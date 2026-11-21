import { describe, it, expect } from "vitest"
import { EffectSchema, HoloGridParamsSchema, LayerSchema } from "@cardbara/schema"

describe("HoloGridParamsSchema", () => {
  it("默认继承刻纹参数", () => {
    expect(HoloGridParamsSchema.parse({})).toEqual({
      count: 3,
      angle: 0,
      density: 30,
      width: 1 / 7,
      strength: 0.5,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it("EffectSchema 能解析 holoGrid", () => {
    expect(EffectSchema.parse({ kind: "holoGrid", id: "g", params: {} })).toMatchObject({
      kind: "holoGrid",
      params: { count: 3, angle: 0, density: 30, width: 1 / 7, strength: 0.5 },
    })
  })
})

describe("旧 lattice 数据", () => {
  it("LayerSchema 解析时丢弃 lattice，其余效果保留", () => {
    const layer = LayerSchema.parse({
      id: "l1",
      effects: [
        { kind: "lattice", id: "old", params: { count: 3 } },
        { kind: "holoGrid", id: "g", params: {} },
      ],
    })
    expect(layer.effects.map((e) => e.kind)).toEqual(["holoGrid"])
  })
})
