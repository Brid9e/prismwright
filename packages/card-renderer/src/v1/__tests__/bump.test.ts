/**
 * 法线（bump）来源解析：纯数据，无 three 依赖。
 *
 * 这里钉的是「谁的法线生效」这条继承规则，而不是着色器里的数学：
 *  - 图层自己的法线优先（自带法线贴图 › 自己图片的亮度差），否则沿用卡面的（法线贴图 › 亮度差）；
 *  - 卡面本身只看自己；
 *  - 来源编码是材质与着色器之间的契约：0 = 关、1 = 自身图、2 = 卡面图；
 *  - 模式编码告诉着色器取哪条通路：`luma` = 亮度差伪法线，`normal` = 采法线贴图。
 *
 * 规则错了的症状是「图层的法线拖了没反应」或「选了法线贴图还在按亮度算」——都不报错。
 */
import { describe, it, expect } from "vitest"
import { CardFaceSchema, ImageParamsSchema } from "@prismwright/schema"
import { BUMP_OFF, resolveBump, resolveLayerBump } from "../bump"

/** 开了亮度法线的卡面（没有法线贴图）。 */
const bumpFace = CardFaceSchema.parse({
  frontBumpStrength: 0.8,
  frontBumpDetail: 0.03,
  frontBumpFlow: 0.2,
  frontBumpLight: 0.9,
  frontBumpLightAngle: -30,
  frontBumpLightColor: "#ffcc00",
  frontBumpInvert: true,
})

/** 开了法线贴图的卡面。 */
const normalFace = CardFaceSchema.parse({
  frontBumpStrength: 0.8,
  frontNormalPath: "assets/normal.png",
  frontNormalFlipY: true,
})

/** 一组缺省的图片法线字段。 */
const fields = (over: Partial<Parameters<typeof resolveBump>[0]> = {}) => ({
  bumpStrength: 0.6,
  bumpDetail: 0.02,
  bumpFlow: 0.1,
  bumpLight: 0.7,
  bumpLightAngle: 45,
  bumpLightColor: "#336699",
  bumpInvert: true,
  normalPath: "",
  normalFlipY: false,
  ...over,
})

describe("resolveBump", () => {
  it("图片与法线贴图都不在场时恒为关", () => {
    expect(resolveBump(fields({ bumpStrength: 0.9 }), false, 1, false)).toEqual(BUMP_OFF)
  })

  it("强度为 0 时恒为关（哪怕选了法线贴图）", () => {
    expect(resolveBump(fields({ bumpStrength: 0, normalPath: "n.png" }), true, 2, true)).toEqual(
      BUMP_OFF,
    )
  })

  it("没选法线贴图时走亮度通路（luma）", () => {
    expect(resolveBump(fields(), true, 1, false)).toEqual({
      source: 1,
      mode: "luma",
      strength: 0.6,
      detail: 0.02,
      flow: 0.1,
      light: 0.7,
      lightAngle: 45,
      lightColor: "#336699",
      invert: true,
      flipY: false,
    })
  })

  // 法线贴图自带数据，不再从亮度差取斜率：它**整体接替**亮度通路，不是叠加。
  it("选了法线贴图且贴图在场时走法线通路（normal），带上绿通道翻转", () => {
    expect(
      resolveBump(fields({ normalPath: "assets/n.png", normalFlipY: true }), true, 1, true),
    ).toEqual({
      source: 1,
      mode: "normal",
      strength: 0.6,
      detail: 0.02,
      flow: 0.1,
      light: 0.7,
      lightAngle: 45,
      lightColor: "#336699",
      invert: true,
      flipY: true,
    })
  })

  // 贴图没载入（路径写错 / 读盘失败）时退回亮度通路，而不是整段失效——
  // 画面会退化成勾选之前的样子，用户仍能看出「图片的法线开关」是开的。
  it("选了法线贴图但贴图没载入时退回亮度通路", () => {
    const r = resolveBump(fields({ normalPath: "assets/n.png" }), true, 1, false)
    expect(r.mode).toBe("luma")
    expect(r.source).toBe(1)
  })

  // 卡面没有底图时亮度差没有意义；但法线贴图自带数据，照样能打光。
  it("没有底图时法线贴图仍然生效", () => {
    expect(resolveBump(fields({ normalPath: "assets/n.png" }), false, 1, true).mode).toBe("normal")
  })
})

describe("resolveLayerBump", () => {
  it("图层自己的图片开了法线时优先，来源 1", () => {
    const image = ImageParamsSchema.parse({
      bumpStrength: 0.7,
      bumpDetail: 0.02,
      bumpFlow: 0.3,
      bumpLight: 0.6,
      bumpLightAngle: 0,
      bumpLightColor: "#ff0000",
      bumpInvert: true,
    })
    expect(
      resolveLayerBump({
        image,
        hasImage: true,
        hasNormal: false,
        face: bumpFace,
        hasFaceImage: true,
        hasFaceNormal: false,
      }),
    ).toEqual({
      source: 1,
      mode: "luma",
      strength: 0.7,
      detail: 0.02,
      flow: 0.3,
      light: 0.6,
      lightAngle: 0,
      lightColor: "#ff0000",
      invert: true,
      flipY: false,
    })
  })

  it("图层自己的法线贴图优先于自己图片的亮度差", () => {
    const image = ImageParamsSchema.parse({
      bumpStrength: 0.7,
      normalPath: "assets/layer-n.png",
      normalFlipY: true,
    })
    const r = resolveLayerBump({
      image,
      hasImage: true,
      hasNormal: true,
      face: bumpFace,
      hasFaceImage: true,
      hasFaceNormal: false,
    })
    expect(r).toMatchObject({ source: 1, mode: "normal", flipY: true, strength: 0.7 })
  })

  it("图层没有图 / 图上法线强度 0 时沿用卡面的亮度法线，来源 2", () => {
    const image = ImageParamsSchema.parse({ bumpStrength: 0 })
    const expected = {
      source: 2,
      mode: "luma",
      strength: 0.8,
      detail: 0.03,
      flow: 0.2,
      light: 0.9,
      lightAngle: -30,
      lightColor: "#ffcc00",
      invert: true,
      flipY: false,
    }
    expect(
      resolveLayerBump({
        image,
        hasImage: true,
        hasNormal: false,
        face: bumpFace,
        hasFaceImage: true,
        hasFaceNormal: false,
      }),
    ).toEqual(expected)
    expect(
      resolveLayerBump({
        image: null,
        hasImage: false,
        hasNormal: false,
        face: bumpFace,
        hasFaceImage: true,
        hasFaceNormal: false,
      }),
    ).toEqual(expected)
  })

  // 继承链：自己的法线贴图 › 自己的亮度差 › 卡面的法线贴图 › 卡面的亮度差。
  it("卡面选了法线贴图时继承的是法线通路，来源 2", () => {
    const r = resolveLayerBump({
      image: null,
      hasImage: false,
      hasNormal: false,
      face: normalFace,
      hasFaceImage: true,
      hasFaceNormal: true,
    })
    expect(r).toMatchObject({ source: 2, mode: "normal", flipY: true, strength: 0.8 })
  })

  it("卡面选了法线贴图但贴图没载入时继承卡面的亮度法线", () => {
    const r = resolveLayerBump({
      image: null,
      hasImage: false,
      hasNormal: false,
      face: normalFace,
      hasFaceImage: true,
      hasFaceNormal: false,
    })
    expect(r.mode).toBe("luma")
    expect(r.source).toBe(2)
  })

  it("卡面没有图 / 没开法线时整段关", () => {
    const off = (face: ReturnType<typeof CardFaceSchema.parse> | null, hasFaceImage: boolean) =>
      resolveLayerBump({
        image: null,
        hasImage: false,
        hasNormal: false,
        face,
        hasFaceImage,
        hasFaceNormal: false,
      })
    expect(off(bumpFace, false)).toEqual(BUMP_OFF)
    expect(off(CardFaceSchema.parse({}), true)).toEqual(BUMP_OFF)
    expect(off(null, true)).toEqual(BUMP_OFF)
  })
})
