import { describe, it, expect } from "vitest"
import { EffectSchema, HoloGridParamsSchema } from "@cardbara/schema"

describe("HoloGridParamsSchema", () => {
  it("默认 size 0.79 / strength 1", () => {
    expect(HoloGridParamsSchema.parse({})).toEqual({ size: 0.79, strength: 1, offsetX: 0, offsetY: 0 })
  })

  it("EffectSchema 能解析 holoGrid", () => {
    expect(EffectSchema.parse({ kind: "holoGrid", id: "g", params: {} })).toMatchObject({
      kind: "holoGrid",
      params: { size: 0.79, strength: 1, offsetX: 0, offsetY: 0 },
    })
  })
})
