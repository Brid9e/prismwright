import { describe, it, expect } from "vitest"
import { newId, createLayer, createCard, createCardFace, createEmptyPack } from "../defaults"

describe("newId", () => {
  it("生成互不相同的 id", () => {
    expect(newId()).not.toBe(newId())
  })
})

describe("createLayer", () => {
  it("生成含完整默认字段的图层", () => {
    const layer = createLayer("图层 1")
    // 新建层默认「正常」叠加；而 schema 对**缺失** blend 字段的兜底仍是 "add"（不动存量数据）。
    expect(layer.blend).toBe("normal")
    expect(layer.enabled).toBe(true)
    expect(layer.effects).toEqual([])
    // 默认名是**数据**，创建时就定下来：拖动重排不会改它，界面也不必再按位置拼名字。
    expect(layer.name).toBe("图层 1")
  })
})

describe("createCard", () => {
  it("默认带一个图层", () => {
    const card = createCard(1, "图层 1")
    expect(card.num).toBe(1)
    expect(card.layers).toHaveLength(1)
    expect(card.layers[0].name).toBe("图层 1")
  })

  it("多次创建 id 唯一", () => {
    expect(createCard(1, "图层 1").id).not.toBe(createCard(2, "图层 1").id)
  })
})

describe("createCardFace", () => {
  it("产出字段完整的空卡面：只有底色 / 形状 / 空图层", () => {
    const face = createCardFace()
    expect(face.baseColor).toBe("#282830")
    expect(face.layers).toEqual([])
  })
})

describe("createEmptyPack", () => {
  it("生成合法空系列，版本为 9", () => {
    const pack = createEmptyPack("星辰之约")
    expect(pack.schemaVersion).toBe(10)
    expect(pack.editorVersion).toBe("v1")
    expect(pack.name).toBe("星辰之约")
    expect(pack.cards).toEqual([])
    expect(pack.hiddenCards).toEqual([])
    expect(pack.back).toBeNull()
    expect(pack.createdAt).toBe(pack.updatedAt)
    expect(Number.isNaN(Date.parse(pack.createdAt))).toBe(false)
  })

  it("写入调用方给的编辑器版本", () => {
    expect(createEmptyPack("P", "v2").editorVersion).toBe("v2")
  })
})
