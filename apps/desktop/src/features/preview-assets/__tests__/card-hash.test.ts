/**
 * 卡面渲染哈希与「待生成卡片」筛选的行为测试。
 *
 * 这两者是「只重算变过的卡」这一省算力策略的判据，性质必须钉死：
 * - **稳定**：同一内容在任意会话、任意调用点都产出同一串，否则每次打开都会误判为「变过」而全量重渲；
 * - **恰好覆盖渲染相关字段**：改卡名 / 备注 / 稀有度不该重渲（一张卡要渲 60 帧），改卡面图 / 效果 /
 *   图层却必须重渲。
 *
 * 均为纯函数，node 环境可直接覆盖。
 */
import { describe, it, expect } from "vitest"
import type { Card, Layer } from "@cardbara/schema"
import {
  GENERATE_VIDEO_PREVIEW,
  RENDER_SPEC_VERSION,
  cardRenderHash,
  hash53,
  staleCards,
} from "../card-hash"

/** 测试用的系列宽高比（5:7）。比例在系列上，由调用方随卡片一起传进来。 */
const ASPECT = 2.5 / 3.5

/** 一张内容齐备的卡：带卡面图、一条 moire 效果与一个图层，便于验证各类字段变动对哈希的影响。 */
function sampleCard(): Card {
  return {
    id: "c1",
    num: 1,
    name: "卡名",
    notes: "备注",
    rarity: "common",
    front: "assets/front.png",
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
    cornerRadius: 0.06,
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
          faceStrength: 0,
        },
      },
    ],
    layers: [],
  }
}

/** 一个最小可用图层。 */
function sampleLayer(): Layer {
  return {
    id: "l1",
    name: "图层 1",
    enabled: true,
    holoMix: 0.9,
    holoAlpha: 1,
    blend: "add",
    opacity: 1,
    kind: "normal",
    text: null,
    effects: [],
    children: [],
  }
}

describe("hash53", () => {
  it("同输入必同输出（确定性）", () => {
    expect(hash53("cardbara")).toBe(hash53("cardbara"))
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

  it("改卡面图必变", () => {
    const changed = { ...sampleCard(), front: "assets/other.png" }
    expect(cardRenderHash(changed, ASPECT)).not.toBe(cardRenderHash(sampleCard(), ASPECT))
  })

  it("改效果必变（含仅改参数）", () => {
    const changed = sampleCard()
    changed.effects[0] = {
      id: "e1",
      enabled: true,
      kind: "moire",
      params: { mode: "parallel", angle: 30, density: 12, depth: 0.25, twist: 0, twistSeed: 0, faceStrength: 0 },
    }
    expect(cardRenderHash(changed, ASPECT)).not.toBe(cardRenderHash(sampleCard(), ASPECT))
  })

  it("改图层必变", () => {
    const changed = { ...sampleCard(), layers: [sampleLayer()] }
    expect(cardRenderHash(changed, ASPECT)).not.toBe(cardRenderHash(sampleCard(), ASPECT))
  })

  // 填充方式与偏移直接改底图取样，却不住在 `front` 里——漏折进哈希的后果是「换了填充方式，
  // 预览与展柜缩略图还是旧画面」，而且要等到下次有别的原因触发重渲才更新。
  it("改填充方式 / 偏移 / 缩放 / 旋转必变", () => {
    const base = cardRenderHash(sampleCard(), ASPECT)
    expect(cardRenderHash({ ...sampleCard(), frontFit: "contain" }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontOffsetX: 0.1 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontOffsetY: -0.1 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontScale: 1.5 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontRotation: 15 }, ASPECT)).not.toBe(base)
  })

  // 法线直接改光泽 / 摩尔纹 / 刻纹的走势：漏折进哈希同样会停在旧画面。
  it("改法线参数必变", () => {
    const base = cardRenderHash(sampleCard(), ASPECT)
    expect(cardRenderHash({ ...sampleCard(), frontBumpStrength: 0.5 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontBumpDetail: 0.03 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontBumpFlow: 0.2 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontBumpLight: 0.3 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontBumpLightAngle: -45 }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontBumpLightColor: "#ffcc00" }, ASPECT)).not.toBe(base)
    expect(cardRenderHash({ ...sampleCard(), frontBumpInvert: true }, ASPECT)).not.toBe(base)
  })

  it("改卡名 / 备注 / 稀有度**不**变（它们不进渲染）", () => {
    const base = cardRenderHash(sampleCard(), ASPECT)
    expect(cardRenderHash({ ...sampleCard(), name: "别的名字" }, ASPECT)).toBe(base)
    expect(cardRenderHash({ ...sampleCard(), notes: "别的备注" }, ASPECT)).toBe(base)
    expect(cardRenderHash({ ...sampleCard(), rarity: "legendary" }, ASPECT)).toBe(base)
  })

  // 下面两条以 `cardRenderHash` 的规范化口径手算一份、改掉其中一个元字段，验证它确被折入哈希。
  // 手算串的**键名与顺序必须与 `card-hash.ts` 逐字一致**（`JSON.stringify` 保留插入顺序）。
  it("哈希里折入了渲染规格版本（升规格即全体失配，无需手动清缓存）", () => {
    const card = sampleCard()
    const withoutVersion = hash53(
      JSON.stringify({
        v: RENDER_SPEC_VERSION + 1,
        video: GENERATE_VIDEO_PREVIEW,
        front: card.front,
        frontFit: card.frontFit,
        frontOffsetX: card.frontOffsetX,
        frontOffsetY: card.frontOffsetY,
        frontScale: card.frontScale,
        frontRotation: card.frontRotation,
        frontBumpStrength: card.frontBumpStrength,
        frontBumpDetail: card.frontBumpDetail,
        frontBumpFlow: card.frontBumpFlow,
        frontBumpLight: card.frontBumpLight,
        frontBumpLightAngle: card.frontBumpLightAngle,
        frontBumpLightColor: card.frontBumpLightColor,
        frontBumpInvert: card.frontBumpInvert,
        aspect: ASPECT,
        cornerRadius: card.cornerRadius,
        effects: card.effects,
        layers: card.layers,
      }),
    )
    expect(cardRenderHash(card, ASPECT)).not.toBe(withoutVersion)
  })

  it("哈希里折入了「是否生成视频」开关（切换即失配，重开时能补出 WebM）", () => {
    const card = sampleCard()
    const flipped = hash53(
      JSON.stringify({
        v: RENDER_SPEC_VERSION,
        video: !GENERATE_VIDEO_PREVIEW,
        front: card.front,
        frontFit: card.frontFit,
        frontOffsetX: card.frontOffsetX,
        frontOffsetY: card.frontOffsetY,
        frontScale: card.frontScale,
        frontRotation: card.frontRotation,
        frontBumpStrength: card.frontBumpStrength,
        frontBumpDetail: card.frontBumpDetail,
        frontBumpFlow: card.frontBumpFlow,
        frontBumpLight: card.frontBumpLight,
        frontBumpLightAngle: card.frontBumpLightAngle,
        frontBumpLightColor: card.frontBumpLightColor,
        frontBumpInvert: card.frontBumpInvert,
        aspect: ASPECT,
        cornerRadius: card.cornerRadius,
        effects: card.effects,
        layers: card.layers,
      }),
    )
    expect(cardRenderHash(card, ASPECT)).not.toBe(flipped)
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

describe("卡面形状也进哈希", () => {
  it("改系列宽高比必变（否则换比例后预览 / 缩略图还是旧画面）", () => {
    expect(cardRenderHash(sampleCard(), 1)).not.toBe(cardRenderHash(sampleCard(), ASPECT))
  })

  it("改圆角必变", () => {
    const changed = { ...sampleCard(), cornerRadius: 0.2 }
    expect(cardRenderHash(changed, ASPECT)).not.toBe(cardRenderHash(sampleCard(), ASPECT))
  })
})
