/**
 * 色标编辑的纯函数测试。
 *
 * 这里钉住的是「百分比互不影响」语义：每个颜色在色带上有一个**自己的位置**（0–100%），
 * 改一行只改这一行，其它行的数字原样不动；位置必须非递减，所以越界时夹到左右邻居之间。
 * 同时钉住 Review Focus 第 4 条：第 9 个颜色必须加不进去。放进去会让落盘的
 * `pack.json` 超出 schema 的 8 个上限，之后这个系列会**整个打不开**。
 */
import { describe, it, expect } from "vitest"
import type { ColorStop } from "@cardbara/schema"
import {
  DEFAULT_NEW_STOP,
  MAX_COLOR_STOPS,
  addStop,
  canAddStop,
  canRemoveStop,
  gradientCss,
  removeStop,
  replaceStop,
  reorderStop,
  setStopPosition,
  toSixDigitHex,
} from "../colors"

const HEX = /^#[0-9a-f]{6}$/i
const stop = (color: string, at: number): ColorStop => ({ color, at })
const stops = (...pairs: [string, number][]): ColorStop[] =>
  pairs.map(([color, at]) => stop(color, at))
const ats = (list: readonly ColorStop[]) => list.map((s) => Number(s.at.toFixed(4)))
const colorsOf = (list: readonly ColorStop[]) => list.map((s) => s.color)

describe("色标纯函数", () => {
  it("MAX_COLOR_STOPS 为 8（与 schema 上限一致）", () => {
    expect(MAX_COLOR_STOPS).toBe(8)
  })

  it("DEFAULT_NEW_STOP 本身必须是合法色值，否则「添加颜色」会被自己的校验拒绝", () => {
    expect(DEFAULT_NEW_STOP).toMatch(HEX)
    expect(addStop([], DEFAULT_NEW_STOP)).toEqual([stop(DEFAULT_NEW_STOP, 0)])
  })

  it("replaceStop 改单个色值、不动位置；非法色值原样返回", () => {
    expect(replaceStop(stops(["#111111", 0], ["#222222", 1]), 1, "#333333")).toEqual(
      stops(["#111111", 0], ["#333333", 1]),
    )
    const before = stops(["#111111", 0.25])
    const after = replaceStop(before, 0, "#222222")
    expect(after[0]).toEqual(stop("#222222", 0.25))
    expect(after[0]).not.toBe(before[0])
    const same = stops(["#111111", 0])
    expect(replaceStop(same, 0, "nope")).toBe(same)
    expect(replaceStop(same, 3, "#333333")).toBe(same)
  })

  it("toSixDigitHex 展开 3 位、去掉 8 位的透明度", () => {
    expect(toSixDigitHex("#abc")).toBe("#aabbcc")
    expect(toSixDigitHex("#aabbccdd")).toBe("#aabbcc")
    expect(toSixDigitHex("#aabbcc")).toBe("#aabbcc")
  })
})

describe("setStopPosition（输入百分比调位置）", () => {
  it("只改目标色标的位置，其它颜色的百分比原样不动", () => {
    const list = stops(["#111111", 0], ["#222222", 0.5], ["#333333", 1])
    const after = setStopPosition(list, 1, 0.3)
    expect(ats(after)).toEqual([0, 0.3, 1])
    expect(colorsOf(after)).toEqual(["#111111", "#222222", "#333333"])
  })

  it("位置夹在左右邻居之间（色标必须非递减）", () => {
    const list = stops(["#111111", 0.2], ["#222222", 0.5], ["#333333", 0.8])
    expect(ats(setStopPosition(list, 1, 0.1))).toEqual([0.2, 0.2, 0.8])
    expect(ats(setStopPosition(list, 1, 0.95))).toEqual([0.2, 0.8, 0.8])
  })

  it("允许与邻居重合（表达硬边）", () => {
    const list = stops(["#111111", 0.2], ["#222222", 0.5])
    expect(ats(setStopPosition(list, 1, 0.2))).toEqual([0.2, 0.2])
  })

  it("输入超过 100% / 低于 0 时夹到边界", () => {
    const list = stops(["#111111", 0], ["#222222", 0.5], ["#333333", 1])
    expect(ats(setStopPosition(list, 0, -1))).toEqual([0, 0.5, 1])
    expect(ats(setStopPosition(list, 2, 1.5))).toEqual([0, 0.5, 1])
    expect(ats(setStopPosition(list, 0, 0))).toEqual([0, 0.5, 1])
  })

  it("下标越界时返回原数组引用", () => {
    const one = stops(["#111111", 0])
    expect(setStopPosition(one, 5, 0.5)).toBe(one)
    expect(setStopPosition(one, -1, 0.5)).toBe(one)
  })
})

describe("addStop（加颜色）", () => {
  it("追加在色带最右端（100%），已有颜色的百分比不变", () => {
    const after = addStop(stops(["#111111", 0], ["#222222", 0.5]), "#333333")
    expect(colorsOf(after)).toEqual(["#111111", "#222222", "#333333"])
    expect(ats(after)).toEqual([0, 0.5, 1])
  })

  it("空色板加第一个：位置 0", () => {
    expect(addStop([], "#333333")).toEqual([stop("#333333", 0)])
  })

  it("拒绝第 9 个", () => {
    const full = Array.from({ length: 8 }, (_, i) => stop(`#00000${i}`, i / 7))
    expect(canAddStop(full)).toBe(false)
    expect(addStop(full, "#ffffff")).toBe(full)
  })

  it("canAddStop 在 7 个时为 true（上限恰好是 8，不是 7）", () => {
    const seven = Array.from({ length: 7 }, (_, i) => stop(`#00000${i}`, i / 6))
    expect(canAddStop(seven)).toBe(true)
  })

  it("拒绝非法色值", () => {
    expect(addStop([], "red")).toEqual([])
    expect(addStop([], "#12345")).toEqual([])
  })
})

describe("removeStop（删颜色）", () => {
  it("只删掉目标色标，其它位置原样保留", () => {
    const after = removeStop(stops(["#111111", 0], ["#222222", 0.5], ["#333333", 1]), 1)
    expect(after).toEqual(stops(["#111111", 0], ["#333333", 1]))
  })

  it("删到空：本层不再出全息", () => {
    const one = stops(["#111111", 0.5])
    expect(canRemoveStop(one)).toBe(true)
    expect(removeStop(one, 0)).toEqual([])
    expect(canRemoveStop([])).toBe(false)
  })

  it("下标越界时返回原数组引用", () => {
    const one = stops(["#111111", 0])
    expect(removeStop(one, 5)).toBe(one)
    expect(removeStop(one, -1)).toBe(one)
  })
})

describe("reorderStop（拖拽排序）", () => {
  it("颜色互换位置，百分比留在原处不动", () => {
    // 0 / 50 / 100 三个位置不变，把第一个颜色拖到最后 → 绿、蓝、红。
    const list = stops(["#111111", 0], ["#222222", 0.5], ["#333333", 1])
    const after = reorderStop(list, 0, 2)
    expect(colorsOf(after)).toEqual(["#222222", "#333333", "#111111"])
    expect(ats(after)).toEqual([0, 0.5, 1])
  })

  it("两个颜色对调位置", () => {
    const list = stops(["#111111", 0], ["#222222", 0.5])
    const after = reorderStop(list, 0, 1)
    expect(colorsOf(after)).toEqual(["#222222", "#111111"])
    expect(ats(after)).toEqual([0, 0.5])
  })

  it("下标越界时返回原数组引用", () => {
    const one = stops(["#111111", 0])
    expect(reorderStop(one, 0, 5)).toBe(one)
    expect(reorderStop(one, -1, 0)).toBe(one)
  })
})

describe("gradientCss（只读预览）", () => {
  it("按色标位置生成 CSS 渐变，最后一个颜色自动铺到 100%", () => {
    expect(gradientCss(stops(["#111111", 0], ["#222222", 1 / 3], ["#333333", 2 / 3]))).toBe(
      "linear-gradient(to right, #111111 0.00%, #222222 33.33%, #333333 66.67%)",
    )
  })

  it("空色板给透明", () => {
    expect(gradientCss([])).toBe("transparent")
  })
})
