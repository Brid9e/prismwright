/**
 * 卡面底色：底图没覆盖到的区域 / 没有底图时垫的颜色。
 *
 * 新增字段带默认值，旧系列解析后与原画面一致。
 */
import { describe, it, expect } from "vitest"
import { CardFaceSchema } from "../schema.js"

describe("CardFace 底色", () => {
  it("默认是原来的深灰底色", () => {
    expect(CardFaceSchema.parse({}).baseColor).toBe("#282830")
  })

  it("接受任意 hex 颜色", () => {
    expect(CardFaceSchema.parse({ baseColor: "#88ccff" }).baseColor).toBe("#88ccff")
  })

  it("拒绝非 hex 颜色", () => {
    expect(CardFaceSchema.safeParse({ baseColor: "blue" }).success).toBe(false)
  })
})
