/**
 * 拖拽倾斜动力学的行为测试。
 *
 * 三条接缝都必须钉死，且都是纯函数、node 环境可直接覆盖：
 * - **增量累积**：拖拽把指针位移折算成角度增量叠加起来，方向还得与旧悬停模型一致（否则换手）；
 * - **欠阻尼回弹**：弹簧要有过冲（这才是「晃动」），又必须最终收敛（否则卡片永远抖）；
 * - **角速度夹幅**：极快一甩不能把卡片转飞。
 */
import { describe, it, expect } from "vitest"
import {
  DRAG_SENSITIVITY,
  EXPORT_SWAY_PERIOD,
  MAX_ANGULAR_VELOCITY,
  TILT_MAX,
  capVelocity,
  clampTilt,
  dragTilt,
  exportSway,
  idleSway,
  springStep,
  type Tilt,
} from "../tilt"

/** 以固定步长把弹簧推进 `steps` 步，返回每步后的角（用于观察轨迹）。 */
function runSpring(from: Tilt, vel: Tilt, rest: Tilt, steps: number, dt = 1 / 60): Tilt[] {
  const path: Tilt[] = []
  let angle = from
  let v = vel
  for (let i = 0; i < steps; i++) {
    const next = springStep(angle, v, rest, dt)
    angle = next.angle
    v = next.vel
    path.push(angle)
  }
  return path
}

describe("clampTilt", () => {
  it("界内原样返回，越界夹到 ±TILT_MAX", () => {
    expect(clampTilt(0.1)).toBe(0.1)
    expect(clampTilt(TILT_MAX * 2)).toBe(TILT_MAX)
    expect(clampTilt(-TILT_MAX * 2)).toBe(-TILT_MAX)
  })
})

describe("dragTilt", () => {
  it("零位移不改变角度", () => {
    expect(dragTilt({ x: 0.3, y: -0.2 }, 0, 0)).toEqual({ x: 0.3, y: -0.2 })
  })

  it("位移按 DRAG_SENSITIVITY 折算，并在起点上逐帧累积", () => {
    // 步长取得足够小，两帧累积后仍不触顶（TILT_MAX ≈ 0.873，而 2×40px×0.008 = 0.64）。
    const once = dragTilt({ x: 0, y: 0 }, 40, 20)
    expect(once.y).toBeCloseTo(40 * DRAG_SENSITIVITY)
    expect(once.x).toBeCloseTo(20 * DRAG_SENSITIVITY)
    const twice = dragTilt(once, 40, 20)
    expect(twice.y).toBeCloseTo(80 * DRAG_SENSITIVITY)
    expect(twice.x).toBeCloseTo(40 * DRAG_SENSITIVITY)
  })

  it("方向与旧悬停模型一致：向右拖 → +y，向下拖 → +x", () => {
    expect(dragTilt({ x: 0, y: 0 }, 100, 0).y).toBeGreaterThan(0)
    expect(dragTilt({ x: 0, y: 0 }, 0, 100).x).toBeGreaterThan(0)
    expect(dragTilt({ x: 0, y: 0 }, -100, 0).y).toBeLessThan(0)
    expect(dragTilt({ x: 0, y: 0 }, 0, -100).x).toBeLessThan(0)
  })

  it("超大幅拖拽被夹到 ±TILT_MAX", () => {
    const t = dragTilt({ x: 0, y: 0 }, 1e6, 1e6)
    expect(t.x).toBe(TILT_MAX)
    expect(t.y).toBe(TILT_MAX)
  })
})

describe("springStep", () => {
  it("从静止、偏离平衡处起步时朝平衡点移动", () => {
    const next = springStep({ x: 0.5, y: -0.4 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1 / 60)
    expect(next.angle.x).toBeLessThan(0.5)
    expect(next.angle.y).toBeGreaterThan(-0.4)
  })

  it("欠阻尼：从静止释放会越过平衡点（有过冲，才叫「晃」）", () => {
    const path = runSpring({ x: 0.5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 200)
    expect(Math.min(...path.map((p) => p.x))).toBeLessThan(0)
  })

  it("最终收敛到平衡点（不会永远抖）", () => {
    const path = runSpring({ x: TILT_MAX, y: -TILT_MAX }, { x: 0, y: 0 }, { x: 0, y: 0 }, 2000)
    const last = path[path.length - 1]
    expect(Math.abs(last.x)).toBeLessThan(1e-4)
    expect(Math.abs(last.y)).toBeLessThan(1e-4)
  })

  it("平衡点非零时同样收敛到它（空闲摆动位）", () => {
    const rest: Tilt = { x: 0.2, y: -0.1 }
    const last = runSpring({ x: 0, y: 0 }, { x: 0, y: 0 }, rest, 2000).at(-1)!
    expect(last.x).toBeCloseTo(rest.x, 3)
    expect(last.y).toBeCloseTo(rest.y, 3)
  })
})

describe("capVelocity", () => {
  it("界内的角速度原样保留", () => {
    const v: Tilt = { x: 1, y: -2 }
    expect(capVelocity(v)).toEqual(v)
  })

  it("超上限的角速度被夹到 ±MAX_ANGULAR_VELOCITY", () => {
    expect(capVelocity({ x: 1e6, y: -1e6 })).toEqual({
      x: MAX_ANGULAR_VELOCITY,
      y: -MAX_ANGULAR_VELOCITY,
    })
  })
})

describe("idleSway", () => {
  it("幅度不超过 TILT_MAX，且随时间变化", () => {
    const a = idleSway(0)
    const b = idleSway(1.7)
    expect(Math.abs(a.x)).toBeLessThanOrEqual(TILT_MAX)
    expect(Math.abs(a.y)).toBeLessThanOrEqual(TILT_MAX)
    expect(a.x === b.x && a.y === b.y).toBe(false)
  })
})

describe("exportSway", () => {
  /** 幅度：与 idleSway 同取 TILT_MAX · 0.3。 */
  const AMP = TILT_MAX * 0.3

  it("t=0 与 t=周期 姿态相同（首尾衔接，GIF 才能无缝循环）", () => {
    const a = exportSway(0)
    const b = exportSway(EXPORT_SWAY_PERIOD)
    expect(a.x).toBeCloseTo(b.x, 12)
    expect(a.y).toBeCloseTo(b.y, 12)
  })

  it("t=0 时 x=0、y=幅度（公式直接取值）", () => {
    expect(exportSway(0).x).toBeCloseTo(0, 12)
    expect(exportSway(0).y).toBeCloseTo(AMP, 12)
  })

  it("幅度恰为 ±TILT_MAX·0.3，且两轴都在用足幅值", () => {
    const xs = Array.from({ length: 400 }, (_, i) => exportSway((i / 400) * EXPORT_SWAY_PERIOD).x)
    const ys = Array.from({ length: 400 }, (_, i) => exportSway((i / 400) * EXPORT_SWAY_PERIOD).y)
    expect(Math.max(...xs)).toBeCloseTo(AMP, 2)
    expect(Math.min(...xs)).toBeCloseTo(-AMP, 2)
    expect(Math.max(...ys)).toBeCloseTo(AMP, 2)
    expect(Math.min(...ys)).toBeCloseTo(-AMP, 2)
  })

  it("中间值与公式手算一致（x 走 3 圈、y 走 2 圈）", () => {
    // t=1：x = sin(2π·3·1/6)·A = sin(π)·A = 0；y = cos(2π·2·1/6)·A = cos(2π/3)·A = -A/2。
    expect(exportSway(1).x).toBeCloseTo(0, 12)
    expect(exportSway(1).y).toBeCloseTo(-AMP / 2, 12)
    // t=1.5：x = sin(3π/2)·A = -A；y = cos(π)·A = -A。
    expect(exportSway(1.5).x).toBeCloseTo(-AMP, 12)
    expect(exportSway(1.5).y).toBeCloseTo(-AMP, 12)
  })
})
