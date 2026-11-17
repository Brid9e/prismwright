import { describe, it, expect } from "vitest"
import {
  BASE_DISTANCE,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitCameraDistance,
  zoomToCameraDistance,
} from "../zoom"

describe("zoom", () => {
  it("zoom = 1 时相机停在基准距离", () => {
    expect(zoomToCameraDistance(1)).toBe(BASE_DISTANCE)
  })

  it("zoom 越大相机越近（距离与 zoom 成反比）", () => {
    expect(zoomToCameraDistance(2)).toBeCloseTo(BASE_DISTANCE / 2)
    expect(zoomToCameraDistance(MAX_ZOOM)).toBeLessThan(zoomToCameraDistance(1))
    expect(zoomToCameraDistance(MIN_ZOOM)).toBeGreaterThan(zoomToCameraDistance(1))
  })

  it("超出 [MIN_ZOOM, MAX_ZOOM] 被夹住", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(-5)).toBe(MIN_ZOOM)
    // 距离是夹取后算的：喂 100 得到的必须是 MAX_ZOOM 的距离，而不是 100 的距离。
    expect(zoomToCameraDistance(100)).toBe(BASE_DISTANCE / MAX_ZOOM)
  })

  it("非有限值回落到 1（而不是把 NaN 传进相机）", () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
    expect(Number.isFinite(zoomToCameraDistance(Number.NaN))).toBe(true)
    expect(zoomToCameraDistance(Number.NaN)).toBe(BASE_DISTANCE)
  })

  it("区间内的值原样返回", () => {
    expect(clampZoom(2.5)).toBe(2.5)
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
  })
})

describe("fitCameraDistance", () => {
  const FOV = 35
  const TAN_HALF = Math.tan((FOV * Math.PI) / 360)

  it("5:7 卡在方屏里不需要比基准距离更远（既有取景不变）", () => {
    expect(fitCameraDistance(2.5 / 3.5, 1, FOV)).toBeLessThan(BASE_DISTANCE)
  })

  it("宽卡在窄画幅里要后退，直到左右边缘都进画幅", () => {
    const aspect = 3
    const viewport = 0.6
    const d = fitCameraDistance(aspect, viewport, FOV)
    expect(d).toBeGreaterThan(BASE_DISTANCE)
    // 该距离处可见的半宽必须盖住卡的半宽。
    expect(d * TAN_HALF * viewport).toBeGreaterThanOrEqual(aspect / 2)
  })

  it("竖卡在极宽画幅里按高度兜底，仍留出安全边距", () => {
    const d = fitCameraDistance(0.3, 4, FOV)
    expect(d * TAN_HALF).toBeGreaterThanOrEqual(0.5)
  })

  it("输入不可用时返回 0（调用方取 max 后退化为原距离）", () => {
    expect(fitCameraDistance(Number.NaN, 1, FOV)).toBe(0)
    expect(fitCameraDistance(1, 0, FOV)).toBe(0)
    expect(fitCameraDistance(-1, 1, FOV)).toBe(0)
  })
})
