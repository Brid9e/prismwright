/**
 * 抽卡翻面的动力学（纯函数，零 three 依赖）。
 *
 * 角度口径：`flip = 0` 是主卡面朝外，`flip = π` 是卡背朝外；角度绕竖直轴累积（弧度）。
 * 抽卡页从 π 起步——玩家先看到卡背，横向拖拽把卡转过来，转过 90° 松手就翻到主卡面。
 * 夹在 `[0, 2π]` 而不是让角度无限累积：从卡背起步最多转半圈，往哪边甩都能到主卡面，
 * 又不会转过一整圈再绕回来。
 *
 * 与 {@link ./tilt} 分工：那套倾斜只管「按住时的晃动」，这里的 `dragSpin` 负责让 Y 轴
 * 能转满 360°（倾斜的 `dragTilt` 会把 Y 也夹在 ±TILT_MAX，翻不过去）。
 */

import { DRAG_SENSITIVITY, clampTilt, type Tilt } from "./tilt"

/** 起点角度：卡背朝外（π）。 */
export const FLIP_START = Math.PI

/** 翻面阈值：相对起点转过 90° 才算「翻过去了」。 */
export const FLIP_THRESHOLD = Math.PI / 2

/** 落定容差：离目标面 9° 以内视为停稳，可以收掉滚动 / 惯性。 */
export const FLIP_SETTLED = Math.PI / 20

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 拖拽翻面：把指针横向位移折算成翻面角增量。
 *
 * 夹在 `[0, 2π]`：从 π 起步往任一方向拖，最多走到 0 或 2π 就停——两个端点都是主卡面
 * 朝外（相差一整圈），所以甩过头不会翻回卡背。
 *
 * @param flip - 当前翻面角（弧度）。
 * @param dx - 指针横向位移（px，右为正）。
 * @returns 叠加后的角，已夹到 `[0, 2π]`。
 */
export function dragFlip(flip: number, dx: number): number {
  return clamp(flip + dx * DRAG_SENSITIVITY, 0, 2 * Math.PI)
}

/**
 * 拖拽旋转：翻面途中允许的倾斜晃动。
 *
 * 与 {@link dragTilt} 的唯一区别是 **Y 不夹幅**：Y 就是翻面轴，要能一路转满 360°；
 * X 仍然夹在 `±TILT_MAX`，否则卡片会前后翻出画面。
 */
export function dragSpin(tilt: Tilt, dx: number, dy: number): Tilt {
  return {
    x: clampTilt(tilt.x + dy * DRAG_SENSITIVITY),
    y: tilt.y + dx * DRAG_SENSITIVITY,
  }
}

/** 松手时是否该翻到另一面：相对起点转过了 {@link FLIP_THRESHOLD}，左右方向都算。 */
export function flipLands(flip: number): boolean {
  return Math.abs(flip - FLIP_START) >= FLIP_THRESHOLD
}

/**
 * 松手后要落定的角度：按拖拽方向选择离得近的主卡面（0 或 2π）。
 *
 * 用 `>` 而不是 `>=` 判方向：正好停在起点 π 时留在卡背（0），此时本来也没翻过去。
 */
export function landedFlip(flip: number): number {
  return flip > FLIP_START ? 2 * Math.PI : 0
}

/**
 * 翻面进度：卡背 0、主卡面 1，中间线性。
 *
 * 用「离起点的角度差」而不是原始角：两个端点（0 与 2π）都是主卡面，进度都该是满的，
 * 驱动动画 / 音频时不必关心玩家是从哪边甩过来的。
 */
export function flipProgress(flip: number): number {
  return Math.min(1, Math.abs(flip - FLIP_START) / Math.PI)
}

/** 是否已落定到目标面（逐帧判断，用来收掉惯性）。 */
export function flipSettled(flip: number, landed: number): boolean {
  return Math.abs(flip - landed) <= FLIP_SETTLED
}

/**
 * 当前主卡面是否朝外：`cos(flip) ≥ 0`。
 *
 * 正好侧对（π/2、3π/2）时按朝外处理——侧对时两面都几乎不可见，选哪面都不影响观感，
 * 取 ≥ 少一个边界分支。
 */
export function frontVisible(flip: number): boolean {
  return Math.cos(flip) >= 0
}
