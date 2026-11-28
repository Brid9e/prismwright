import { describe, it, expect } from "vitest"
import { EffectSchema, LayerSchema } from "../schema.js"
import type { Effect } from "../types.js"

describe("EffectSchema", () => {
  it("解析合法的 gloss 条目并给 enabled 默认 true", () => {
    const e = EffectSchema.parse({ kind: "gloss", id: "e1", params: {} })
    expect(e.kind).toBe("gloss")
    expect(e.enabled).toBe(true)
    // params 是判别联合：用 toMatchObject 免去对 kind 的显式收窄。
    expect(e.params).toMatchObject({ mode: "parallel" })
  })

  it("拒绝未知 kind", () => {
    expect(() => EffectSchema.parse({ kind: "bogus", id: "e1", params: {} })).toThrow()
  })

  it("maskPreset 条目的 params.id 必填且非空", () => {
    expect(() => EffectSchema.parse({ kind: "maskPreset", id: "e1", params: {} })).toThrow()
    // 空串同样非法（schema 上是 min(1)，不是仅「存在」）。
    expect(() => EffectSchema.parse({ kind: "maskPreset", id: "e1", params: { id: "" } })).toThrow()
    const ok = EffectSchema.parse({ kind: "maskPreset", id: "e1", params: { id: "polygon" } })
    expect(ok.params).toMatchObject({ id: "polygon" })
  })

  it("palette 条目的 colors 走解析期归一", () => {
    const e = EffectSchema.parse({
      kind: "palette",
      id: "e1",
      params: { colors: ["#111111", "#222222"] },
    })
    expect(e.params).toMatchObject({
      colors: [
        { color: "#111111", at: 0 },
        { color: "#222222", at: 1 },
      ],
    })
  })

  it("holoGrid 参数不含 enabled（未知字段被 strip）", () => {
    const e = EffectSchema.parse({ kind: "holoGrid", id: "e1", params: { enabled: false } }) as Effect
    expect("enabled" in e.params).toBe(false)
  })

  it("Layer 的 effects 默认空数组", () => {
    expect(LayerSchema.parse({ id: "l1" }).effects).toEqual([])
  })

  it("Layer 能解析非空 effects 列表（防 mis-wire）", () => {
    const layer = LayerSchema.parse({
      id: "l1",
      effects: [{ kind: "gloss", id: "e1", params: {} }],
    })
    expect(layer.effects).toHaveLength(1)
    expect(layer.effects[0].kind).toBe("gloss")
  })
})
