/**
 * 颜色透明度：8 位 hex（`#rrggbbaa`）的合法性，以及 `alphaOf` / `withAlpha` 的读写。
 *
 * 透明度是**颜色本身的一部分**（存进同一个 hex 字段），不另开字段——这样所有颜色字段的
 * schema、迁移、渲染器与编辑器控件都不必区分「带透明度的颜色」与普通颜色。
 */
import { describe, it, expect } from "vitest"
import { HEX_COLOR, alphaOf, withAlpha } from "../schema.js"

describe("HEX_COLOR 接受 8 位十六进制", () => {
  it.each(["#abc", "#aabbcc", "#aabbcc80", "#ABCDEF00"])("%s 合法", (hex) => {
    expect(HEX_COLOR.test(hex)).toBe(true)
  })

  it.each(["#abcd", "#aabbccdd0", "#aabbccd", "aabbcc", "#aabbcg00"])(
    "%s 非法",
    (hex) => {
      expect(HEX_COLOR.test(hex)).toBe(false)
    },
  )
})

describe("alphaOf", () => {
  it("3 位与 6 位 hex 完全不透明", () => {
    expect(alphaOf("#fff")).toBe(1)
    expect(alphaOf("#aabbcc")).toBe(1)
  })

  it("8 位 hex 取末字节 / 255", () => {
    expect(alphaOf("#aabbcc00")).toBe(0)
    expect(alphaOf("#aabbccff")).toBe(1)
    expect(alphaOf("#aabbcc80")).toBeCloseTo(128 / 255, 10)
  })
})

describe("withAlpha", () => {
  it("不透明时回到 6 位 hex（数据里不留没用的 aa）", () => {
    expect(withAlpha("#ff0000", 1)).toBe("#ff0000")
    expect(withAlpha("#ff000080", 1)).toBe("#ff0000")
  })

  it("半透明时写回 8 位 hex", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080")
    expect(withAlpha("#ff000080", 0.5)).toBe("#ff000080")
    expect(withAlpha("#ff0000", 0)).toBe("#ff000000")
  })

  it("3 位 hex 先展开成 6 位", () => {
    expect(withAlpha("#abc", 0.5)).toBe("#aabbcc80")
  })

  it("越界的 alpha 钳制到 [0, 1]", () => {
    expect(withAlpha("#123456", -1)).toBe("#12345600")
    expect(withAlpha("#123456", 2)).toBe("#123456")
  })

  it("与 alphaOf 往返一致（±1 个色阶）", () => {
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      expect(Math.abs(alphaOf(withAlpha("#123456", a)) - a)).toBeLessThanOrEqual(1 / 255 + 1e-9)
    }
  })
})
