import { describe, expect, it } from "vitest"
import { CardFaceSchema, CardSchema, PackSchema } from "../schema"

describe("CardFaceSchema 的法线（bump）字段", () => {
  // 默认关：存量数据解析后画面必须逐像素不变（强度 0 = 不生成法线）。
  it("缺省时强度 0（关）、细节 0.01、流向 0.5、光照 1 / 127° 白光、不反转", () => {
    const face = CardFaceSchema.parse({})
    expect(face.frontBumpStrength).toBe(0)
    expect(face.frontBumpDetail).toBe(0.01)
    expect(face.frontBumpFlow).toBe(0.5)
    expect(face.frontBumpLight).toBe(1)
    expect(face.frontBumpLightAngle).toBe(127)
    expect(face.frontBumpLightColor).toBe("#ffffff")
    expect(face.frontBumpInvert).toBe(false)
    // 法线贴图默认不选（空串）、不翻绿通道。
    expect(face.frontNormalPath).toBe("")
    expect(face.frontNormalFlipY).toBe(false)
  })

  it("原样保留显式给定的值", () => {
    const face = CardFaceSchema.parse({
      frontBumpStrength: 0.8,
      frontBumpDetail: 0.03,
      frontBumpFlow: 0.2,
      frontBumpLight: 0.4,
      frontBumpLightAngle: -45,
      frontBumpLightColor: "#ffcc00",
      frontBumpInvert: true,
      frontNormalPath: "assets/normal.png",
      frontNormalFlipY: true,
    })
    expect(face.frontBumpStrength).toBeCloseTo(0.8)
    expect(face.frontBumpDetail).toBeCloseTo(0.03)
    expect(face.frontBumpFlow).toBeCloseTo(0.2)
    expect(face.frontBumpLight).toBeCloseTo(0.4)
    expect(face.frontBumpLightAngle).toBeCloseTo(-45)
    expect(face.frontBumpLightColor).toBe("#ffcc00")
    expect(face.frontBumpInvert).toBe(true)
    expect(face.frontNormalPath).toBe("assets/normal.png")
    expect(face.frontNormalFlipY).toBe(true)
  })

  // 上限 10：法线贴图的坡向量级比亮度差大，用户需要更大的强度才够「凸」。
  it("强度上限是 10（边界值本身合法）", () => {
    expect(CardFaceSchema.parse({ frontBumpStrength: 10 }).frontBumpStrength).toBe(10)
  })

  it("拒绝越界的强度 / 细节 / 流向 / 光照", () => {
    expect(() => CardFaceSchema.parse({ frontBumpStrength: 10.01 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpStrength: -0.01 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpDetail: 0.0001 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpDetail: 0.06 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpFlow: 1.01 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpLight: 1.01 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpLightAngle: 181 })).toThrow()
    expect(() => CardFaceSchema.parse({ frontBumpLightColor: "#ffff" })).toThrow()
  })
})

describe("CardFaceSchema 的底图调整字段", () => {
  it("缺省时用「覆盖」、零偏移、1 倍缩放与 0 度旋转（旧数据解析后即可直接渲染）", () => {
    const face = CardFaceSchema.parse({})
    expect(face.frontFit).toBe("cover")
    expect(face.frontOffsetX).toBe(0)
    expect(face.frontOffsetY).toBe(0)
    expect(face.frontScale).toBe(1)
    expect(face.frontRotation).toBe(0)
  })

  it("原样保留显式给定的值与负数偏移", () => {
    const face = CardFaceSchema.parse({
      frontFit: "contain",
      frontOffsetX: -0.125,
      frontOffsetY: 0.4,
      frontScale: 2.5,
      frontRotation: -135,
    })
    expect(face.frontFit).toBe("contain")
    expect(face.frontOffsetX).toBeCloseTo(-0.125)
    expect(face.frontOffsetY).toBeCloseTo(0.4)
    expect(face.frontScale).toBeCloseTo(2.5)
    expect(face.frontRotation).toBeCloseTo(-135)
  })

  it("拒绝不认识的填充方式", () => {
    expect(() => CardFaceSchema.parse({ frontFit: "tile" })).toThrow()
  })

  it("卡片与系列（含背面）都带上这组字段", () => {
    const card = CardSchema.parse({ id: "c1", num: 0, name: "" })
    expect(card.frontFit).toBe("cover")
    expect(card.frontOffsetX).toBe(0)
    expect(card.frontScale).toBe(1)
    expect(card.frontRotation).toBe(0)

    const pack = PackSchema.parse({
      schemaVersion: 8,
      id: "p1",
      name: "系列",
      back: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    expect(pack.back?.frontFit).toBe("cover")
    expect(pack.back?.frontOffsetY).toBe(0)
    expect(pack.back?.frontScale).toBe(1)
    expect(pack.back?.frontRotation).toBe(0)
  })
})
