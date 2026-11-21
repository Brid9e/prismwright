/**
 * 资源路径收集（`collectCardRels` / `collectPackRels`）的纯函数测试。
 *
 * 覆盖用例：
 * - 单张卡片：收集卡面图与非空的 imageMask 路径，跳过空串；
 * - 卡面自身的 imageMask 也被收集；
 * - 整个系列：合并普通卡片、隐藏款、背面的资源路径并去重。
 *
 * 本模块为纯函数、无副作用、无 IO，故无需 mock 任何依赖。
 */
import { describe, it, expect } from "vitest"
import type { Card, Effect, Layer, Pack } from "@cardbara/schema"
import { collectCardRels, collectPackRels } from "../resources"

/** 一条启用中的 imageMask 效果（默认 line 模式、不反转）；path 为空即「已添加未选图」。 */
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
    followFront: false,
    fit: "stretch",
  },
})

/** 一条启用中的 maskErase 效果（整卡擦除图）；path 为空即「已添加但还没画」。 */
const erase = (path: string, id = "er"): Effect => ({
  kind: "maskErase",
  id,
  enabled: true,
  params: { path },
})

/** 一条启用中的 image 效果；path 为空即「已添加未选图」。 */
const img = (path: string, id = "img"): Effect => ({
  kind: "image",
  id,
  enabled: true,
  params: { path, x: 0, y: 0, rotation: 0, scale: 1, fit: "contain", followFront: false, bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false },
})

/** 造一个最小可用图层：只参数化 id 与效果列表（图蒙版即挂在效果列表里），其余取无副作用的默认。 */
const layer = (id: string, effects: Effect[] = []): Layer => ({
  id,
  name: "",
  children: [],
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
  // 底图调整字段：本测试只收集资源路径，取 schema 默认值即可。
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
  // 卡面自身不挂图蒙版；本测试只收集资源路径。
  effects: [],
  layers: [
    // l1 挂了图蒙版（应被收集）；l2 无图蒙版（应被跳过）。
    layer("l1", [im("assets/cards/c1/masks/l1.png")]),
    layer("l2"),
  ],
}

describe("collectCardRels", () => {
  it("收集卡面图与各层 imageMask 的非空路径，跳过空串", () => {
    expect(collectCardRels(card)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("卡面自身的 imageMask 也被收集（排在图层蒙版之前）", () => {
    const withFaceMask: Card = { ...card, effects: [im("assets/cards/c1/masks/face.png")] }
    expect(collectCardRels(withFaceMask)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/face.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("path 为空的 imageMask（已添加未选图）被跳过", () => {
    const emptyMask: Card = { ...card, effects: [im("")], layers: [layer("l1", [im("")])] }
    expect(collectCardRels(emptyMask)).toEqual(["assets/cards/c1/front.png"])
  })

  it("收集图层 image 效果的非空路径（排在蒙版之后）", () => {
    const withImage: Card = {
      ...card,
      layers: [layer("l1", [im("assets/cards/c1/masks/l1.png"), img("assets/cards/c1/pic.png")])],
    }
    expect(collectCardRels(withImage)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
      "assets/cards/c1/pic.png",
    ])
  })

  it("path 为空的 image 被跳过", () => {
    const emptyImage: Card = { ...card, layers: [layer("l1", [img("")])] }
    expect(collectCardRels(emptyImage)).toEqual(["assets/cards/c1/front.png"])
  })

  // 法线贴图是独立资源：删除卡片时要一并进回收站，否则撤销合并 / 删除后它成了孤儿文件。
  it("收集卡面与图片效果的法线贴图", () => {
    const withNormal: Card = {
      ...card,
      frontNormalPath: "assets/cards/c1/normal.png",
      layers: [
        layer("l1", [
          { ...img("assets/cards/c1/pic.png"), params: { ...(img("").params as object), path: "assets/cards/c1/pic.png", normalPath: "assets/cards/c1/pic-n.png" } } as Effect,
        ]),
      ],
    }
    expect(collectCardRels(withNormal)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/normal.png",
      "assets/cards/c1/pic.png",
      "assets/cards/c1/pic-n.png",
    ])
  })

  it("收集卡面 maskErase 的擦除图（紧跟在卡面图蒙版之后）", () => {
    const withErase: Card = {
      ...card,
      effects: [im("assets/cards/c1/masks/face.png"), erase("assets/cards/c1/erase.png")],
    }
    expect(collectCardRels(withErase)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/face.png",
      "assets/cards/c1/erase.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("path 为空的 maskErase（还没画）被跳过", () => {
    const emptyErase: Card = { ...card, effects: [erase("")] }
    expect(collectCardRels(emptyErase)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  // 图层自己的擦除图也是该卡面引用的资源：漏收会让删除卡片时的回收站漏掉它。
  it("图层效果里的 maskErase 路径也被收集", () => {
    const withLayerErase: Card = {
      ...card,
      layers: [
        layer("l1", [im("assets/cards/c1/masks/l1.png"), erase("assets/cards/c1/layers/l1.png")]),
        layer("l2"),
      ],
    }
    expect(collectCardRels(withLayerErase)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
      "assets/cards/c1/layers/l1.png",
    ])
  })
})

describe("collectPackRels", () => {
  it("合并所有卡片、隐藏款与背面的资源路径且去重", () => {
    const pack = {
      cards: [card],
      hiddenCards: [card],
      back: { front: "assets/back/front.png", effects: [], layers: [] },
    } as unknown as Pack
    const rels = collectPackRels(pack)
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
