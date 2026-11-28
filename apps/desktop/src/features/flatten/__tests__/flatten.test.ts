/**
 * 「把多个图片图层合并成一张」的判定与换算。
 *
 * 只测纯函数：哪些图层**可以**合并（能保证合并前后逐像素一致的那一类）、哪些必须留下，
 * 以及离屏画布的尺寸与摆放换算。像素合成与 PNG 落盘在 `compose.ts`，需 DOM，故不在此处。
 */
import { describe, it, expect } from "vitest"
import { createLayer, GradientParamsSchema, LayerSchema, type Effect, type Layer } from "@prismwright/schema"
import { CARD_ASPECT } from "@prismwright/renderer/v1"
import {
  findFlattenGroups,
  groupFingerprint,
  imageEffectPath,
  isFlattenable,
  placementFor,
  planCanvasSize,
  sizingOf,
} from "../flatten"

function imageEffect(path = "assets/a.png"): Effect {
  return {
    id: `img-${path}`,
    enabled: true,
    kind: "image",
    params: { path, x: 0, y: 0, rotation: 0, scale: 1 },
  } as Effect
}

/** 一张「纯图片图层」：没有调色板 → 渲染器里 uHasHolo=0，只出图片像素。 */
function imageLayer(over: Partial<Layer> = {}, path = "assets/a.png"): Layer {
  const layer = createLayer("图层")
  layer.effects = [imageEffect(path)]
  return { ...layer, ...over }
}

describe("isFlattenable", () => {
  it("纯图片图层可以合并", () => {
    expect(isFlattenable(imageLayer())).toBe(true)
  })

  it("被禁用的图层不参与——它本来就不出图，合并进去反而会让它出现", () => {
    expect(isFlattenable(imageLayer({ enabled: false }))).toBe(false)
  })

  it("带子层的图层不参与——它是别人（可能是蒙版）的父层", () => {
    expect(isFlattenable(imageLayer({ children: [imageLayer({}, "assets/b.png")] }))).toBe(false)
  })

  it("挂调色板的图层不参与——全息随视角变，烤不进位图", () => {
    const layer = imageLayer()
    layer.effects.push({
      id: "p1",
      enabled: true,
      kind: "gradient",
      params: GradientParamsSchema.parse({ colors: [] }),
    } as Effect)
    expect(isFlattenable(layer)).toBe(false)
  })

  it("挂图蒙版的图层不参与——蒙版要留在独立图层上裁切子树", () => {
    const layer = imageLayer()
    layer.effects.push({
      id: "m1",
      enabled: true,
      kind: "imageMask",
      params: { path: "assets/m.png", mode: "line", edge0: 0, edge1: 1, invert: false },
    } as Effect)
    expect(isFlattenable(layer)).toBe(false)
  })

  it("screen / multiply 不参与——它们在 GPU 上的混合式与画布算子不等价", () => {
    expect(isFlattenable(imageLayer({ blend: "screen" }))).toBe(false)
    expect(isFlattenable(imageLayer({ blend: "multiply" }))).toBe(false)
    expect(isFlattenable(imageLayer({ blend: "normal" }))).toBe(true)
  })

  it("还没选图的图片效果不参与（空路径没有像素可烤）", () => {
    expect(isFlattenable(imageLayer({}, ""))).toBe(false)
  })

  it("把图片效果禁用掉等于不参与", () => {
    const layer = imageLayer()
    layer.effects = [{ ...imageEffect(), enabled: false } as Effect]
    expect(isFlattenable(layer)).toBe(false)
  })
})

describe("imageEffectPath", () => {
  it("取出图层里那条生效的图片效果路径", () => {
    expect(imageEffectPath(imageLayer({}, "assets/x.png"))).toBe("assets/x.png")
  })
})

describe("findFlattenGroups", () => {
  it("相邻的两层纯图片合成一组", () => {
    const layers = [imageLayer({}, "assets/a.png"), imageLayer({}, "assets/b.png")]
    expect(findFlattenGroups(layers)).toEqual([[0, 1]])
  })

  it("中间被别的层隔开就各算各的——合并会改变绘制顺序", () => {
    const palette = imageLayer()
    palette.effects.push({ id: "p", enabled: true, kind: "gradient", params: GradientParamsSchema.parse({ colors: [] }) } as Effect)
    const layers = [
      imageLayer({}, "assets/a.png"),
      palette,
      imageLayer({}, "assets/b.png"),
      imageLayer({}, "assets/c.png"),
    ]
    expect(findFlattenGroups(layers)).toEqual([[2, 3]])
  })

  it("混合模式不同不能同组", () => {
    const layers = [
      imageLayer({ blend: "add" }, "assets/a.png"),
      imageLayer({ blend: "normal" }, "assets/b.png"),
    ]
    expect(findFlattenGroups(layers)).toEqual([])
  })

  it("孤零零一层不合并——一层换一层没有收益，却多一次重采样", () => {
    expect(findFlattenGroups([imageLayer()])).toEqual([])
    expect(findFlattenGroups([])).toEqual([])
  })

  it("存在调整层时整卡不烤平——调整层会影响下方图片", () => {
    const adjustment = LayerSchema.parse({ id: "adj", kind: "adjustment" })
    expect(
      findFlattenGroups([imageLayer({}, "assets/a.png"), imageLayer({}, "assets/b.png"), adjustment]),
    ).toEqual([])
  })

  it("三层连在一组", () => {
    const layers = [
      imageLayer({}, "assets/a.png"),
      imageLayer({}, "assets/b.png"),
      imageLayer({}, "assets/c.png"),
    ]
    expect(findFlattenGroups(layers)).toEqual([[0, 1, 2]])
  })
})

describe("groupFingerprint", () => {
  it("同样的层给出同样的指纹（撤销后能认出「这组没变」）", () => {
    const make = () => [imageLayer({}, "assets/a.png"), imageLayer({}, "assets/b.png")]
    const ids = make().map((l) => l.id)
    const a = make().map((l, i) => ({ ...l, id: ids[i] }))
    expect(groupFingerprint(a)).toBe(groupFingerprint(a.map((l) => ({ ...l }))))
  })

  it("改动任何影响观感的参数，指纹随之变化（改动过的组该重新参与合并）", () => {
    const base = [imageLayer({}, "assets/a.png"), imageLayer({}, "assets/b.png")]
    const moved = [base[0], { ...base[1], opacity: 0.5 }]
    expect(groupFingerprint(moved)).not.toBe(groupFingerprint(base))
  })
})

const fullCard = { width: 1000, height: 1400 } // 5:7，正好一张卡

describe("sizingOf", () => {
  // 合并画布与预览必须同一套换算：图片的 fill 若被忽略，合并后的图会忽大忽小。
  it("填充方式与渲染器一致：cover 按卡面比例溢满", () => {
    // 2:1 的图盖 5:7 的卡：高度顶满（1 卡高），宽度 = 2 卡高单位。
    const sizing = sizingOf({ scale: 1, fit: "cover" }, { width: 1000, height: 500 })
    expect(sizing.height).toBeCloseTo(1)
    expect(sizing.width).toBeCloseTo(2)
  })

  it("按卡面比例自适应后乘 scale，与渲染器同一套换算", () => {
    const sizing = sizingOf({ scale: 0.5, fit: "contain" }, fullCard)
    expect(sizing.width).toBeCloseTo((CARD_ASPECT * 0.5))
    expect(sizing.height).toBeCloseTo(0.5)
  })
})

describe("planCanvasSize", () => {
  it("取「不放大任何一张」的像素密度", () => {
    // 一张满卡 1000×1400 的图：每卡高单位 1400 像素。
    const size = planCanvasSize([sizingOf({ scale: 1, fit: "contain" }, fullCard)])
    expect(size.height).toBe(1400)
    expect(size.width).toBe(Math.round(1400 * CARD_ASPECT))
  })

  it("小图铺满整卡也不放大——按它自己的自然密度出画布", () => {
    // 200×280 铺满整卡：每卡高单位只有 280 像素，画布跟着它走，别把 200px 的图糊到 1000px。
    const size = planCanvasSize([
      sizingOf({ scale: 1, fit: "contain" }, { width: 200, height: 280 }),
    ])
    expect(size.height).toBe(280)
  })

  it("长边封顶 2048（小程序端的纹理上限）", () => {
    const size = planCanvasSize([
      sizingOf({ scale: 1, fit: "contain" }, { width: 4000, height: 5600 }),
    ])
    expect(size.height).toBe(2048)
  })
})

describe("placementFor", () => {
  const canvas = { width: 1000, height: 1400 }

  it("满卡图正好铺满画布", () => {
    const p = placementFor({ path: "a", x: 0, y: 0, rotation: 0, scale: 1, fit: "contain", bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false }, fullCard, canvas)
    expect(p.centerX).toBeCloseTo(500)
    expect(p.centerY).toBeCloseTo(700)
    expect(p.drawWidth).toBeCloseTo(1000)
    expect(p.drawHeight).toBeCloseTo(1400)
    expect(p.rotationRad).toBe(0)
  })

  it("偏移按卡高单位换算成像素，y 正向朝上", () => {
    const p = placementFor({ path: "a", x: 0, y: 0.25, rotation: 0, scale: 1, fit: "contain", bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false }, fullCard, canvas)
    // 0.25 卡高 = 350 像素，且向上 = 画布 y 变小。
    expect(p.centerY).toBeCloseTo(700 - 350)
  })

  it("角度转弧度，正值顺时针（画布 y 朝下，rotate 正角即顺时针）", () => {
    const p = placementFor({ path: "a", x: 0, y: 0, rotation: 90, scale: 1, fit: "contain", bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false }, fullCard, canvas)
    expect(p.rotationRad).toBeCloseTo(Math.PI / 2)
  })
})

describe("可调宽高比", () => {
  it("方图 cover 到方卡上正好铺满（fill 按传入比例算，不写死 5:7）", () => {
    const sizing = sizingOf({ scale: 1, fit: "cover" }, { width: 1400, height: 1400 }, 1)
    expect(sizing.width).toBeCloseTo(1)
    expect(sizing.height).toBeCloseTo(1)
  })

  it("画布宽度按传入比例推得", () => {
    const sizings = [sizingOf({ scale: 1, fit: "contain" }, fullCard, 1)]
    expect(planCanvasSize(sizings, 1)).toEqual({ width: 1400, height: 1400 })
  })

  it("居中坐标按卡面半宽（与片元的取点同一口径）", () => {
    const place = placementFor(
      { path: "assets/a.png", x: 0, y: 0, rotation: 0, scale: 1, fit: "contain", bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false },
      fullCard,
      { width: 1000, height: 1000 },
      1,
    )
    expect(place.centerX).toBeCloseTo(500)
  })
})
