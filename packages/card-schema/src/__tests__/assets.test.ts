/**
 * 卡面资源收集的纯函数测试（`collectFaceAssets` / `collectCardAssets` / `collectPackAssets`）。
 *
 * 覆盖用例：
 * - 卡面图与非空 imageMask / image / maskErase 的路径都被收集，空串跳过；
 * - 卡面自身的图蒙版与整卡擦除图排在图层之前；
 * - 图层自己的擦除图也被收集；
 * - 子层递归；
 * - 整个系列合并普通卡片、隐藏款、背面并去重。
 *
 * 纯函数、无 IO，故无需 mock。
 */
import { describe, it, expect } from "vitest"
import type { Card, Effect, Layer, Pack } from "../types"
import {
  collectCardAssets,
  collectCoverAssets,
  collectFaceAssets,
  collectPackAssets,
} from "../assets"

/** 一条启用中的 imageMask 效果；path 为空即「已添加未选图」。 */
const im = (path: string, id = "im"): Effect => ({
  kind: "imageMask",
  id,
  enabled: true,
  params: {
    path,
    source: "image",
    color: "#808080",
    mode: "line",
    edge0: 0,
    edge1: 0.95,
    invert: false,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    // 编辑期字段（渲染器不读），测试夹具取值无意义，补上以对齐必需字段。
    followFront: false,
    fit: "stretch",
  },
})

/** 一条启用中的 maskErase 效果（擦除图）；path 为空即「还没画」。 */
const erase = (path: string, id = "er"): Effect => ({
  kind: "maskErase",
  id,
  enabled: true,
  params: { path },
})

/** 一条启用中的 image 效果；path 为空即「已添加未选图」。 */
const img = (path: string, id = "img", normalPath = ""): Effect => ({
  kind: "image",
  id,
  enabled: true,
  params: {
    path,
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
    normalPath,
    normalFlipY: false,
  },
})

/** 造一个最小可用图层：只参数化 id、效果与子层。 */
const layer = (id: string, effects: Effect[] = [], children: Layer[] = []): Layer => ({
  id,
  name: "",
  children,
  enabled: true,
  holoMix: 0.9,
  holoAlpha: 1,
  blend: "add",
  opacity: 1,
  kind: "normal",
  text: null,
  effects,
})

const card: Card = {
  id: "c1",
  num: 1,
  name: "x",
  notes: "",
  rarity: "epic",
  front: "assets/cards/c1/front.png",
  frontFit: "cover",
  frontOffsetX: 0,
  frontOffsetY: 0,
  frontScale: 1,
  frontRotation: 0,
  frontBumpStrength: 0,
  frontBumpDetail: 0.01,
  frontBumpFlow: 0.5,
  frontBumpLight: 1,
  frontBumpLightAngle: 127,
  frontBumpLightColor: "#ffffff",
  frontBumpInvert: false,
  frontNormalPath: "",
  frontNormalFlipY: false,
  finish: "standard",
  glassStrength: 0.6,
  glassRoughness: 0.15,
  glassTint: "#ffffff",
  cornerRadius: 0.06,
  effects: [],
  layers: [layer("l1", [im("assets/cards/c1/masks/l1.png")]), layer("l2")],
}

describe("collectCardAssets", () => {
  it("收集卡面图与各层 imageMask 的非空路径，跳过空串", () => {
    expect(collectCardAssets(card)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("卡面自身的 imageMask 排在图层蒙版之前", () => {
    const withFaceMask: Card = { ...card, effects: [im("assets/cards/c1/masks/face.png")] }
    expect(collectCardAssets(withFaceMask)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/face.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("path 为空的 imageMask（已添加未选图）被跳过", () => {
    const emptyMask: Card = { ...card, effects: [im("")], layers: [layer("l1", [im("")])] }
    expect(collectCardAssets(emptyMask)).toEqual(["assets/cards/c1/front.png"])
  })

  it("收集图层 image 效果的非空路径（排在蒙版之后）", () => {
    const withImage: Card = {
      ...card,
      layers: [layer("l1", [im("assets/cards/c1/masks/l1.png"), img("assets/cards/c1/pic.png")])],
    }
    expect(collectCardAssets(withImage)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
      "assets/cards/c1/pic.png",
    ])
  })

  it("path 为空的 image 被跳过", () => {
    expect(collectCardAssets({ ...card, layers: [layer("l1", [img("")])] })).toEqual([
      "assets/cards/c1/front.png",
    ])
  })

  it("收集卡面 maskErase 的擦除图（紧跟在卡面图蒙版之后）", () => {
    const withErase: Card = {
      ...card,
      effects: [im("assets/cards/c1/masks/face.png"), erase("assets/cards/c1/erase.png")],
    }
    expect(collectCardAssets(withErase)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/face.png",
      "assets/cards/c1/erase.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("path 为空的 maskErase（还没画）被跳过", () => {
    expect(collectCardAssets({ ...card, effects: [erase("")] })).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("图层效果里的 maskErase 路径也被收集", () => {
    const withLayerErase: Card = {
      ...card,
      layers: [
        layer("l1", [im("assets/cards/c1/masks/l1.png"), erase("assets/cards/c1/layers/l1.png")]),
        layer("l2"),
      ],
    }
    expect(collectCardAssets(withLayerErase)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
      "assets/cards/c1/layers/l1.png",
    ])
  })

  // 法线贴图是独立资源：发布/预热漏收它，画面会静默退回亮度伪法线。
  it("收集卡面法线贴图的路径（紧跟卡面图之后）", () => {
    const withNormal: Card = {
      ...card,
      frontNormalPath: "assets/cards/c1/normal.png",
    }
    expect(collectCardAssets(withNormal)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/normal.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("收集图片效果的法线贴图路径（紧跟图片之后）", () => {
    const withNormal: Card = {
      ...card,
      layers: [
        layer("l1", [
          im("assets/cards/c1/masks/l1.png"),
          img("assets/cards/c1/pic.png", "img", "assets/cards/c1/pic-n.png"),
        ]),
      ],
    }
    expect(collectCardAssets(withNormal)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
      "assets/cards/c1/pic.png",
      "assets/cards/c1/pic-n.png",
    ])
  })

  it("未选法线贴图（空串）被跳过", () => {
    expect(collectCardAssets(card)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("子层里的资源也被收集", () => {
    const nested: Card = {
      ...card,
      layers: [layer("p1", [], [layer("t1", [img("assets/cards/c1/deep.png")])])],
    }
    expect(collectCardAssets(nested)).toContain("assets/cards/c1/deep.png")
  })
})

describe("collectFaceAssets", () => {
  it("卡面没有 front 时不产出空串", () => {
    const blank = { ...card, front: "" } as Card
    expect(collectFaceAssets(blank)).toEqual(["assets/cards/c1/masks/l1.png"])
  })
})

describe("collectCoverAssets", () => {
  it("collectCoverAssets 按大、小顺序收集非空路径并去重", () => {
    expect(collectCoverAssets({ coverLarge: "covers/a.png", coverSmall: "", packArt: "" })).toEqual([
      "covers/a.png",
    ])
    expect(collectCoverAssets({ coverLarge: "", coverSmall: "covers/b.gif", packArt: "" })).toEqual([
      "covers/b.gif",
    ])
    expect(
      collectCoverAssets({ coverLarge: "covers/a.png", coverSmall: "covers/a.png", packArt: "" }),
    ).toEqual(["covers/a.png"])
    expect(collectCoverAssets({ coverLarge: "", coverSmall: "", packArt: "" })).toEqual([])
  })

  it("collectCoverAssets 也收集头像框图", () => {
    expect(
      collectCoverAssets({
        coverLarge: "",
        coverSmall: "",
        packArt: "",
        avatarFrame: "frames/f.webp",
      }),
    ).toEqual(["frames/f.webp"])
    expect(
      collectCoverAssets({
        coverLarge: "",
        coverSmall: "",
        packArt: "",
        achievementIcon: "achievement-icons/a.webp",
      }),
    ).toEqual(["achievement-icons/a.webp"])
    expect(
      collectCoverAssets({
        coverLarge: "",
        coverSmall: "",
        packArt: "",
        seriesAvatar: "series-avatars/s.webp",
      }),
    ).toEqual(["series-avatars/s.webp"])
  })

  it("collectCoverAssets 也收集卡包图：它同样不走 WebP 重编码管线", () => {
    expect(
      collectCoverAssets({ coverLarge: "", coverSmall: "", packArt: "pack-art/c.webp" }),
    ).toEqual(["pack-art/c.webp"])
    // 去重口径与封面一致（同一个文件被两处引用时只传一次）。
    expect(
      collectCoverAssets({
        coverLarge: "covers/a.png",
        coverSmall: "",
        packArt: "covers/a.png",
      }),
    ).toEqual(["covers/a.png"])
  })
})

describe("collectPackAssets", () => {
  it("collectPackAssets 不收集封面", () => {
    const pack = { cards: [], hiddenCards: [], back: null, coverLarge: "covers/a.png", coverSmall: "" }
    expect(collectPackAssets(pack)).toEqual([])
  })

  it("合并所有卡片、隐藏款与背面的资源路径且去重", () => {
    const pack = {
      cards: [card],
      hiddenCards: [card],
      back: { front: "assets/back/front.png", effects: [], layers: [] },
    } as unknown as Pack
    const rels = collectPackAssets(pack)
    expect(new Set(rels)).toEqual(
      new Set([
        "assets/cards/c1/front.png",
        "assets/cards/c1/masks/l1.png",
        "assets/back/front.png",
      ]),
    )
    expect(rels.length).toBe(new Set(rels).size)
  })
})
