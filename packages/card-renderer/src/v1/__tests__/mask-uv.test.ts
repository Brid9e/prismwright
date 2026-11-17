/**
 * 图蒙版采样参数的纯函数契约（{@link maskUvParams}）。
 *
 * 蒙版图的变换与图片效果同构：中心 / 尺寸（卡面单位）/ 旋转（弧度）。差别只在缺省值——
 * 图片按自身比例自适应，蒙版缺省按覆盖等比铺满卡面。缺省若写错，孔洞画面会整体偏移或缩小；
 * 角的单位若从度写成弧度（或反之），画面是「转得莫名其妙」。两者都只能靠数值断言钉住。
 */
import { describe, expect, it } from "vitest"
import { maskUvParams } from "../mask-uv"

const A = 2.5 / 3.5

describe("maskUvParams", () => {
  it("缺省即恒等：中心在卡心、尺寸正好是卡面、不旋转", () => {
    const p = maskUvParams(A, undefined)
    expect(p.centerX).toBe(0)
    expect(p.centerY).toBe(0)
    expect(p.sizeX).toBeCloseTo(A)
    expect(p.sizeY).toBeCloseTo(1)
    expect(p.rotation).toBe(0)
  })

  it("位移原样进中心（卡高单位，正 = 右 / 上）", () => {
    const p = maskUvParams(A, { x: 0.1, y: -0.2, scale: 1, rotation: 0 })
    expect(p.centerX).toBeCloseTo(0.1)
    expect(p.centerY).toBeCloseTo(-0.2)
  })

  it("缩放同时放大宽高（等比）", () => {
    const p = maskUvParams(A, { x: 0, y: 0, scale: 2, rotation: 0 })
    expect(p.sizeX).toBeCloseTo(2 * A)
    expect(p.sizeY).toBeCloseTo(2)
  })

  it("角度转弧度（正 = 顺时针，与图片效果同一符号约定）", () => {
    expect(maskUvParams(A, { x: 0, y: 0, scale: 1, rotation: 90 }).rotation).toBeCloseTo(Math.PI / 2)
    expect(maskUvParams(A, { x: 0, y: 0, scale: 1, rotation: -45 }).rotation).toBeCloseTo(
      -Math.PI / 4,
    )
  })

  it("非法的缩放 / 角度 / 位移按恒等兜底，不产生 NaN / 除零", () => {
    const p = maskUvParams(A, {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      scale: 0,
      rotation: Number.NaN,
    })
    expect(p.centerX).toBe(0)
    expect(p.centerY).toBe(0)
    expect(p.sizeX).toBeCloseTo(A)
    expect(p.sizeY).toBeCloseTo(1)
    expect(p.rotation).toBe(0)
  })

  it("卡面比例非法时按 1 兜底", () => {
    const p = maskUvParams(Number.NaN, undefined)
    expect(p.sizeX).toBe(1)
    expect(p.sizeY).toBe(1)
  })
})

describe("maskUvParams 填充方式", () => {
  // 缺省与底图一致取覆盖：等比铺满卡面，宽图会顶满宽度、上下溢出。
  it("缺省即覆盖：按蒙版图比例等比铺满卡面", () => {
    for (const mask of [undefined, {}, { fit: "cover" }] as const) {
      const p = maskUvParams(0.5, mask, 2)
      expect(p.sizeX).toBeCloseTo(2)
      expect(p.sizeY).toBeCloseTo(1)
    }
  })

  it("显式拉伸：忽略蒙版图比例，正好铺满卡面", () => {
    const p = maskUvParams(0.5, { fit: "stretch" }, 2)
    expect(p.sizeX).toBeCloseTo(0.5)
    expect(p.sizeY).toBeCloseTo(1)
  })

  it("覆盖：等比铺满（宽图按宽度顶满、高度溢出）", () => {
    const p = maskUvParams(0.5, { fit: "cover" }, 2)
    expect(p.sizeX).toBeCloseTo(2)
    expect(p.sizeY).toBeCloseTo(1)
  })

  it("覆盖：高图按高度顶满、宽度溢出", () => {
    const p = maskUvParams(0.5, { fit: "cover" }, 0.25)
    expect(p.sizeX).toBeCloseTo(0.5)
    expect(p.sizeY).toBeCloseTo(2)
  })

  it("适应：等比完整可见（宽图按宽度收进卡面）", () => {
    const p = maskUvParams(0.5, { fit: "contain" }, 2)
    expect(p.sizeX).toBeCloseTo(0.5)
    expect(p.sizeY).toBeCloseTo(0.25)
  })

  it("适应：高图按高度收进卡面", () => {
    const p = maskUvParams(0.5, { fit: "contain" }, 0.25)
    expect(p.sizeX).toBeCloseTo(0.25)
    expect(p.sizeY).toBeCloseTo(1)
  })

  it("用户缩放叠在填充方式之上", () => {
    const p = maskUvParams(0.5, { fit: "cover", scale: 2 }, 2)
    expect(p.sizeX).toBeCloseTo(4)
    expect(p.sizeY).toBeCloseTo(2)
  })

  // 纹理尚未解码 / 占位纹理没有尺寸信息：按卡面比例兜底，于是 cover / contain 都退化为拉伸，
  // 不会因为缺信息把蒙版裁掉或缩没。
  it("蒙版图比例未知时按卡面比例兜底（退化为拉伸）", () => {
    for (const fit of ["cover", "contain"] as const) {
      const p = maskUvParams(0.5, { fit }, Number.NaN)
      expect(p.sizeX).toBeCloseTo(0.5)
      expect(p.sizeY).toBeCloseTo(1)
    }
  })
})
