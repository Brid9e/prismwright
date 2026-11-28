import { describe, it, expect } from "vitest"
import { hexToHsv, hsvToHex, normalizeHexInput } from "../color-picker-math"

describe("hexToHsv", () => {
  it("纯红 / 绿 / 蓝对应 0 / 120 / 240 度", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexToHsv("#00ff00")).toEqual({ h: 120, s: 1, v: 1 })
    expect(hexToHsv("#0000ff")).toEqual({ h: 240, s: 1, v: 1 })
  })

  it("灰阶饱和度为 0，8 位色值只取 RGB", () => {
    expect(hexToHsv("#808080")).toEqual({ h: 0, s: 0, v: 128 / 255 })
    expect(hexToHsv("#00ff0080").s).toBe(1)
    expect(hexToHsv("#00ff0080").v).toBe(1)
  })

  it("3 位色值按展开后的 6 位解析", () => {
    expect(hexToHsv("#f00")).toEqual(hexToHsv("#ff0000"))
  })
})

describe("hsvToHex", () => {
  it("不透明输出 6 位，半透明输出 8 位", () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 }, 1)).toBe("#ff0000")
    expect(hsvToHex({ h: 0, s: 1, v: 1 }, 0.5)).toBe("#ff000080")
  })

  it("色相回绕、饱和度和明度越界都会被夹取", () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 }, 1)).toBe("#ff0000")
    expect(hsvToHex({ h: -120, s: 1, v: 1 }, 1)).toBe("#0000ff")
    expect(hsvToHex({ h: 0, s: 2, v: 2 }, 1)).toBe("#ff0000")
    expect(hsvToHex({ h: 0, s: -1, v: -1 }, 1)).toBe("#000000")
  })

  it("与 hexToHsv 往返不丢色相", () => {
    const hsv = hexToHsv("#336699")
    const hex = hsvToHex(hsv, 1)
    expect(hex).toBe("#336699")
  })
})

describe("normalizeHexInput", () => {
  it("接受带不带 #、3/6/8 位，统一小写", () => {
    expect(normalizeHexInput("ff0000")).toBe("#ff0000")
    expect(normalizeHexInput("#F00")).toBe("#ff0000")
    expect(normalizeHexInput("#FF0000FF")).toBe("#ff0000ff")
    expect(normalizeHexInput("  #abcdef  ")).toBe("#abcdef")
  })

  it("非法输入返回 null", () => {
    expect(normalizeHexInput("nope")).toBeNull()
    expect(normalizeHexInput("#ff00")).toBeNull()
    expect(normalizeHexInput("#gggggg")).toBeNull()
    expect(normalizeHexInput("")).toBeNull()
  })
})
