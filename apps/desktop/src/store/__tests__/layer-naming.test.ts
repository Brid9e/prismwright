/**
 * 图层默认名（「图层 1」）的生成、取号与老数据补写。
 *
 * 这里跑的是**真实 i18n 资源**（不造假 t），因为这一层的职责就是「按当前语言生成一句
 * 已翻译的文案」——造假 t 会把「名字跟随语言」这条行为整个测没了。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  createCard,
  createCardFace,
  createEmptyPack,
  createLayer,
  type Pack,
} from "@cardbara/schema"
import { initI18n } from "../../i18n/init"
import {
  defaultLayerName,
  defaultTextLayerName,
  nextLayerNum,
  nextTextLayerNum,
  fillDefaultLayerNames,
} from "../layer-naming"

beforeEach(() => initI18n("zh-CN"))
afterEach(() => initI18n("zh-CN"))

describe("defaultLayerName", () => {
  it("按当前语言生成「图层 N」", () => {
    expect(defaultLayerName(1)).toBe("图层 1")
    expect(defaultLayerName(12)).toBe("图层 12")
  })

  it("跟随当前语言", () => {
    initI18n("en")
    expect(defaultLayerName(3)).toBe("Layer 3")
  })
})

describe("nextLayerNum", () => {
  it("空列表从 1 起", () => {
    expect(nextLayerNum([])).toBe(1)
  })

  it("接在已有默认名之后", () => {
    expect(nextLayerNum([{ name: "图层 1" }, { name: "图层 2" }])).toBe(3)
  })

  it("回收空出来的号：删掉中间层之后再新建也不会与现有名字撞号", () => {
    // 这两个用例是「默认名是数据」最容易踩的坑：若按层数加一取名，删掉「图层 2」之后
    // 列表里还有「图层 3」，新层就会又叫「图层 3」——两行同名，用户没法分辨。
    expect(nextLayerNum([{ name: "图层 1" }, { name: "图层 3" }])).toBe(2)
    expect(nextLayerNum([{ name: "图层 2" }, { name: "图层 3" }])).toBe(1)
  })

  it("用户自己起的名字不算序号", () => {
    expect(nextLayerNum([{ name: "描边" }, { name: "封面 2024" }])).toBe(1)
  })

  it("名字前后的空白不影响判定", () => {
    expect(nextLayerNum([{ name: " 图层 1 " }])).toBe(2)
  })
})

/** 造一个系列：一张正面卡片带指定图层名，可选一个背面。 */
function packWith(layerNames: string[], backNames: string[] = []): Pack {
  const pack = createEmptyPack("P")
  const card = createCard(1, "占位")
  card.layers = layerNames.map((name) => createLayer(name))
  pack.cards.push(card)
  if (backNames.length > 0) {
    pack.back = { ...createCardFace(), layers: backNames.map((n) => createLayer(n)) }
  }
  return pack
}

describe("fillDefaultLayerNames", () => {
  it("空名字的图层按位置补上默认名", () => {
    const pack = packWith(["", "", ""])
    expect(fillDefaultLayerNames(pack)).toBe(true)
    expect(pack.cards[0].layers.map((l) => l.name)).toEqual(["图层 1", "图层 2", "图层 3"])
  })

  it("已有名字的图层不动", () => {
    const pack = packWith(["描边", "", "封面"])
    expect(fillDefaultLayerNames(pack)).toBe(true)
    expect(pack.cards[0].layers.map((l) => l.name)).toEqual(["描边", "图层 2", "封面"])
  })

  it("只补正面、背面与隐藏款里的全部卡面", () => {
    const pack = packWith([""], [""])
    pack.hiddenCards.push(createCard(2, ""))
    expect(fillDefaultLayerNames(pack)).toBe(true)
    expect(pack.cards[0].layers[0].name).toBe("图层 1")
    expect(pack.hiddenCards[0].layers[0].name).toBe("图层 1")
    expect(pack.back!.layers[0].name).toBe("图层 1")
  })

  it("与既有默认名共存时不撞名", () => {
    // 老数据里可能已经有一层叫「图层 1」（用户改的名或历史数据），补名要绕开它。
    const pack = packWith(["", "图层 1"])
    fillDefaultLayerNames(pack)
    expect(pack.cards[0].layers.map((l) => l.name)).toEqual(["图层 2", "图层 1"])
  })

  it("没有空名字时原样返回 false（不写盘）", () => {
    const pack = packWith(["图层 1", "描边"], ["图层 1"])
    expect(fillDefaultLayerNames(pack)).toBe(false)
  })

  it("全空白的名字也算未命名", () => {
    const pack = packWith(["   "])
    fillDefaultLayerNames(pack)
    expect(pack.cards[0].layers[0].name).toBe("图层 1")
  })
})

describe("文字层的默认名", () => {
  it("按当前语言生成「文字 N」", () => {
    expect(defaultTextLayerName(1)).toBe("文字 1")
    initI18n("en")
    expect(defaultTextLayerName(2)).toBe("Text 2")
    initI18n("zh-CN")
  })

  it("与普通图层各用各的编号池，互不占用", () => {
    const layers = [{ name: "图层 1" }, { name: "文字 1" }]
    expect(nextLayerNum(layers)).toBe(2)
    expect(nextTextLayerNum(layers)).toBe(2)
    expect(nextTextLayerNum([{ name: "文字 1" }, { name: "文字 2" }])).toBe(3)
  })
})
