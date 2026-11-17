/**
 * 拖拽倾斜的动力学（纯函数，零 three 依赖）。
 *
 * 交互模型已从「指针悬停即倾斜」改为「按住拖拽旋转 + 松手惯性回弹」：**只有按下才转动**
 * （悬停不再生效），松手后由一条欠阻尼弹簧把角度拉回空闲摆动（或静止）位，残余角速度让它
 * 「晃」几下才停——这正是「拖拽晃动」的手感来源。
 *
 * 坐标系：绕 X 轴的角记 `x`、绕 Y 轴的记 `y`（弧度）。角度方向沿用改造前的悬停模型
 * （见 {@link dragTilt}），从悬停切到拖拽时手感连续。
 */

/** 卡片最大倾斜角（弧度，约 50°）。拖拽会一路顶到这个限幅。 */
export const TILT_MAX = (50 * Math.PI) / 180

/** 拖拽灵敏度：指针每移动 1px 对应的旋转角（弧度）。 */
export const DRAG_SENSITIVITY = 0.008

/** 回弹弹簧的固有角频率（弧度/秒）。越大回得越快。 */
const SPRING_OMEGA = 13.5

/** 回弹弹簧的阻尼比。小于 1 = 欠阻尼，会来回晃几下（「晃动」手感的关键）。 */
const SPRING_ZETA = 0.22

/** 松手时保留的角速度上限（弧度/秒），防止极快一甩把卡片转飞。 */
export const MAX_ANGULAR_VELOCITY = 24

/** 空闲摆动的角频率（弧度/秒）。 */
const SWAY_FREQ = 1.2

/** 空闲摆动幅度（占 {@link TILT_MAX} 的比例）。 */
const SWAY_AMPLITUDE = 0.3

/** 一对方位角（弧度）：`x` 绕 X 轴、`y` 绕 Y 轴。 */
export interface Tilt {
  x: number
  y: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 把单个角度夹到 `±TILT_MAX`。 */
export function clampTilt(v: number): number {
  return clamp(v, -TILT_MAX, TILT_MAX)
}

/**
 * 拖拽累积：把本帧指针位移 (`dx`, `dy`) 折算成角度增量，叠加到 `from` 上并夹幅。
 *
 * 方向与改造前的悬停模型一致，保证从悬停切到拖拽时手感连续：向右拖 → 绕 Y 轴正转，
 * 卡片右缘转向背离观察者（等价于旧悬停时指针在右侧）；向下拖 → 绕 X 轴正转，顶边转向观察者
 * （等价于旧悬停时指针在下方）。即「指针位置 → 角度」的映射被就地逐帧累积。
 *
 * @param from - 起始角。
 * @param dx - 指针横向位移（px，右为正）。
 * @param dy - 指针纵向位移（px，下为正）。
 * @returns 叠加后的角，已夹到 `±TILT_MAX`。
 */
export function dragTilt(from: Tilt, dx: number, dy: number): Tilt {
  return {
    x: clampTilt(from.x + dy * DRAG_SENSITIVITY),
    y: clampTilt(from.y + dx * DRAG_SENSITIVITY),
  }
}

/**
 * 欠阻尼弹簧推进一步（半隐式欧拉）。逐轴独立求解 `θ'' = -ω²(θ - rest) - 2ζω·θ'`。
 *
 * 用半隐式（先更新速度、再用新速度更新位置）而非显式欧拉：弹簧刚度高时显式欧拉会发散，
 * 半隐式在 `dt` 偏大时仍然稳定。
 *
 * @param angle - 当前角。
 * @param vel - 当前角速度（弧度/秒）。
 * @param rest - 平衡角（空闲摆动值或零）。
 * @param dt - 步长（秒）。调用方应夹在合理上限内（见 card-view 的每帧夹取）。
 * @returns 更新后的角与角速度。
 */
export function springStep(
  angle: Tilt,
  vel: Tilt,
  rest: Tilt,
  dt: number,
): { angle: Tilt; vel: Tilt } {
  const k = SPRING_OMEGA * SPRING_OMEGA
  const c = 2 * SPRING_ZETA * SPRING_OMEGA
  const step = (a: number, v: number, r: number): { a: number; v: number } => {
    const nv = v + (-k * (a - r) - c * v) * dt
    return { a: a + nv * dt, v: nv }
  }
  const sx = step(angle.x, vel.x, rest.x)
  const sy = step(angle.y, vel.y, rest.y)
  return { angle: { x: sx.a, y: sy.a }, vel: { x: sx.v, y: sy.v } }
}

/** 把角速度逐分量夹到 `±MAX_ANGULAR_VELOCITY`（松手发惯性前调用）。 */
export function capVelocity(vel: Tilt): Tilt {
  return {
    x: clamp(vel.x, -MAX_ANGULAR_VELOCITY, MAX_ANGULAR_VELOCITY),
    y: clamp(vel.y, -MAX_ANGULAR_VELOCITY, MAX_ANGULAR_VELOCITY),
  }
}

/**
 * 空闲自动摆动：两条不同频率的正弦，产生轻微、不重复的呼吸感。松手回弹的平衡点就是它。
 *
 * @param t - 当前时间（**秒**）。
 * @returns 旋转角（弧度），落在 `±TILT_MAX · SWAY_AMPLITUDE`。
 */
export function idleSway(t: number): Tilt {
  return {
    x: Math.sin(t * SWAY_FREQ) * TILT_MAX * SWAY_AMPLITUDE,
    y: Math.cos(t * SWAY_FREQ * 0.7) * TILT_MAX * SWAY_AMPLITUDE,
  }
}

/**
 * 导出摆动循环的周期（秒）。一个导出的 GIF / WebM 恰好覆盖一整圈。
 */
export const EXPORT_SWAY_PERIOD = 6

/**
 * 导出用的无缝摆动：两条正弦，频率取**整数比 3:2**，使一个周期后两轴同时归位。
 *
 * 与 {@link idleSway} 的区别只在频率：`idleSway` 的两条频率（1.2 与 0.84）之比为 10:7，
 * 要 ~52s 才对齐，无法用于首尾必须相同的循环动图；这里改成 6s 内 x 走 3 圈、y 走 2 圈，
 * `t = 0` 与 `t = EXPORT_SWAY_PERIOD` 姿态完全相同（x=0、y=幅度），故逐帧渲染
 * `i = 0 … N-1`（**不含** `t = 周期`）时首尾自然衔接。幅度与 `idleSway` 相同（双轴、±15°），
 * 但频率更高（6s 内 x 走 3 圈、y 走 2 圈），摆动比 `idleSway` 更利落——这是为了可循环而付的代价。
 *
 * @param t - 当前时间（**秒**）。
 * @returns 旋转角（弧度），落在 `±TILT_MAX · SWAY_AMPLITUDE`。
 */
export function exportSway(t: number): Tilt {
  const amplitude = TILT_MAX * SWAY_AMPLITUDE
  const omega = (2 * Math.PI) / EXPORT_SWAY_PERIOD
  return {
    x: Math.sin(omega * 3 * t) * amplitude,
    y: Math.cos(omega * 2 * t) * amplitude,
  }
}
