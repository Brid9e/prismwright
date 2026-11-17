/**
 * 抽卡概率纯逻辑的行为测试。
 *
 * 这些函数的语义必须和云函数的 `pickDraw` 一致——服务端不认「给个大概」，
 * 空表、0 权重、没有该稀有度的卡，三种情况的分支各不相同。
 */
import { describe, it, expect } from "vitest"
import { createCard, createEmptyPack, type Pack } from "@cardbara/schema"
import {
  probabilityIssues,
  probabilityPercents,
  sameProbabilities,
  sanitizeProbabilities,
  tierCardCount,
  tierCounts,
  weightsOf,
} from "../probability"

describe("weightsOf", () => {
  it("补齐缺省档位为 0，丢掉服务端不认识的键", () => {
    expect(weightsOf({ rare: 3 })).toEqual({
      common: 0,
      rare: 3,
      epic: 0,
      legendary: 0,
      hidden: 0,
    })
  })

  it("负数与非数值按 0 处理", () => {
    expect(weightsOf({ common: -1, rare: Number.NaN, epic: 2 })).toEqual({
      common: 0,
      rare: 0,
      epic: 2,
      legendary: 0,
      hidden: 0,
    })
  })

  it("空表（老系列）给出五档全 0", () => {
    expect(weightsOf({})).toEqual({ common: 0, rare: 0, epic: 0, legendary: 0, hidden: 0 })
  })
})

describe("sanitizeProbabilities", () => {
  it("只写正权重档位", () => {
    expect(sanitizeProbabilities({ common: 70, rare: 0, epic: 8, legendary: 2, hidden: 0 })).toEqual(
      { common: 70, epic: 8, legendary: 2 },
    )
  })

  it("全 0 落成空表——空表就是「按卡数均匀」", () => {
    expect(
      sanitizeProbabilities({ common: 0, rare: 0, epic: 0, legendary: 0, hidden: 0 }),
    ).toEqual({})
  })

  it("负权重不会被写进记录", () => {
    expect(
      sanitizeProbabilities({ common: -3, rare: 1, epic: 0, legendary: 0, hidden: 0 }),
    ).toEqual({ rare: 1 })
  })
})

describe("sameProbabilities", () => {
  it("缺省与 0 等价", () => {
    expect(sameProbabilities({}, { rare: 0 })).toBe(true)
  })

  it("任一档数值变化即不等价", () => {
    expect(sameProbabilities({ rare: 1 }, { rare: 2 })).toBe(false)
  })

  it("多出来的未知键不影响判定（服务端也不看它）", () => {
    expect(sameProbabilities({ rare: 1, mythic: 5 }, { rare: 1 })).toBe(true)
  })
})

describe("probabilityPercents", () => {
  it("按总和归一，保留一位小数", () => {
    expect(probabilityPercents({ common: 70, rare: 20, epic: 8, legendary: 2, hidden: 0 })).toEqual(
      { common: 70, rare: 20, epic: 8, legendary: 2, hidden: 0 },
    )
    expect(probabilityPercents({ common: 3, rare: 0, epic: 0, legendary: 0, hidden: 0 })).toEqual({
      common: 100,
      rare: 0,
      epic: 0,
      legendary: 0,
      hidden: 0,
    })
  })

  it("小数权重也折算成百分比（0.5 / 99.5 → 0.5% / 99.5%）", () => {
    expect(
      probabilityPercents({ common: 0.5, rare: 99.5, epic: 0, legendary: 0, hidden: 0 }),
    ).toEqual({ common: 0.5, rare: 99.5, epic: 0, legendary: 0, hidden: 0 })
  })

  it("全 0 时全部是 0（服务端此时走按卡数均匀）", () => {
    expect(
      probabilityPercents({ common: 0, rare: 0, epic: 0, legendary: 0, hidden: 0 }),
    ).toEqual({ common: 0, rare: 0, epic: 0, legendary: 0, hidden: 0 })
  })
})

describe("tierCardCount", () => {
  /** 造一个带 n 张普通卡（rarity 指定）与 m 张隐藏卡的系列。 */
  function packWith(spec: Array<"common" | "rare" | "epic" | "legendary">, hidden: number): Pack {
    const pack = createEmptyPack("P")
    let num = 1
    for (const rarity of spec) {
      const card = createCard(num++, "图层 1")
      card.rarity = rarity
      pack.cards.push(card)
    }
    for (let i = 0; i < hidden; i++) pack.hiddenCards.push(createCard(num++, "图层 1"))
    return pack
  }

  it("普通档按稀有度数卡", () => {
    const pack = packWith(["common", "common", "legendary"], 0)
    expect(tierCardCount(pack, "common")).toBe(2)
    expect(tierCardCount(pack, "rare")).toBe(0)
    expect(tierCardCount(pack, "legendary")).toBe(1)
  })

  it("隐藏档数的是 hiddenCards 整组，与卡的 rarity 无关", () => {
    const pack = packWith(["common"], 3)
    expect(tierCardCount(pack, "hidden")).toBe(3)
  })

  it("未打开系列时为 0", () => {
    expect(tierCardCount(null, "common")).toBe(0)
  })

  describe("probabilityIssues", () => {
    const ZERO = { common: 0, rare: 0, epic: 0, legendary: 0, hidden: 0 }

    it("有隐藏卡却给 0 权重：报「永远抽不到」", () => {
      expect(probabilityIssues({ ...ZERO, common: 100 }, packWith(["common"], 2))).toEqual([
        { kind: "hiddenUnreachable", cards: 2 },
      ])
    })

    it("权重全 0 时不重复报隐藏卡——那是「按卡数均匀」的整体语义", () => {
      expect(probabilityIssues(ZERO, packWith(["common"], 2))).toEqual([])
    })

    it("给没有卡的档位填权重：报该档为空（服务端会兜底到全部卡片）", () => {
      expect(probabilityIssues({ ...ZERO, epic: 10, hidden: 1 }, packWith(["common"], 1))).toEqual([
        { kind: "tierEmpty", tier: "epic" },
      ])
    })

    it("权重与卡池对齐时没有提示", () => {
      expect(
        probabilityIssues({ common: 90, rare: 0, epic: 0, legendary: 0, hidden: 10 }, packWith(["common"], 1)),
      ).toEqual([])
    })
  })
})

describe("tierCounts", () => {
  it("按稀有度统计普通卡，隐藏卡整组计入 hidden", () => {
    const cards = [
      { rarity: "common" },
      { rarity: "common" },
      { rarity: "legendary" },
      { rarity: "unknown" },
    ]
    expect(tierCounts(cards, 2)).toEqual({
      common: 2,
      rare: 0,
      epic: 0,
      legendary: 1,
      hidden: 2,
    })
  })
})
