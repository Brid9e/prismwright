/**
 * 卡面形状控件的取值约定：宽高比直接以「宽/高」存取，圆角在界面上按百分比显示。
 *
 * 这两件事都容易悄悄错位：比例反过来（高/宽）会让所有卡都躺倒；百分比与卡高单位
 * 换算错了，滑杆拖到头圆角却只有一半。故把夹取与换算钉在这里。
 */
import { describe, it, expect } from "vitest"
import { DEFAULT_CARD_ASPECT } from "@cardbara/schema"
import {
  ASPECT_MAX,
  ASPECT_MIN,
  clampAspect,
  cornerRadiusToPercent,
  percentToCornerRadius,
} from "../face-shape"

describe("clampAspect", () => {
  it("范围内的值原样返回", () => {
    expect(clampAspect(1)).toBe(1)
    expect(clampAspect(DEFAULT_CARD_ASPECT)).toBe(DEFAULT_CARD_ASPECT)
  })

  it("越界时夹进 [ASPECT_MIN, ASPECT_MAX]", () => {
    expect(clampAspect(0.01)).toBe(ASPECT_MIN)
    expect(clampAspect(99)).toBe(ASPECT_MAX)
  })

  it("非有限值退回默认比例，不写进 NaN", () => {
    expect(clampAspect(Number.NaN)).toBe(DEFAULT_CARD_ASPECT)
    expect(clampAspect(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CARD_ASPECT)
  })
})

describe("圆角百分比", () => {
  it("卡高单位 0–0.5 对应 0–100%", () => {
    expect(cornerRadiusToPercent(0)).toBe(0)
    expect(cornerRadiusToPercent(0.25)).toBe(50)
    expect(cornerRadiusToPercent(0.5)).toBe(100)
  })

  it("百分比换回卡高单位", () => {
    expect(percentToCornerRadius(0)).toBe(0)
    expect(percentToCornerRadius(50)).toBe(0.25)
    expect(percentToCornerRadius(100)).toBe(0.5)
  })

  it("百分比越界或非有限时夹进 0–0.5", () => {
    expect(percentToCornerRadius(-10)).toBe(0)
    expect(percentToCornerRadius(250)).toBe(0.5)
    expect(percentToCornerRadius(Number.NaN)).toBe(0)
  })

  it("往返换算不漂移", () => {
    for (let percent = 0; percent <= 100; percent++) {
      expect(cornerRadiusToPercent(percentToCornerRadius(percent))).toBe(percent)
    }
  })
})
