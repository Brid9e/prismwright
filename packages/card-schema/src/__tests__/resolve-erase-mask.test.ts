import { describe, it, expect } from "vitest"
import { EffectSchema, resolveEraseMask, type Effect } from "../index.js"

const mk = (path: string, enabled = true): Effect =>
  EffectSchema.parse({ kind: "maskErase", id: "e", enabled, params: { path } }) as Effect

describe("resolveEraseMask", () => {
  it("无 maskErase 条目返回 null", () => {
    expect(resolveEraseMask([])).toBeNull()
  })

  it("禁用的条目不生效（关掉擦除后整卡原样保留）", () => {
    expect(resolveEraseMask([mk("assets/e.png", false)])).toBeNull()
  })

  it("启用时返回其 params，且不判 path 空（已添加未绘制是合法中间态）", () => {
    expect(resolveEraseMask([mk("assets/e.png")])?.path).toBe("assets/e.png")
    expect(resolveEraseMask([mk("")])?.path).toBe("")
  })

  it("解析缺省参数：只有 path，缺省为空串", () => {
    const parsed = EffectSchema.parse({ kind: "maskErase", id: "e", params: {} }) as Effect
    expect(parsed.kind).toBe("maskErase")
    expect(parsed.enabled).toBe(true)
    expect(parsed.params).toEqual({ path: "" })
  })
})
