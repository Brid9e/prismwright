/**
 * 卡面资源收集的纯函数测试（`collectFaceAssets` / `collectCardAssets` / `collectPackAssets`）。
 *
 * 卡面本身已没有独立前景图：图片、图片法线、蒙版与擦除全部来自图层效果列表。这里覆盖：
 * - 图层 image / image 法线 / imageMask / maskErase 的非空路径被收集，空串跳过；
 * - 子层递归；
 * - 整个系列合并普通卡片、隐藏款、背面并去重。
 */
import { describe, it, expect } from "vitest"
import type { Card, Effect, Layer } from "../types"
import {
  collectCardAssets,
  collectCoverAssets,
  collectFaceAssets,
} from "../assets"

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
    fit: "stretch",
  },
})

const erase = (path: string, id = "er"): Effect => ({
  kind: "maskErase",
  id,
  enabled: true,
  params: { path },
})

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

const layer = (id: string, effects: Effect[] = [], children: Layer[] = []): Layer => ({
  id,
  name: "",
  children,
  enabled: true,
  locked: false,
  holoMix: 0.9,
  holoAlpha: 1,
  blend: "normal",
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
  baseColor: "#282830",
  finish: "standard",
  glassStrength: 0.6,
  glassRoughness: 0.15,
  glassTint: "#ffffff",
  cornerRadius: 0.06,
  layers: [
    layer("bg", [img("assets/cards/c1/front.png")]),
    layer("l1", [im("assets/cards/c1/masks/l1.png")]),
    layer("l2"),
  ],
}

describe("collectCardAssets", () => {
  it("按图层顺序收集图片与蒙版的非空路径，跳过空串", () => {
    expect(collectCardAssets(card)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("path 为空的 image / imageMask / maskErase 被跳过", () => {
    const empty: Card = {
      ...card,
      layers: [layer("l1", [img(""), im(""), erase("")])],
    }
    expect(collectCardAssets(empty)).toEqual([])
  })

  it("收集图片效果的法线贴图路径（紧跟图片之后）", () => {
    const withNormal: Card = {
      ...card,
      layers: [
        layer("bg", [img("assets/cards/c1/pic.png", "img", "assets/cards/c1/pic-n.png")]),
      ],
    }
    expect(collectCardAssets(withNormal)).toEqual([
      "assets/cards/c1/pic.png",
      "assets/cards/c1/pic-n.png",
    ])
  })

  it("图层效果里的 maskErase 路径也被收集", () => {
    const withErase: Card = {
      ...card,
      layers: [layer("l1", [im("assets/cards/c1/masks/l1.png"), erase("assets/cards/c1/layers/l1.png")])],
    }
    expect(collectCardAssets(withErase)).toEqual([
      "assets/cards/c1/masks/l1.png",
      "assets/cards/c1/layers/l1.png",
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
  it("空图层列表不产出空串", () => {
    expect(collectFaceAssets({ ...card, layers: [] })).toEqual([])
  })
})

describe("collectCoverAssets", () => {
  it("按大、小顺序收集非空路径并去重", () => {
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
  })
})
