/**
 * 卡面表面材质（标准 / 玻璃）的 schema。
 *
 * 玻璃是卡牌级属性：解析时给默认值，旧系列不必升 schemaVersion；强度 / 粗糙度 / 颜色只在
 * `finish = "glass"` 时参与渲染。
 */
import { describe, it, expect } from "vitest"
import { CardFaceSchema } from "../schema.js"

describe("CardFace 玻璃表面", () => {
  it("默认是标准表面", () => {
    expect(CardFaceSchema.parse({})).toMatchObject({
      finish: "standard",
      glassStrength: 0.6,
      glassRoughness: 0.15,
      glassTint: "#ffffff",
    })
  })

  it("接受玻璃表面与三个参数", () => {
    const face = CardFaceSchema.parse({
      finish: "glass",
      glassStrength: 0.9,
      glassRoughness: 0.4,
      glassTint: "#88ccff",
    })
    expect(face.finish).toBe("glass")
    expect(face.glassStrength).toBe(0.9)
    expect(face.glassRoughness).toBe(0.4)
    expect(face.glassTint).toBe("#88ccff")
  })

  it("拒绝未知 finish、越界强度与非法的颜色", () => {
    expect(CardFaceSchema.safeParse({ finish: "mirror" }).success).toBe(false)
    expect(CardFaceSchema.safeParse({ glassStrength: 1.5 }).success).toBe(false)
    expect(CardFaceSchema.safeParse({ glassRoughness: -0.1 }).success).toBe(false)
    expect(CardFaceSchema.safeParse({ glassTint: "blue" }).success).toBe(false)
  })
})
