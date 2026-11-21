/**
 * 卡面底图调整的纯逻辑：填充方式的候选项，以及偏移 / 缩放 / 旋转的取值范围与夹取。
 *
 * 抽成模块的理由与 `display.ts` / `exportOptions.ts` 相同——组件不做 DOM 测试，能钉住的
 * 只有这些可单独调用的常量和函数；而「数值越过边界」恰恰是最容易漏、后果又最明显的一类：
 * 数字框手敲 9 会原样写进 `pack.json`，渲染时整张底图飞出画外或缩到看不见。
 */
import type { FrontFit } from "@prismwright/schema"

/** 填充方式的候选项，顺序即下拉框顺序；`cover` 是默认值，故排第一。 */
export const FRONT_FITS: readonly FrontFit[] = ["cover", "contain", "stretch"]

/**
 * 偏移的取值范围（卡高单位，正负对称）。
 *
 * ±0.5 个卡高足够把图推到「只剩边缘一角」；再大只会让画面全空，徒增可调范围。
 */
export const FRONT_OFFSET_LIMIT = 0.5

/** 偏移的步进：0.005 个卡高 ≈ 一张 320px 缩略图上的 1.6 像素，够细。 */
export const FRONT_OFFSET_STEP = 0.005

/**
 * 把偏移夹进 {@link FRONT_OFFSET_LIMIT}，并把非有限值退回 0。
 *
 * @param value - 滑块 / 数字框给出的值。
 * @returns 保证落在 `[-FRONT_OFFSET_LIMIT, FRONT_OFFSET_LIMIT]` 的有限数。
 */
export function clampFrontOffset(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(FRONT_OFFSET_LIMIT, Math.max(-FRONT_OFFSET_LIMIT, value))
}

/**
 * 缩放的取值范围（倍率，1 = 不缩放）。
 *
 * 0.2× 时图片只占卡面的一小块，3× 时整张卡只剩图片中间的一小片——再往外拉只有「全是底色」。
 */
export const FRONT_SCALE_MIN = 0.2
export const FRONT_SCALE_MAX = 3

/** 缩放的步进：0.01 倍，拖满 0.2–3 约 280 格，够细也拖得动。 */
export const FRONT_SCALE_STEP = 0.01

/**
 * 把缩放夹进 `[FRONT_SCALE_MIN, FRONT_SCALE_MAX]`，非有限值退回 1 倍。
 *
 * 下限必须 > 0：渲染时跨度要拿来当除数，0 会把整张卡面除成 NaN。
 */
export function clampFrontScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(FRONT_SCALE_MAX, Math.max(FRONT_SCALE_MIN, value))
}

/** 旋转的取值范围（度，正 = 图片顺时针）。±180 即完整一圈。 */
export const FRONT_ROTATION_LIMIT = 180

/** 旋转的步进：整度，滑块每一格 1°。 */
export const FRONT_ROTATION_STEP = 1

/**
 * 把旋转角夹进 `±FRONT_ROTATION_LIMIT`，非有限值退回 0 度。
 *
 * 不做 360 取模：±180 已是完整的可调范围，取模只会让滑块位置突然跳一下。
 */
export function clampFrontRotation(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(FRONT_ROTATION_LIMIT, Math.max(-FRONT_ROTATION_LIMIT, value))
}
