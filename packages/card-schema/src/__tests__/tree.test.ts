import { describe, it, expect } from "vitest"
import { LayerSchema, MAX_NEST_DEPTH } from "../schema"
import type { Layer } from "../types"
import {
  flattenLayers,
  isLayerVisible,
  findLayerById,
  findLayerLocation,
  detachLayer,
  subtreeHeight,
  ancestorChain,
  exceedsNestDepth,
} from "../tree"

/**
 * 造一棵小树：P ── A ── G，另有顶层 S。
 *
 * 注意：`LayerSchema.parse` 会**递归拷贝**子节点——若把 `g` 直接喂给 `parse({ children: [g] })`，
 * 树内节点与外部变量便不再是同一引用，`toBe` 这类身份断言必然失败。故先各自 parse 出（带默认
 * 值的）节点，再手动挂接 `children`，以保证「查找返回的就是树里的那个节点」这一语义可被断言。
 */
function tree() {
  const g: Layer = LayerSchema.parse({ id: "g" })
  const a: Layer = { ...LayerSchema.parse({ id: "a" }), children: [g] }
  const p: Layer = { ...LayerSchema.parse({ id: "p" }), children: [a] }
  const s: Layer = LayerSchema.parse({ id: "s" })
  return { layers: [p, s], p, a, g, s }
}

describe("flattenLayers", () => {
  it("深度优先：父在前、子随后", () => {
    const { layers } = tree()
    expect(flattenLayers(layers).map((e) => e.layer.id)).toEqual(["p", "a", "g", "s"])
  })

  it("带出深度、父 id 与同级下标", () => {
    const { layers } = tree()
    const byId = new Map(flattenLayers(layers).map((e) => [e.layer.id, e]))
    expect(byId.get("p")).toMatchObject({ depth: 0, parentId: null, indexInParent: 0 })
    expect(byId.get("a")).toMatchObject({ depth: 1, parentId: "p", indexInParent: 0 })
    expect(byId.get("g")).toMatchObject({ depth: 2, parentId: "a", indexInParent: 0 })
    expect(byId.get("s")).toMatchObject({ depth: 0, parentId: null, indexInParent: 1 })
    expect(byId.get("g")!.ancestors.map((l) => l.id)).toEqual(["p", "a"])
  })
})

describe("isLayerVisible", () => {
  it("禁用任一祖先即整棵子树不可见", () => {
    const { p, a } = tree()
    const disabledParent = { ...p, enabled: false }
    const entries = flattenLayers([{ ...disabledParent, children: [a] }])
    const gEntry = entries.find((e) => e.layer.id === "g")!
    expect(isLayerVisible(gEntry)).toBe(false)
  })

  it("自身启用且祖先都启用时可见", () => {
    const { layers } = tree()
    const aEntry = flattenLayers(layers).find((e) => e.layer.id === "a")!
    expect(isLayerVisible(aEntry)).toBe(true)
  })
})

describe("findLayerById / findLayerLocation / detachLayer", () => {
  it("按 id 递归查找", () => {
    const { layers, g } = tree()
    expect(findLayerById(layers, "g")).toBe(g)
    expect(findLayerById(layers, "nope")).toBeNull()
  })

  it("定位所在同级数组与下标", () => {
    const { layers, g } = tree()
    const located = findLayerLocation(layers, "g")!
    expect(located.index).toBe(0)
    expect(located.siblings[0]).toBe(g)
    expect(findLayerLocation(layers, "nope")).toBeNull()
  })

  it("摘除子树并返回它", () => {
    const { layers, a } = tree()
    const removed = detachLayer(layers, "a")!
    expect(removed).toBe(a)
    expect(flattenLayers(layers).map((e) => e.layer.id)).toEqual(["p", "s"])
  })
})

describe("subtreeHeight", () => {
  it("叶子为 0，逐层加一", () => {
    const { p, a, g, s } = tree()
    expect(subtreeHeight(g)).toBe(0)
    expect(subtreeHeight(a)).toBe(1)
    expect(subtreeHeight(p)).toBe(2)
    expect(subtreeHeight(s)).toBe(0)
  })
})

describe("ancestorChain", () => {
  it("返回最外层到直接父层；顶层为空数组；未命中为 null", () => {
    const { layers } = tree()
    expect(ancestorChain(layers, "g")!.map((l) => l.id)).toEqual(["p", "a"])
    expect(ancestorChain(layers, "p")).toEqual([])
    expect(ancestorChain(layers, "nope")).toBeNull()
  })
})

describe("exceedsNestDepth", () => {
  it("根落位后的祖先数 + 子树纵深 超过上限即超深", () => {
    const { a, g } = tree()
    // g 是叶子（纵深 0）：最多还能有 MAX_NEST_DEPTH 个祖先。
    expect(exceedsNestDepth(g, MAX_NEST_DEPTH)).toBe(false)
    expect(exceedsNestDepth(g, MAX_NEST_DEPTH + 1)).toBe(true)
    // a 纵深 1：祖先数 + 1 不能超上限。
    expect(exceedsNestDepth(a, MAX_NEST_DEPTH - 1)).toBe(false)
    expect(exceedsNestDepth(a, MAX_NEST_DEPTH)).toBe(true)
  })
})
