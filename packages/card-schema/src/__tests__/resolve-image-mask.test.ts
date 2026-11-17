import { describe, it, expect } from "vitest"
import { EffectSchema, resolveImageMask, type Effect } from "../index.js"

const mk = (path: string, enabled = true): Effect =>
  EffectSchema.parse({ kind: "imageMask", id: "m", enabled, params: { path } }) as Effect

describe("resolveImageMask", () => {
  it("无 imageMask 条目返回 null", () => {
    expect(resolveImageMask([])).toBeNull()
    expect(
      resolveImageMask([EffectSchema.parse({ kind: "gloss", id: "g", params: {} })] as Effect[]),
    ).toBeNull()
  })

  it("有条目但 enabled=false 返回 null", () => {
    expect(resolveImageMask([mk("assets/m.png", false)])).toBeNull()
  })

  it("有且启用返回其 params（不判 path 空）", () => {
    expect(resolveImageMask([mk("assets/m.png")])?.path).toBe("assets/m.png")
    expect(resolveImageMask([mk("")])?.path).toBe("")
  })

  it("多条启用时取第一条", () => {
    expect(resolveImageMask([mk("a.png"), mk("b.png")])?.path).toBe("a.png")
  })
})
