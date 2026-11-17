/**
 * glossColorUniforms：光泽条目的颜色 → `uGlossColor` 定长数组。
 *
 * 钉住两件事：缺省色必须逐位等于老的暖白常量（存量卡逐像素不变），设了色则走 three 的
 * sRGB → 线性工作空间换算（与图蒙版拾色同源）。
 */
import { describe, it, expect } from "vitest"
import { EffectSchema, type Effect } from "@cardbara/schema"
import { glossAlphaUniforms, glossColorUniforms } from "../effects/gloss-color"
import { GLOSS_MAX } from "../effects/registry"

const effect = (params: Record<string, unknown>, enabled = true): Effect =>
  EffectSchema.parse({ kind: "gloss", id: "g", enabled, params }) as Effect

describe("glossColorUniforms", () => {
  it("没有 color 的条目用老暖白常量（含 >1 的分量）", () => {
    const [c] = glossColorUniforms([effect({})])
    expect([c.r, c.g, c.b]).toEqual([1.15, 1.1, 1.05])
  })

  it("设了 color 的条目用该色（sRGB → 线性工作空间）", () => {
    const [c] = glossColorUniforms([effect({ color: "#808080" })])
    // 0.5 sRGB ≈ 0.2158 线性；若得到 0.5 说明颜色没做色彩空间换算。
    expect(c.r).toBeCloseTo(0.2158, 3)
  })

  it("长度恒为 GLOSS_MAX，禁用条目被剔除、按列表序填", () => {
    const colors = glossColorUniforms([effect({ color: "#ff0000" }), effect({}, false)])
    expect(colors).toHaveLength(GLOSS_MAX)
    expect(colors[0].r).toBeCloseTo(1, 5)
    expect(colors[0].g).toBeCloseTo(0, 5)
    // 未占用槽位仍是暖白：不参与着色，取值只为让定长数组确定下来。
    expect(colors[1].g).toBeCloseTo(1.1, 5)
  })
})

describe("glossAlphaUniforms", () => {
  it("缺省 / 6 位色都不透明；8 位色取自己的 alpha", () => {
    const alphas = glossAlphaUniforms([effect({}), effect({ color: "#ff000080" })])
    expect(alphas).toHaveLength(GLOSS_MAX)
    expect(alphas[0]).toBe(1)
    expect(alphas[1]).toBeCloseTo(128 / 255, 10)
  })

  it("禁用条目被剔除、未占用槽位补 1", () => {
    const alphas = glossAlphaUniforms([effect({ color: "#ff000000" }, false)])
    expect(alphas).toEqual([1, 1])
  })
})
