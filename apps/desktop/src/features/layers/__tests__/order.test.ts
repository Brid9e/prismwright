/**
 * 图层列表的「展示顺序 ← 图层树」换算。
 *
 * 展示顺序：同级按数组倒序（最上层先出），且父行排在其子树之上（先父、再子树）。
 * 折叠态由调用方以集合传入，任一祖先被折叠，其整棵子树都不出现在展示行里。
 */
import { describe, it, expect } from "vitest"
import { LayerSchema } from "@prismwright/schema"
import { toDisplayOrder } from "../order"

/** 造树：P ── [A ── G, B]，另有顶层 S。 */
function tree() {
  const g = LayerSchema.parse({ id: "g" })
  const a = LayerSchema.parse({ id: "a", children: [g] })
  const b = LayerSchema.parse({ id: "b" })
  const p = LayerSchema.parse({ id: "p", children: [a, b] })
  const s = LayerSchema.parse({ id: "s" })
  return [p, s]
}

describe("toDisplayOrder", () => {
  it("同级倒序 + 父先于子树：既顶行最上，又父在子之上", () => {
    // 顶层 [p, s] 倒序 = [s, p]；p 的子 [a, b] 倒序 = [b, a]，b 后再进 a 的子 [g]。
    // 于是 s（最上）在最前，p 紧接其后、其子 b、a 缩进在下，a 的子 g 再深一层。
    expect(toDisplayOrder(tree()).map((r) => r.id)).toEqual(["s", "p", "b", "a", "g"])
  })

  it("带出深度、父 id、同级下标与子层数量", () => {
    const byId = new Map(toDisplayOrder(tree()).map((r) => [r.id, r]))
    expect(byId.get("p")).toMatchObject({
      depth: 0,
      parentId: null,
      indexInParent: 0,
      childCount: 2,
    })
    expect(byId.get("a")).toMatchObject({
      depth: 1,
      parentId: "p",
      indexInParent: 0,
      childCount: 1,
    })
    expect(byId.get("g")).toMatchObject({
      depth: 2,
      parentId: "a",
      indexInParent: 0,
      childCount: 0,
    })
    expect(byId.get("b")).toMatchObject({
      depth: 1,
      parentId: "p",
      indexInParent: 1,
      childCount: 0,
    })
    expect(byId.get("s")).toMatchObject({
      depth: 0,
      parentId: null,
      indexInParent: 1,
      childCount: 0,
    })
  })

  it("折叠父层时其整棵子树不出现", () => {
    const rows = toDisplayOrder(tree(), new Set(["p"]))
    expect(rows.map((r) => r.id)).toEqual(["s", "p"])
  })

  it("不改动传入的数组", () => {
    const layers = tree()
    toDisplayOrder(layers)
    expect(layers.map((l) => l.id)).toEqual(["p", "s"])
  })
})
