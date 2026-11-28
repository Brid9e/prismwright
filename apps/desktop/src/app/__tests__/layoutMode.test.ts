/**
 * 布局模式的列宽契约。
 *
 * 三种模式是同一套面板的不同配比：工作室两侧都开，专注收掉左栏，紧凑把左栏压成缩略图条。
 * 数值写成百分比（面板库的单位），与设计文档里的像素目标对应（1440 宽下 18% ≈ 236、
 * 26% ≈ 348、5% ≈ 72）。
 */
import { describe, it, expect } from "vitest"
import { LAYOUT_SIZES, isLayoutMode, layoutSizes } from "../layoutMode"

describe("layoutSizes", () => {
  it("工作室两侧展开", () => {
    expect(layoutSizes("studio")).toEqual({ left: 18, right: 26 })
  })

  it("专注收掉左栏、保留右栏", () => {
    expect(layoutSizes("focus")).toEqual({ left: 0, right: 26 })
  })

  it("紧凑左栏变窄、右栏略收", () => {
    const compact = layoutSizes("compact")
    expect(compact.left).toBeGreaterThan(0)
    expect(compact.left).toBeLessThan(LAYOUT_SIZES.studio.left)
    expect(compact.right).toBeLessThan(LAYOUT_SIZES.studio.right)
  })

  it("isLayoutMode 只接受三种模式", () => {
    expect(isLayoutMode("focus")).toBe(true)
    expect(isLayoutMode("wide")).toBe(false)
  })
})
