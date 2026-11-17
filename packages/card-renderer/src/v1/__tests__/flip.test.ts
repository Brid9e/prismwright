/**
 * 翻面动力学：角度口径、阈值判定、进度与朝向。
 *
 * `flip = 0` 是主卡面朝外，`flip = π` 是卡背朝外。抽卡页从 π 起步。
 */
import { describe, it, expect } from "vitest"
import {
  FLIP_SETTLED,
  FLIP_START,
  FLIP_THRESHOLD,
  dragFlip,
  dragSpin,
  flipLands,
  flipProgress,
  flipSettled,
  frontVisible,
  landedFlip,
} from "../flip"
import { DRAG_SENSITIVITY, TILT_MAX, springStep } from "../tilt"

describe("dragFlip", () => {
  it("横向位移按 DRAG_SENSITIVITY 折算", () => {
    expect(dragFlip(FLIP_START, 100)).toBeCloseTo(FLIP_START + 100 * DRAG_SENSITIVITY)
  })

  it("从卡背起步最多转半圈：夹在 [0, 2π]", () => {
    expect(dragFlip(FLIP_START, 10000)).toBeCloseTo(2 * Math.PI)
    expect(dragFlip(FLIP_START, -10000)).toBe(0)
  })
})

describe("flipLands", () => {
  it("转过 90° 才算翻过去，两个方向都算", () => {
    expect(flipLands(FLIP_START + FLIP_THRESHOLD + 0.01)).toBe(true)
    expect(flipLands(FLIP_START - FLIP_THRESHOLD - 0.01)).toBe(true)
    expect(flipLands(FLIP_START + FLIP_THRESHOLD - 0.01)).toBe(false)
    expect(flipLands(FLIP_START)).toBe(false)
  })
})

describe("landedFlip", () => {
  it("落定到拖拽方向那一侧的主卡面", () => {
    expect(landedFlip(FLIP_START + 0.1)).toBeCloseTo(2 * Math.PI)
    expect(landedFlip(FLIP_START - 0.1)).toBe(0)
  })
})

describe("flipProgress", () => {
  it("卡背 0、主卡面 1，中间线性", () => {
    expect(flipProgress(FLIP_START)).toBe(0)
    expect(flipProgress(0)).toBe(1)
    expect(flipProgress(2 * Math.PI)).toBe(1)
    expect(flipProgress(FLIP_START / 2)).toBeCloseTo(0.5)
  })
})

describe("frontVisible", () => {
  it("cos ≥ 0 时主卡面朝外", () => {
    expect(frontVisible(0)).toBe(true)
    expect(frontVisible(Math.PI / 4)).toBe(true)
    expect(frontVisible(FLIP_START)).toBe(false)
    expect(frontVisible(1.5 * Math.PI)).toBe(false)
    expect(frontVisible(2 * Math.PI)).toBe(true)
  })
})

describe("flipSettled", () => {
  it("离目标 9° 以内算落定", () => {
    expect(FLIP_SETTLED).toBeCloseTo(0.05 * Math.PI)
    expect(flipSettled(0.04 * Math.PI, 0)).toBe(true)
    expect(flipSettled(-0.04 * Math.PI, 0)).toBe(true)
    expect(flipSettled(0.06 * Math.PI, 0)).toBe(false)
  })

  it("快速甩动后弹簧仍会落进容差，且不会停在对侧", () => {
    // 从 2π 附近带着大初速往回推：模拟松手时的惯性。
    let angle = { x: 0, y: 2 * Math.PI - 0.2 }
    let vel = { x: 0, y: -18 }
    const rest = { x: 0, y: 0 }
    for (let i = 0; i < 240; i++) {
      const next = springStep(angle, vel, rest, 1 / 60)
      angle = next.angle
      vel = next.vel
    }
    expect(flipSettled(angle.y, 0)).toBe(true)
  })
})

describe("dragSpin", () => {
  it("Y 不夹幅，能转满 360°", () => {
    expect(dragSpin({ x: 0, y: 0 }, 10000, 0).y).toBeCloseTo(10000 * DRAG_SENSITIVITY)
  })

  it("X 仍夹在 ±TILT_MAX", () => {
    expect(dragSpin({ x: 0, y: 0 }, 0, 10000).x).toBeCloseTo(TILT_MAX)
    expect(dragSpin({ x: 0, y: 0 }, 0, -10000).x).toBeCloseTo(-TILT_MAX)
  })
})
