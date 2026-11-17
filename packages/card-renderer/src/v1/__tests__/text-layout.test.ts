/**
 * 文字排版的纯几何约定：行高、对齐、字距、字体串。
 *
 * 这里钉的都是「看不见但会错位」的东西：块内行中线、三种对齐的行起点、字距非零时
 * 逐字符测量（与绘制共用同一份起点），以及字体名含空格时必须被引号包住——否则
 * canvas 的 `font` 赋值非法会**静默**沿用上一个字体，字形全错而没有任何报错。
 */
import { describe, it, expect, vi } from "vitest"
import { TextParamsSchema } from "@cardbara/schema"
import { flipRowsInPlace, fontCssString, layoutRuns, layoutText } from "../text-layout"

/** 每个字符宽 10px、忽略内容的假测量。 */
const measure10 = (text: string) => text.length * 10

function params(patch: Record<string, unknown> = {}) {
  return TextParamsSchema.parse({ content: "AB", ...patch })
}

describe("layoutRuns", () => {
  it("字距为 0：整行一段（保留 kerning / 连字），宽 = 整行测量", () => {
    const measure = vi.fn(measure10)
    const line = layoutRuns("AB", 4, 0, measure)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledWith("AB")
    expect(line.runs).toEqual([{ text: "AB", x: 4 }])
    expect(line.width).toBe(20)
  })

  it("字距非零：逐字符一段，宽 = 各字宽之和 + 字距 ×（字数 − 1）", () => {
    const measure = vi.fn(measure10)
    const line = layoutRuns("AB", 0, 3, measure)
    expect(measure.mock.calls.map((c) => c[0])).toEqual(["A", "B"])
    expect(line.runs).toEqual([
      { text: "A", x: 0 },
      { text: "B", x: 13 },
    ])
    expect(line.width).toBe(23)
  })

  it("空行：没有绘制单元，宽为 0", () => {
    expect(layoutRuns("", 0, 0, measure10)).toEqual({ runs: [], width: 0 })
    expect(layoutRuns("", 0, 5, measure10)).toEqual({ runs: [], width: 0 })
  })
})

describe("layoutText", () => {
  it("空行保留行高：三行（中间空行）块高 = 3 × 行高", () => {
    const layout = layoutText(params({ content: "A\n\nB", fontSize: 0.1 }), measure10, 1000)
    expect(layout.fontPx).toBe(100)
    expect(layout.lineHeightPx).toBe(120)
    expect(layout.blockHeight).toBe(360)
    expect(layout.lines.map((l) => l.text)).toEqual(["A", "", "B"])
  })

  it("行中线在块内居中、向上为正", () => {
    const layout = layoutText(params({ content: "A\nB", fontSize: 0.1 }), measure10, 1000)
    // 块高 240：第一行中线 +60、第二行 −60。
    expect(layout.lines[0].y).toBe(60)
    expect(layout.lines[1].y).toBe(-60)
  })

  it("三种对齐的行起点", () => {
    // 两行宽 20 / 40：块宽 40。
    const base = { content: "AA\nBBBB", fontSize: 0.1 }
    const left = layoutText(params({ ...base, align: "left" }), measure10, 1000)
    expect(left.lines.map((l) => l.x)).toEqual([-20, -20])
    const center = layoutText(params({ ...base, align: "center" }), measure10, 1000)
    expect(center.lines.map((l) => l.x)).toEqual([-10, -20])
    const right = layoutText(params({ ...base, align: "right" }), measure10, 1000)
    // 右对齐共享右缘 +20：宽 20 的行左缘 0，宽 40 的行左缘 −20。
    expect(right.lines.map((l) => l.x)).toEqual([0, -20])
  })

  it("字号与字距按卡高换算成像素", () => {
    const layout = layoutText(
      params({ content: "AB", fontSize: 0.1, letterSpacing: 0.01, lineHeight: 1.5 }),
      measure10,
      1000,
    )
    expect(layout.fontPx).toBe(100)
    expect(layout.lineHeightPx).toBe(150)
    // 字距 10px：A(10) + 10 + B(10) = 30。
    expect(layout.blockWidth).toBe(30)
  })
})

describe("fontCssString", () => {
  it("粗斜体：样式 + 字重 + 像素 + 字体", () => {
    const p = params({ fontWeight: 700, italic: true })
    expect(fontCssString(p, 122.88)).toBe('italic 700 122.88px sans-serif')
  })

  it("含空格的字体名加引号（否则 ctx.font 赋值会被静默忽略）", () => {
    expect(fontCssString(params({ fontFamily: "Microsoft YaHei" }), 100)).toBe(
      '400 100px "Microsoft YaHei"',
    )
  })

  it("逗号分隔的族列表逐段处理，通用族不加引号", () => {
    expect(fontCssString(params({ fontFamily: 'Songti SC, serif' }), 100)).toBe(
      '400 100px "Songti SC", serif',
    )
  })

  it("空字体名回退到 sans-serif", () => {
    expect(fontCssString(params({ fontFamily: "  " }), 100)).toBe("400 100px sans-serif")
  })
})

describe("flipRowsInPlace", () => {
  it("2×2：上下两行对调，行内像素顺序不变", () => {
    // 每像素 4 字节；行 0 = 1..8，行 1 = 9..16。
    const data = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    flipRowsInPlace(data, 2, 2)
    expect(Array.from(data)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("非方阵不串行：3 列 × 4 行按整行翻转", () => {
    const width = 3
    const height = 4
    const rowBytes = width * 4
    const data = new Uint8ClampedArray(rowBytes * height)
    for (let r = 0; r < height; r++) data.fill(r + 1, r * rowBytes, (r + 1) * rowBytes)
    flipRowsInPlace(data, width, height)
    const firstRow = Array.from(data.subarray(0, rowBytes))
    const lastRow = Array.from(data.subarray((height - 1) * rowBytes))
    expect(firstRow.every((v) => v === 4)).toBe(true)
    expect(lastRow.every((v) => v === 1)).toBe(true)
  })

  it("高度 0 / 1 时是空操作", () => {
    const data = new Uint8ClampedArray([1, 2, 3, 4])
    flipRowsInPlace(data, 1, 1)
    expect(Array.from(data)).toEqual([1, 2, 3, 4])
  })
})
