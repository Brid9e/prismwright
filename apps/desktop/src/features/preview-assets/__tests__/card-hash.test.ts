import { describe, it, expect } from "vitest"
import type { Card, Layer } from "@prismwright/schema"
import {
  GENERATE_VIDEO_PREVIEW,
  RENDER_SPEC_VERSION,
  cardRenderHash,
  hash53,
  staleCards,
} from "../card-hash"

const ASPECT = 2.5 / 3.5

function sampleLayer(): Layer {
  return {
    id: "l1",
    name: "图层 1",
    enabled: true,
    locked: false,
    holoMix: 0.9,
    holoAlpha: 1,
    blend: "normal",
    opacity: 1,
    kind: "normal",
    text: null,
    effects: [
      {
        id: "e1",
        enabled: true,
        kind: "moire",
        params: {
          mode: "parallel",
          angle: 26.6,
          density: 12,
          depth: 0.25,
          twist: 0,
          twistSeed: 0,
          contentRelief: 1,
        },
      },
    ],
    children: [],
  }
}

function sampleCard(): Card {
  return {
    id: "c1",
    num: 1,
    name: "卡名",
    notes: "备注",
    rarity: "common",
    baseColor: "#282830",
    finish: "standard",
    glassStrength: 0.6,
    glassRoughness: 0.15,
    glassTint: "#ffffff",
    cornerRadius: 0.06,
    layers: [sampleLayer()],
  }
}

describe("hash53", () => {
  it("同输入必同输出（确定性）", () => {
    expect(hash53("prismwright")).toBe(hash53("prismwright"))
  })

  it("不同输入几乎不撞", () => {
    expect(hash53("a")).not.toBe(hash53("b"))
    expect(hash53("abc")).not.toBe(hash53("abd"))
  })

  it("种子不同则输出不同", () => {
    expect(hash53("same", 0)).not.toBe(hash53("same", 1))
  })
})

describe("cardRenderHash", () => {
  it("同一张卡多次调用得到同一哈希", () => {
    expect(cardRenderHash(sampleCard(), ASPECT)).toBe(cardRenderHash(sampleCard(), ASPECT))
  })

  it("改图层内容 / 图层效果参数必变", () => {
    const base = cardRenderHash(sampleCard(), ASPECT)
    const renamed = sampleCard()
    renamed.layers[0].name = "别的名字"
    expect(cardRenderHash(renamed, ASPECT)).not.toBe(base)

    const changed = sampleCard()
    const moire = changed.layers[0].effects[0]
    if (moire.kind === "moire") moire.params.depth = 0.4
    expect(cardRenderHash(changed, ASPECT)).not.toBe(base)
  })

  it("改卡名 / 备注 / 稀有度**不**变（它们不进渲染）", () => {
    const base = cardRenderHash(sampleCard(), ASPECT)
    expect(cardRenderHash({ ...sampleCard(), name: "别的名字" }, ASPECT)).toBe(base)
    expect(cardRenderHash({ ...sampleCard(), notes: "别的备注" }, ASPECT)).toBe(base)
    expect(cardRenderHash({ ...sampleCard(), rarity: "legendary" }, ASPECT)).toBe(base)
  })

  it("哈希里折入了渲染规格版本与视频开关", () => {
    const card = sampleCard()
    const canonical = (v: number, video: boolean) =>
      hash53(
        JSON.stringify({
          v,
          video,
          baseColor: card.baseColor,
          finish: card.finish,
          glassStrength: card.glassStrength,
          glassRoughness: card.glassRoughness,
          glassTint: card.glassTint,
          aspect: ASPECT,
          cornerRadius: card.cornerRadius,
          layers: card.layers,
        }),
      )
    expect(cardRenderHash(card, ASPECT)).toBe(
      canonical(RENDER_SPEC_VERSION, GENERATE_VIDEO_PREVIEW),
    )
    expect(cardRenderHash(card, ASPECT)).not.toBe(
      canonical(RENDER_SPEC_VERSION + 1, GENERATE_VIDEO_PREVIEW),
    )
    expect(cardRenderHash(card, ASPECT)).not.toBe(
      canonical(RENDER_SPEC_VERSION, !GENERATE_VIDEO_PREVIEW),
    )
  })
})

describe("staleCards", () => {
  it("清单缺失该卡时判为待生成", () => {
    const card = sampleCard()
    expect(staleCards([card], {}, ASPECT)).toEqual([card])
  })

  it("清单哈希与当前内容一致时跳过", () => {
    const card = sampleCard()
    expect(staleCards([card], { c1: cardRenderHash(card, ASPECT) }, ASPECT)).toEqual([])
  })

  it("清单哈希过时（内容已改）时判为待生成", () => {
    const card = sampleCard()
    expect(staleCards([card], { c1: "stale-hash" }, ASPECT)).toEqual([card])
  })

  it("只挑出待生成的卡，且保持入参顺序", () => {
    const a = sampleCard()
    const b = { ...sampleCard(), id: "c2" }
    const c = { ...sampleCard(), id: "c3" }
    const manifest = { c1: cardRenderHash(a, ASPECT), c3: cardRenderHash(c, ASPECT) }
    expect(staleCards([a, b, c], manifest, ASPECT)).toEqual([b])
  })
})

describe("卡面外观也进哈希", () => {
  it("改系列宽高比必变", () => {
    expect(cardRenderHash(sampleCard(), 1)).not.toBe(cardRenderHash(sampleCard(), ASPECT))
  })

  it("改圆角 / 底色 / 玻璃参数必变", () => {
    const base = cardRenderHash(sampleCard(), ASPECT)
    for (const changed of [
      { ...sampleCard(), cornerRadius: 0.2 },
      { ...sampleCard(), baseColor: "#88ccff" },
      { ...sampleCard(), finish: "glass" as const },
      { ...sampleCard(), glassStrength: 0.9 },
      { ...sampleCard(), glassRoughness: 0.5 },
      { ...sampleCard(), glassTint: "#88ccff" },
    ]) {
      expect(cardRenderHash(changed, ASPECT)).not.toBe(base)
    }
  })
})
