/**
 * 卡片库过滤的纯函数契约。
 *
 * 搜索同时匹配「名字」和「编号」，是卡片库最容易含糊的一处：编号在界面上显示为数字，
 * 但用户常按 `e01` 这样的习惯输入；分组切换与搜索又必须正交（在「隐藏款」里搜名字，
 * 不能把普通卡也搜出来）。
 */
import { describe, it, expect } from "vitest"
import { filterCards } from "../cardFilter"

interface Item {
  id: string
  num: number
  name: string
}

const groups = {
  cards: [
    { id: "a", num: 1, name: "星轨旅人" },
    { id: "b", num: 2, name: "Star Wanderer" },
  ],
  hiddenCards: [{ id: "c", num: 101, name: "无垠之门" }],
} satisfies { cards: Item[]; hiddenCards: Item[] }

const ids = (list: Item[]) => list.map((card) => card.id)

describe("filterCards", () => {
  it("空查询返回当前分组的全部卡片", () => {
    expect(ids(filterCards(groups, { query: "", section: "all" }))).toEqual(["a", "b", "c"])
    expect(ids(filterCards(groups, { query: "   ", section: "all" }))).toEqual(["a", "b", "c"])
  })

  it("按名字匹配，大小写不敏感", () => {
    expect(ids(filterCards(groups, { query: "星轨", section: "all" }))).toEqual(["a"])
    expect(ids(filterCards(groups, { query: "star", section: "all" }))).toEqual(["b"])
  })

  it("按编号匹配，也接受 e 前缀写法", () => {
    expect(ids(filterCards(groups, { query: "101", section: "all" }))).toEqual(["c"])
    expect(ids(filterCards(groups, { query: "e2", section: "all" }))).toEqual(["b"])
  })

  it("分组与搜索正交：隐藏款里搜普通卡的名字得到空", () => {
    expect(ids(filterCards(groups, { query: "星轨", section: "hidden" }))).toEqual([])
    expect(ids(filterCards(groups, { query: "", section: "hidden" }))).toEqual(["c"])
  })

  it("卡背分组不返回卡片（卡背是系列级对象，不是卡片）", () => {
    expect(filterCards(groups, { query: "", section: "back" })).toEqual([])
    expect(filterCards(groups, { query: "星轨", section: "back" })).toEqual([])
  })
})
