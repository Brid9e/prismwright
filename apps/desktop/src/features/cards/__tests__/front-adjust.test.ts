/**
 * 卡面底图调整的纯逻辑（填充方式候选项 + 偏移夹取）。
 *
 * 组件本身不做 DOM 测试（与本仓库其它 feature 一致），能被钉住的只有这些纯函数：
 * 数字框允许手敲任意值，夹取漏了就会把偏移写进数据、渲染时整张图飞到画外。
 */
import { describe, expect, it } from "vitest"
import {
  FRONT_FITS,
  FRONT_OFFSET_LIMIT,
  FRONT_OFFSET_STEP,
  FRONT_ROTATION_LIMIT,
  FRONT_ROTATION_STEP,
  FRONT_SCALE_MAX,
  FRONT_SCALE_MIN,
  clampFrontOffset,
  clampFrontRotation,
  clampFrontScale,
} from "../front-adjust"

describe("FRONT_FITS", () => {
  it("三种填充方式齐全、默认的覆盖排第一", () => {
    expect(FRONT_FITS).toEqual(["cover", "contain", "stretch"])
  })
})

describe("clampFrontOffset", () => {
  it("范围内的值原样返回", () => {
    expect(clampFrontOffset(0.123)).toBeCloseTo(0.123)
    expect(clampFrontOffset(-0.4)).toBeCloseTo(-0.4)
  })

  it("超出范围夹到边界（无论滑块还是手敲）", () => {
    expect(clampFrontOffset(9)).toBe(FRONT_OFFSET_LIMIT)
    expect(clampFrontOffset(-9)).toBe(-FRONT_OFFSET_LIMIT)
  })

  it("非有限值退回 0，不把 NaN 写进 pack.json", () => {
    expect(clampFrontOffset(Number.NaN)).toBe(0)
    expect(clampFrontOffset(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampFrontOffset(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it("步进足够细：拖到边缘也不会一格跳掉半张卡", () => {
    expect(FRONT_OFFSET_STEP).toBeGreaterThan(0)
    expect(FRONT_OFFSET_STEP).toBeLessThanOrEqual(0.01)
  })
})

describe("clampFrontScale", () => {
  it("范围内的值原样返回", () => {
    expect(clampFrontScale(1.75)).toBeCloseTo(1.75)
    expect(clampFrontScale(FRONT_SCALE_MIN)).toBeCloseTo(FRONT_SCALE_MIN)
  })

  it("超出范围夹到边界，不会缩到 0 或负值", () => {
    expect(clampFrontScale(9)).toBe(FRONT_SCALE_MAX)
    expect(clampFrontScale(0)).toBe(FRONT_SCALE_MIN)
    expect(clampFrontScale(-3)).toBe(FRONT_SCALE_MIN)
  })

  it("非有限值退回 1 倍（不把 NaN 写进 pack.json）", () => {
    expect(clampFrontScale(Number.NaN)).toBe(1)
    expect(clampFrontScale(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampFrontScale(Number.NEGATIVE_INFINITY)).toBe(1)
  })
})

describe("clampFrontRotation", () => {
  it("范围内的值原样返回（含负数 / 整数度）", () => {
    expect(clampFrontRotation(-37)).toBe(-37)
    expect(clampFrontRotation(180)).toBe(180)
  })

  it("超出 ±180 夹到边界", () => {
    expect(clampFrontRotation(540)).toBe(FRONT_ROTATION_LIMIT)
    expect(clampFrontRotation(-540)).toBe(-FRONT_ROTATION_LIMIT)
  })

  it("非有限值退回 0 度", () => {
    expect(clampFrontRotation(Number.NaN)).toBe(0)
    expect(clampFrontRotation(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it("步长是整度，滑块每一格 = 1°", () => {
    expect(FRONT_ROTATION_STEP).toBe(1)
  })
})
