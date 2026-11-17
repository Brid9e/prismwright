/**
 * 卡册排版的纯逻辑测试。
 *
 * 对话框只负责拖动与渲染；「哪张卡落在第几页第几格」全部由这里决定。
 * 位置是数据，错一格就会在用户的小程序卡册里错位，所以用测试钉死。
 */
import { describe, expect, it } from "vitest"
import {
  appendPage,
  clearSlot,
  emptyPage,
  normalizePages,
  placeCard,
  removePage,
  toAlbum,
  unplacedCardIds,
} from "../album"

const CARDS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"]

/** 一页 9 格：`id` 落在指定格，其余留空。 */
function page(placements: Record<number, string | null> = {}): (string | null)[] {
  const slots = new Array<string | null>(9).fill(null)
  for (const [slot, id] of Object.entries(placements)) slots[Number(slot)] = id
  return slots
}

const cells = (pages: (string | null)[][], p = 0) => pages[p]

describe("normalizePages", () => {
  it("没有排版时给一页 9 个空格", () => {
    expect(normalizePages(undefined, CARDS)).toEqual([emptyPage()])
    expect(normalizePages([], CARDS)).toEqual([emptyPage()])
  })

  it("把每一页补齐到 9 格并保留固定位置", () => {
    expect(normalizePages([["c2", "c1"]], CARDS)).toEqual([page({ 0: "c2", 1: "c1" })])
  })

  it("丢掉系列里已经不存在的卡", () => {
    expect(normalizePages([["ghost", "c1"]], CARDS)).toEqual([page({ 1: "c1" })])
  })

  it("同一张卡排了多次只认第一次", () => {
    expect(normalizePages([["c1", "c1"], ["c1"]], CARDS)).toEqual([page({ 0: "c1" }), emptyPage()])
  })

  it("不修改传入的数组", () => {
    const source = [["c1"]]
    normalizePages(source, CARDS)
    expect(source).toEqual([["c1"]])
  })
})

describe("placeCard", () => {
  it("从托盘放进空格", () => {
    const next = placeCard([emptyPage()], "c3", 0, 4)
    expect(cells(next)[4]).toBe("c3")
  })

  it("放进已占用的格子时，原卡退回托盘", () => {
    const next = placeCard([page({ 0: "c1" })], "c2", 0, 0)
    expect(cells(next)).toEqual(page({ 0: "c2" }))
    expect(unplacedCardIds(next, CARDS)).toContain("c1")
  })

  it("格子之间拖动是交换位置", () => {
    const next = placeCard([page({ 0: "c1", 8: "c2" })], "c1", 0, 8)
    expect(cells(next)[0]).toBe("c2")
    expect(cells(next)[8]).toBe("c1")
  })

  it("拖回自己原来的格子不产生变化", () => {
    const before = [page({ 2: "c1" })]
    expect(placeCard(before, "c1", 0, 2)).toEqual(before)
  })

  it("跨页拖动也会把源格清空", () => {
    const before = [page({ 0: "c1" }), emptyPage()]
    const next = placeCard(before, "c1", 1, 0)
    expect(cells(next, 0)[0]).toBe(null)
    expect(cells(next, 1)[0]).toBe("c1")
  })
})

describe("clearSlot / 页管理", () => {
  it("把格子里的卡放回托盘", () => {
    const next = clearSlot([page({ 3: "c1" })], 0, 3)
    expect(cells(next)[3]).toBe(null)
    expect(unplacedCardIds(next, CARDS)).toContain("c1")
  })

  it("追加一页空格", () => {
    expect(appendPage([page({ 0: "c1" })])).toHaveLength(2)
    expect(cells(appendPage([page({ 0: "c1" })]), 1)).toEqual(emptyPage())
  })

  it("删除页面时该页的卡回到托盘；删光后仍留一页", () => {
    const next = removePage([page({ 0: "c1" }), page({ 0: "c2" })], 1)
    expect(next).toHaveLength(1)
    expect(unplacedCardIds(next, CARDS)).toContain("c2")

    expect(removePage([emptyPage()], 0)).toEqual([emptyPage()])
  })
})

describe("unplacedCardIds", () => {
  it("按系列里的原始顺序返回未归档的卡", () => {
    expect(unplacedCardIds([page({ 0: "c2", 1: "c1" })], CARDS)).toEqual([
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "c10",
    ])
  })
})

describe("toAlbum", () => {
  it("存盘时补满 9 格并去掉末尾的空页", () => {
    const album = toAlbum([page({ 0: "c1" }), emptyPage(), emptyPage()])
    expect(album).toEqual({ pages: [page({ 0: "c1" })] })
  })

  it("一张都没排时存空排版，交给小程序按顺序补位", () => {
    expect(toAlbum([emptyPage()])).toEqual({ pages: [] })
  })

  it("中间的空页保留，作者可以用它留白", () => {
    const album = toAlbum([page({ 0: "c1" }), emptyPage(), page({ 0: "c2" })])
    expect(album.pages).toHaveLength(3)
  })
})
