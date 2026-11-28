/**
 * `collectCardRels` 委托给 schema 的资源收集：图片、法线、蒙版、擦除全部来自图层。
 */
import { describe, it, expect } from "vitest"
import type { Card, Effect, Layer } from "@prismwright/schema"
import { collectCardRels } from "../resources"

const im = (path: string): Effect => ({
  kind: "imageMask",
  id: "im",
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

const img = (path: string, normalPath = ""): Effect => ({
  kind: "image",
  id: "img",
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

const layer = (id: string, effects: Effect[] = []): Layer => ({
  id,
  name: "",
  children: [],
  enabled: true,
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

describe("collectCardRels", () => {
  it("按图层顺序收集图片与蒙版的非空路径", () => {
    expect(collectCardRels(card)).toEqual([
      "assets/cards/c1/front.png",
      "assets/cards/c1/masks/l1.png",
    ])
  })

  it("收集图片法线贴图", () => {
    const withNormal: Card = {
      ...card,
      layers: [layer("bg", [img("assets/cards/c1/pic.png", "assets/cards/c1/pic-n.png")])],
    }
    expect(collectCardRels(withNormal)).toEqual([
      "assets/cards/c1/pic.png",
      "assets/cards/c1/pic-n.png",
    ])
  })

  it("空路径被跳过", () => {
    const empty: Card = {
      ...card,
      layers: [layer("l1", [img(""), im("")])],
    }
    expect(collectCardRels(empty)).toEqual([])
  })
})
