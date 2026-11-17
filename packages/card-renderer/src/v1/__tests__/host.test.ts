import { describe, expect, it } from "vitest"
import { clampPixelRatio } from "../host"

describe("clampPixelRatio", () => {
  it("caps at 3", () => {
    expect(clampPixelRatio(4)).toBe(3)
  })
  // 3x 屏（多数 iPhone）夹到 2 就是欠采样：卡面只有三分之二的显示像素，
  // 边缘和高对比细线会出现台阶。上限必须够到真机像素比。
  it("3x 屏按原像素比渲染，不再降采样", () => {
    expect(clampPixelRatio(3)).toBe(3)
  })
  it("keeps ratios below the cap", () => {
    expect(clampPixelRatio(1.5)).toBe(1.5)
  })
  it("falls back to 1 for non-positive or NaN input", () => {
    expect(clampPixelRatio(0)).toBe(1)
    expect(clampPixelRatio(Number.NaN)).toBe(1)
  })
})
