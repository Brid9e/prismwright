import { describe, it, expect } from "vitest"
import { faceRefMatches } from "../faceRefMatches"

describe("faceRefMatches", () => {
  it("正面请求与当前选中的卡一致时匹配", () => {
    expect(faceRefMatches({ kind: "card", cardId: "c1" }, "front", "c1")).toBe(true)
  })

  it("正面请求但预览在背面（或选中的是另一张卡）时不匹配", () => {
    expect(faceRefMatches({ kind: "card", cardId: "c1" }, "back", "c1")).toBe(false)
    expect(faceRefMatches({ kind: "card", cardId: "c1" }, "front", "c2")).toBe(false)
  })

  it("背面请求只在背面视图匹配", () => {
    expect(faceRefMatches({ kind: "back" }, "back", "c1")).toBe(true)
    expect(faceRefMatches({ kind: "back" }, "front", "c1")).toBe(false)
  })
})
