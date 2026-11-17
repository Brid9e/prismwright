/**
 * 卡面底图的 UV 变换：把「填充方式 + 偏移 + 缩放 + 旋转」折成一个 2×2 采样矩阵与一段平移，
 * 供卡面片元一次乘加。
 *
 * 为什么在这层算而不在片元里算：片元只做 `matrix * (vUv - 0.5) + 0.5 + offset` 一次乘加，
 * 而比例换算、三种填充方式的分叉、旋转的宽高比校正都是纯数学，放在 TS 里能单测（node 环境
 * 没有 GL）。
 *
 * 坐标约定：
 * - 卡面平面高 = 1、宽 = 卡面宽高比 `cardAspect`，`vUv` 在整个平面上铺 0–1；
 * - 图片在平面上的显示尺寸按填充方式取（见 {@link fitSpan}），再乘用户缩放；
 * - 旋转在**卡面坐标**（宽窄按真实比例）里做，否则非方形卡面上转出来的图会被斜切；
 * - 矩阵按列主序存放——`[m00, m10, m01, m11]`，与 GLSL `mat2(col0, col1)` 同序。
 */
import type { FrontFit } from "@cardbara/schema"

/** 底图采样变换（uv → uv）。 */
export interface FrontUvTransform {
  /**
   * 采样矩阵，列主序：`[m00, m10, m01, m11]`。
   *
   * 片元里等价于 `mat2(matrix.xy, matrix.zw)`（第一列 `(m00, m10)`、第二列 `(m01, m11)`）。
   */
  matrix: [number, number, number, number]
  /** u 方向平移（正 = 采样点右移，画面上的图片左移）。 */
  offsetU: number
  /** v 方向平移。 */
  offsetV: number
}

/** 构造 {@link frontUvTransform} 的入参。 */
export interface FrontUvOptions {
  /** 图片自然宽高比（宽/高）；非有限正数按方图 1 处理。 */
  imageAspect: number
  /** 卡面宽高比（宽/高）；非有限正数按 1 处理，避免下游除以 0。 */
  cardAspect: number
  /** 填充方式。 */
  fit: FrontFit
  /** 水平偏移，单位是卡高（正 = 图片向右移）。默认 0。 */
  offsetX?: number
  /** 垂直偏移，单位是卡高（正 = 图片向上移）。默认 0。 */
  offsetY?: number
  /** 等比缩放倍率（1 = 不缩放）。非有限正数按 1 处理。默认 1。 */
  scale?: number
  /** 顺时针旋转角度（度），绕图片中心。非有限值按 0 处理。默认 0。 */
  rotation?: number
}

/**
 * 图片 / 蒙版图在卡面平面上的显示尺寸（卡面单位：高 = 1，宽 = `cardAspect`）。
 *
 * - `stretch`：正好铺满，不留不改比例；
 * - `cover`：等比铺满、取「较大」的一边，另一边溢出被裁；
 * - `contain`：等比完整可见、取「较小」的一边，另一边留空。
 *
 * 三种方式共用「先定高度 H、再由比例推宽度 W」，故写成一处；`cover` 与 `contain`
 * 只差 `max` / `min`。底图（{@link frontUvTransform}）与图蒙版（`mask-uv.ts`）共用本函数，
 * 两侧的填充方式语义因此不会分叉。入参须是已兜底过的有限正数。
 */
export function fitSpan(
  imageAspect: number,
  cardAspect: number,
  fit: FrontFit,
): [number, number] {
  if (fit === "stretch") return [cardAspect, 1]
  // 高度填满卡高时所需的宽高比 = cardAspect / imageAspect：
  // 该值 ≤ 1（图更宽）时图片按高度顶满，≥ 1（图更高）时按宽度顶满。
  const fillHeight = cardAspect / imageAspect
  const height = fit === "cover" ? Math.max(1, fillHeight) : Math.min(1, fillHeight)
  return [height * imageAspect, height]
}

/**
 * 计算底图的采样变换。
 *
 * 推导（卡面坐标，y 向上，单位为卡高）：
 * 1. 卡面点 `p = ((u - 0.5) * cardAspect, v - 0.5)`；
 * 2. 相对图片中心 `c`：`q = p - c`，再反转旋转角（正角 = 图片顺时针转）得 `q' = R(θ) q`；
 * 3. 图片坐标 `uv = (0.5, 0.5) + q' / span`，`span` 为图片显示尺寸（含缩放）。
 *
 * 展平后 `uv - 0.5 = M * (uvIn - 0.5) + offset`，其中
 * `M = R(θ) · diag(cardAspect / spanX, 1 / spanY)`、`offset = -R(θ) · c / span`。
 *
 * @param p - 见 {@link FrontUvOptions}。
 * @returns 供卡面片元使用的 {@link FrontUvTransform}。
 */
export function frontUvTransform(p: FrontUvOptions): FrontUvTransform {
  const a = Number.isFinite(p.imageAspect) && p.imageAspect > 0 ? p.imageAspect : 1
  const A = Number.isFinite(p.cardAspect) && p.cardAspect > 0 ? p.cardAspect : 1
  const scale = Number.isFinite(p.scale) && (p.scale ?? 0) > 0 ? (p.scale as number) : 1
  const rotation = Number.isFinite(p.rotation) ? (p.rotation as number) : 0
  const offsetX = p.offsetX ?? 0
  const offsetY = p.offsetY ?? 0

  const [width, height] = fitSpan(a, A, p.fit)
  // 用户缩放叠在填充方式之上：span 变大 = 图片变小（采样范围更宽）。
  const spanX = width * scale
  const spanY = height * scale

  // 把卡面 uv 换算成「图片方向的 uv 尺度」：u 方向要先乘卡宽变成卡面单位，再除以采样跨度。
  // 展开 `R(θ)·(x·A, y) / span` 即得下面四项——注意 x 分量经旋转后应除以 spanY，反之亦然。
  const kx = A / spanX
  const ky = 1 / spanY

  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // 图片中心（卡面单位，相对卡面中心）。正方向：x 右、y 上。
  const cx = offsetX
  const cy = offsetY
  // 采样平移 = -R(θ)·c / span。
  const rx = cos * cx - sin * cy
  const ry = sin * cx + cos * cy

  return {
    matrix: [cos * kx, sin * (A / spanY), -sin / spanX, cos * ky],
    offsetU: -rx / spanX,
    offsetV: -ry / spanY,
  }
}

/**
 * 用 {@link frontUvTransform} 的结果把卡面 UV 换算成底图 UV。
 *
 * 与卡面片元里那一次乘加逐字同构（`mat2(matrix.xy, matrix.zw) * (uv - 0.5) + 0.5 + offset`）。
 * 桌面端的吸管要在 CPU 上取原图像素，必须走同一式子，否则「点到的位置」与「看到的画面」错开。
 */
export function sampleFrontUv(
  t: FrontUvTransform,
  u: number,
  v: number,
): { u: number; v: number } {
  const [m00, m10, m01, m11] = t.matrix
  const x = u - 0.5
  const y = v - 0.5
  return {
    u: m00 * x + m01 * y + 0.5 + t.offsetU,
    v: m10 * x + m11 * y + 0.5 + t.offsetV,
  }
}
