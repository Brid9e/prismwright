/**
 * 拖拽落点解析：把「拖到某行的哪个位置」翻译成「重挂到哪个父、插到同级第几位」。
 *
 * 三态落位：上缘 = 放到该行**上方**（同级）、下缘 = 该行**下方**（同级）、中段 = 成为该行的子层。
 * 注意展示顺序是数组的倒序（顶行 = 最上层 = 数组末位），故「上方」对应数组里更大的下标。
 */
import { describe, it, expect } from "vitest"
import { LayerSchema } from "@prismwright/schema"
import { toDisplayOrder } from "../order"
import { dropZoneAt, resolveDrop } from "../drop"

/** 造树：P ── [A ── G, B]，另有顶层 S。展示顺序（倒序）= [S, B, G, A, P]。 */
function rows() {
  const g = LayerSchema.parse({ id: "g" })
  const a = LayerSchema.parse({ id: "a", children: [g] })
  const b = LayerSchema.parse({ id: "b" })
  const p = LayerSchema.parse({ id: "p", children: [a, b] })
  const s = LayerSchema.parse({ id: "s" })
  return toDisplayOrder([p, s])
}

describe("dropZoneAt", () => {
  it("上 25% 为之前、下 25% 为之后，中段一半为放进里面", () => {
    expect(dropZoneAt(0)).toBe("top")
    expect(dropZoneAt(0.249)).toBe("top")
    expect(dropZoneAt(0.25)).toBe("middle")
    expect(dropZoneAt(0.5)).toBe("middle")
    expect(dropZoneAt(0.749)).toBe("middle")
    expect(dropZoneAt(0.75)).toBe("bottom")
    expect(dropZoneAt(1)).toBe("bottom")
  })
})

describe("resolveDrop", () => {
  it("中段落位 = 成为目标行的子层，追加到其子列表末尾", () => {
    // 把 S 拖到 A 的中段：A 有一个子层 G，故 index = 1。
    expect(resolveDrop(rows(), "s", "a", "middle")).toEqual({ parentId: "a", index: 1 })
  })

  it("上缘 = 放到目标行的上方，与目标行同级", () => {
    // A 的父是 P、A 在 P 的子数组下标为 0；其「上方」是数组里更大的下标 → 1。
    expect(resolveDrop(rows(), "s", "a", "top")).toEqual({ parentId: "p", index: 1 })
  })

  it("下缘 = 放到目标行的下方，与目标行同级", () => {
    // B 的父是 P、B 的下标为 1；其「下方」即该下标本身 → 1。
    expect(resolveDrop(rows(), "s", "b", "bottom")).toEqual({ parentId: "p", index: 1 })
  })

  it("顶层之间：上缘/下缘落在顶层", () => {
    // S 是顶层、下标为 1；「上方」即数组末位 → 2。
    expect(resolveDrop(rows(), "p", "s", "top")).toEqual({ parentId: null, index: 2 })
  })

  it("拖到自身返回 null", () => {
    expect(resolveDrop(rows(), "s", "s", "middle")).toBeNull()
  })

  it("不能把层拖进自己的子树", () => {
    // P 是 A、G 的祖先：把 P 拖进 A 或 G 之内都应被拒。
    expect(resolveDrop(rows(), "p", "a", "middle")).toBeNull()
    expect(resolveDrop(rows(), "p", "g", "middle")).toBeNull()
  })

  it("把祖先拖到其后代的上/下缘同样被拒（会形成环）", () => {
    expect(resolveDrop(rows(), "p", "a", "top")).toBeNull()
    expect(resolveDrop(rows(), "p", "b", "bottom")).toBeNull()
  })

  it("子层拖到祖先的上缘 = 提出到祖先所在层级（合法）", () => {
    // G 的祖先 A 在 P 的子数组下标为 0 → 放到 A 的上方即 index 1。
    expect(resolveDrop(rows(), "g", "a", "top")).toEqual({ parentId: "p", index: 1 })
  })
})
