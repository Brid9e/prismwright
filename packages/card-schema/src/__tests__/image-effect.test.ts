import { describe, it, expect } from "vitest"
import { EffectSchema, ImageParamsSchema, resolveImage, type Effect } from "../index.js"

/** 造一条合法 image 条目；id 固定，本文件不关心列表内唯一性。 */
const mk = (params: Record<string, unknown> = {}, enabled = true): Effect =>
  EffectSchema.parse({ kind: "image", id: "img", enabled, params }) as Effect

describe("ImageParamsSchema", () => {
  it("缺省时补 path 空串、位置/旋转 0、缩放 1，填充 contain、不跟随卡面", () => {
    expect(ImageParamsSchema.parse({})).toEqual({
      path: "",
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      fit: "contain",
      followFront: false,
      bumpStrength: 0,
      bumpDetail: 0.01,
      bumpFlow: 0.5,
      bumpLight: 1,
      bumpLightAngle: 127,
      bumpLightColor: "#ffffff",
      bumpInvert: false,
      normalPath: "",
      normalFlipY: false,
    })
  })

  // 缺省必须复现加 fit 之前的画面（fitImageSize 等价 contain）；取 cover 会把存量图片裁一圈。
  it("fit 接受三种填充方式、拒绝非法值", () => {
    expect(ImageParamsSchema.parse({ fit: "cover" }).fit).toBe("cover")
    expect(ImageParamsSchema.parse({ fit: "stretch" }).fit).toBe("stretch")
    expect(() => ImageParamsSchema.parse({ fit: "fill" })).toThrow()
  })

  it("拒绝越界的 x / y / rotation / scale", () => {
    expect(() => ImageParamsSchema.parse({ x: 1.01 })).toThrow()
    expect(() => ImageParamsSchema.parse({ y: -1.01 })).toThrow()
    expect(() => ImageParamsSchema.parse({ rotation: 181 })).toThrow()
    expect(() => ImageParamsSchema.parse({ scale: 0.09 })).toThrow()
    expect(() => ImageParamsSchema.parse({ scale: 4.01 })).toThrow()
  })

  // 法线（bump）：强度 0 = 自己不开、沿用卡面的（默认），故缺省必须为 0。
  it("法线缺省强度 0、细节 0.01、流向 0.5、光照 1 / 127° 白光、不反转，并拒绝越界", () => {
    const p = ImageParamsSchema.parse({})
    expect(p.bumpStrength).toBe(0)
    expect(p.bumpDetail).toBe(0.01)
    expect(p.bumpFlow).toBe(0.5)
    expect(p.bumpLight).toBe(1)
    expect(p.bumpLightAngle).toBe(127)
    expect(p.bumpLightColor).toBe("#ffffff")
    expect(p.bumpInvert).toBe(false)
    // 法线贴图默认不选（空串）、不翻绿通道。
    expect(p.normalPath).toBe("")
    expect(p.normalFlipY).toBe(false)
    expect(ImageParamsSchema.parse({ bumpStrength: 1, bumpDetail: 0.05, bumpFlow: 0 })).toMatchObject({
      bumpStrength: 1,
      bumpDetail: 0.05,
      bumpFlow: 0,
    })
    // 上限 10：法线贴图的坡向量级比亮度差大，用户需要更大的强度才够「凸」。
    expect(ImageParamsSchema.parse({ bumpStrength: 10 }).bumpStrength).toBe(10)
    expect(() => ImageParamsSchema.parse({ bumpStrength: 10.01 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpDetail: 0.0001 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpDetail: 0.06 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpFlow: -0.01 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpLight: 1.01 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpLight: -0.01 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpLightAngle: 181 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpLightAngle: -181 })).toThrow()
    expect(() => ImageParamsSchema.parse({ bumpLightColor: "white" })).toThrow()
  })

  it("法线贴图路径与绿通道翻转原样保留", () => {
    expect(
      ImageParamsSchema.parse({ normalPath: "assets/normal.png", normalFlipY: true }),
    ).toMatchObject({ normalPath: "assets/normal.png", normalFlipY: true })
  })

  it("接受边界值", () => {
    expect(ImageParamsSchema.parse({ x: -1, y: 1, rotation: -180, scale: 4 })).toMatchObject({
      x: -1,
      y: 1,
      rotation: -180,
      scale: 4,
    })
    expect(
      ImageParamsSchema.parse({ bumpLightAngle: 180, bumpLightColor: "#f80" }),
    ).toMatchObject({ bumpLightAngle: 180, bumpLightColor: "#f80" })
  })
})

describe("EffectSchema image 分支", () => {
  it("接受 image 条目并补默认参数", () => {
    const e = mk()
    expect(e.kind).toBe("image")
    if (e.kind !== "image") throw new Error("kind 应为 image")
    expect(e.params).toEqual({
      path: "",
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      fit: "contain",
      followFront: false,
      bumpStrength: 0,
      bumpDetail: 0.01,
      bumpFlow: 0.5,
      bumpLight: 1,
      bumpLightAngle: 127,
      bumpLightColor: "#ffffff",
      bumpInvert: false,
      normalPath: "",
      normalFlipY: false,
    })
  })
})

describe("resolveImage", () => {
  it("无 image 条目返回 null", () => {
    expect(resolveImage([])).toBeNull()
    expect(
      resolveImage([EffectSchema.parse({ kind: "gloss", id: "g", params: {} }) as Effect]),
    ).toBeNull()
  })

  it("跳过 disabled 的 image", () => {
    expect(resolveImage([mk({}, false)])).toBeNull()
  })

  it("返回第一条启用的 image 参数，且不判空 path", () => {
    expect(resolveImage([mk({ path: "assets/a.png", x: 0.5 })])).toEqual({
      path: "assets/a.png",
      x: 0.5,
      y: 0,
      rotation: 0,
      scale: 1,
      fit: "contain",
      followFront: false,
      bumpStrength: 0,
      bumpDetail: 0.01,
      bumpFlow: 0.5,
      bumpLight: 1,
      bumpLightAngle: 127,
      bumpLightColor: "#ffffff",
      bumpInvert: false,
      normalPath: "",
      normalFlipY: false,
    })
    expect(resolveImage([mk({})])?.path).toBe("")
  })

  it("多条启用时取第一条", () => {
    expect(resolveImage([mk({ path: "a.png" }), mk({ path: "b.png" })])?.path).toBe("a.png")
  })
})
