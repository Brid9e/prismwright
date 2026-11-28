import { describe, it, expect } from "vitest"
import { LayerSchema, CardSchema, MAX_NEST_DEPTH } from "../schema"

describe("Layer.children 递归结构", () => {
  it("缺省解析为空数组", () => {
    expect(LayerSchema.parse({ id: "l1" }).children).toEqual([])
  })

  it("递归解析子层，并把子层的缺省字段补齐", () => {
    const layer = LayerSchema.parse({
      id: "p",
      children: [
        { id: "c1", blend: "normal" },
        { id: "c2", children: [{ id: "g1" }] },
      ],
    })
    expect(layer.children).toHaveLength(2)
    expect(layer.children[0].blend).toBe("normal")
    expect(layer.children[1].children[0].id).toBe("g1")
    expect(layer.children[1].children[0].children).toEqual([])
  })

  it("旧数据（无 children）解析后仍合法，效果不变", () => {
    // 0.1.0 写出的 pack.json 里没有 children 字段：解析后取默认 []，不报错。
    const card = CardSchema.parse({ id: "c1", num: 1, name: "旧卡", layers: [{ id: "l1" }] })
    expect(card.layers[0].children).toEqual([])
  })

  it("MAX_NEST_DEPTH 为 4", () => {
    expect(MAX_NEST_DEPTH).toBe(4)
  })
})

describe("图层锁定", () => {
  it("缺省 locked=false，显式 true 可解析", () => {
    expect(LayerSchema.parse({ id: "l1" }).locked).toBe(false)
    expect(LayerSchema.parse({ id: "l1", locked: true }).locked).toBe(true)
  })
})
