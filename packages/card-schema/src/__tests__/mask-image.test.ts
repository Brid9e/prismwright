import { describe, it, expect } from "vitest"
import { EffectSchema, MaskImageParamsSchema, MaskPresetParamsSchema } from "../schema.js"

describe("MaskImageParamsSchema", () => {
  it("默认值：path 空串 / mode line / edge0 0 / edge1 0.95 / invert false", () => {
    expect(MaskImageParamsSchema.parse({})).toEqual({
      path: "",
      mode: "line",
      edge0: 0,
      edge1: 0.95,
      invert: false,
      // 变换字段（位移 / 缩放 / 旋转）缺省即恒等：旧系列解析后蒙版铺满卡面，画面不变。
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      // 填充方式缺省与底图一致：覆盖。
      fit: "cover",
      // 跟随卡面缺省关闭：旧系列解析后按各自参数渲染，画面不变。
      followFront: false,
      // 颜色源：缺省仍按图片蒙版，旧系列逐像素不变。
      source: "image",
      color: "#808080",
    })
  })

  it("原样保留显式给定的位移 / 缩放 / 旋转（含负数）", () => {
    const p = MaskImageParamsSchema.parse({ x: -0.25, y: 0.4, scale: 2.5, rotation: -90 })
    expect(p.x).toBeCloseTo(-0.25)
    expect(p.y).toBeCloseTo(0.4)
    expect(p.scale).toBeCloseTo(2.5)
    expect(p.rotation).toBe(-90)
  })

  it("跟随卡面：缺省 false，显式 true 原样保留", () => {
    expect(MaskImageParamsSchema.parse({}).followFront).toBe(false)
    expect(MaskImageParamsSchema.parse({ followFront: true }).followFront).toBe(true)
    expect(() => MaskImageParamsSchema.parse({ followFront: "yes" })).toThrow()
  })

  it("原样保留显式给定的填充方式", () => {
    expect(MaskImageParamsSchema.parse({ fit: "cover" }).fit).toBe("cover")
    expect(MaskImageParamsSchema.parse({ fit: "contain" }).fit).toBe("contain")
    expect(() => MaskImageParamsSchema.parse({ fit: "fill" })).toThrow()
  })

  it("拒绝越界阈值", () => {
    expect(() => MaskImageParamsSchema.parse({ edge0: 1.5 })).toThrow()
    expect(() => MaskImageParamsSchema.parse({ edge1: -0.1 })).toThrow()
  })

  it("颜色源：原样保留 source 与 color，非法取值被拒", () => {
    const p = MaskImageParamsSchema.parse({ source: "color", color: "#1a2b3c" })
    expect(p.source).toBe("color")
    expect(p.color).toBe("#1a2b3c")
    // 3 位 hex 与 6 位 hex 同属合法格式（见 HEX_COLOR）。
    expect(MaskImageParamsSchema.parse({ color: "#abc" }).color).toBe("#abc")
    expect(() => MaskImageParamsSchema.parse({ source: "palette" })).toThrow()
    expect(() => MaskImageParamsSchema.parse({ color: "red" })).toThrow()
    expect(() => MaskImageParamsSchema.parse({ color: "#12345" })).toThrow()
  })

  it("EffectSchema 能解析 imageMask 条目并给 enabled 默认 true", () => {
    const e = EffectSchema.parse({ kind: "imageMask", id: "e1", params: { path: "assets/m.png" } })
    expect(e.kind).toBe("imageMask")
    expect(e.enabled).toBe(true)
    expect(e.params).toMatchObject({ path: "assets/m.png", mode: "line" })
  })
})

describe("MaskPresetParamsSchema.invert", () => {
  it("默认 false", () => {
    expect(MaskPresetParamsSchema.parse({ id: "polygon" }).invert).toBe(false)
  })
})
