/**
 * 卡面形状（宽高比 / 圆角）在界面上的取值范围与换算。
 *
 * 与 `front-adjust.ts` 同一条理由：组件不做 DOM 测试，能钉住的只有这些纯函数。
 * 宽高比在 schema 里就是「宽 / 高」，界面原样显示；圆角的存储单位是**卡高**，
 * 但对人来说百分比更直观，故界面上按 0–100% 呈现。
 */
import { DEFAULT_CARD_ASPECT } from "@cardbara/schema"

/** 宽高比下限（宽/高）：比 1:4 更瘦的卡在网格里已认不出是张卡。 */
export const ASPECT_MIN = 0.25

/** 宽高比上限（宽/高）：4:1 的横幅已是极端，再宽只能靠缩放看全。 */
export const ASPECT_MAX = 4

/** 宽高比滑块的步进：0.01 足够细（5:7 与 1:1 各能停准）。 */
export const ASPECT_STEP = 0.01

/** 圆角的上限（卡高单位）：0.5 即完全圆头，再大没有可见效果。 */
export const CORNER_RADIUS_MAX = 0.5

/**
 * 把宽高比夹进 `[ASPECT_MIN, ASPECT_MAX]`，非有限值退回默认 5:7。
 *
 * 数字框手敲 0 会把卡压成一条线、进哈希后画面全空；`NaN` 更会污染 `pack.json`。
 */
export function clampAspect(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CARD_ASPECT
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, value))
}

/**
 * 圆角（卡高单位）→ 界面百分比（0–100 的整数）。
 *
 * 取整是为了滑杆与数字框显示一致；渲染时仍以存储值为准，复位到默认值不受影响。
 */
export function cornerRadiusToPercent(radius: number): number {
  if (!Number.isFinite(radius)) return 0
  return Math.round(Math.min(CORNER_RADIUS_MAX, Math.max(0, radius)) * 200)
}

/** 界面百分比 → 圆角（卡高单位）；越界 / 非有限值夹进 0–0.5。 */
export function percentToCornerRadius(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent)) / 200
}
