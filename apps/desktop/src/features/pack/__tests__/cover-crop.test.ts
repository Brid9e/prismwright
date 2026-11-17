/**
 * 封面裁剪的纯数学：取景框、铺满比例、位移夹取与输出尺寸。
 *
 * 画布 / 指针事件留给组件；这里钉住「拖动和缩放之后到底裁原图的哪一块」，
 * 裁错一个像素，导进去的封面就会在首页横幅上歪掉。
 */
import { describe, expect, it } from "vitest"
import {
  CROP_ZOOM_MAX,
  cropOutputSize,
  cropSourceRect,
  frameSize,
  initialView,
  clampView,
  baseScale,
} from "../cover-crop"

describe("取景框", () => {
  it("大封面是 5:2，小封面是 1:1", () => {
    expect(frameSize("large")).toEqual({ width: 360, height: 144 })
    expect(frameSize("small")).toEqual({ width: 240, height: 240 })
    // 卡包图不进裁剪器：整张铺满袋面，不需要取景框。
  })
})

describe("铺满比例", () => {
  const large = frameSize("large")

  it("取宽高里更大的那个缩放，保证不留白", () => {
    // 1000×1000 放进 360×144：宽只够 0.36，高要 0.144 → 取 0.36
    expect(baseScale(1000, 1000, large)).toBeCloseTo(0.36, 6)
    // 1000×200 放进 360×144：高要 0.72 → 取 0.72
    expect(baseScale(1000, 200, large)).toBeCloseTo(0.72, 6)
  })
})

describe("裁剪区域", () => {
  const large = frameSize("large")

  it("默认取居中那一块", () => {
    // 1000×1000 铺满 5:2 框：宽度全用上，高度只剩 400，上下各留 300
    expect(cropSourceRect(1000, 1000, large, initialView())).toEqual({
      x: 0,
      y: 300,
      width: 1000,
      height: 400,
    })
  })

  it("放大两倍后只取中间的四分之一", () => {
    const rect = cropSourceRect(1000, 1000, large, { zoom: 2, dx: 0, dy: 0 })
    expect(rect).toEqual({ x: 250, y: 400, width: 500, height: 200 })
  })

  it("位移按取景框像素算，夹取后不越界", () => {
    // 铺满后纵向可移 (360 - 144) / 2 = 108px；给 40px 就下移 40px
    const rect = cropSourceRect(1000, 1000, large, { zoom: 1, dx: 0, dy: 40 })
    expect(rect.y).toBeCloseTo(300 - 40 / 0.36, 4)
    expect(rect.height).toBeCloseTo(400, 6)
    // 位移给到 9999 也只会停在边缘，区域始终落回原图内
    const clamped = clampView(1000, 1000, large, { zoom: 1, dx: 9999, dy: -9999 })
    expect(clamped.dx).toBe(0)
    expect(clamped.dy).toBe(-108)
    const edge = cropSourceRect(1000, 1000, large, clamped)
    expect(edge.y + edge.height).toBeCloseTo(1000, 6)
  })

  it("缩放夹在 1 到上限之间", () => {
    expect(clampView(1000, 1000, large, { zoom: 0.2, dx: 0, dy: 0 }).zoom).toBe(1)
    expect(clampView(1000, 1000, large, { zoom: 99, dx: 0, dy: 0 }).zoom).toBe(CROP_ZOOM_MAX)
  })
})

describe("输出尺寸", () => {
  it("大封面最多 1200×480，按原始裁剪块等比缩小", () => {
    expect(cropOutputSize({ x: 0, y: 0, width: 4000, height: 1600 }, "large")).toEqual({
      width: 1200,
      height: 480,
    })
    expect(cropOutputSize({ x: 0, y: 0, width: 800, height: 320 }, "large")).toEqual({
      width: 800,
      height: 320,
    })
  })

  it("小封面最多 384×384，比例始终是 1:1", () => {
    expect(cropOutputSize({ x: 0, y: 0, width: 2000, height: 2000 }, "small")).toEqual({
      width: 384,
      height: 384,
    })
    const odd = cropOutputSize({ x: 0, y: 0, width: 301, height: 301 }, "small")
    expect(odd).toEqual({ width: 301, height: 301 })
  })

  it("头像框输出最多 256×256，成就图标最多 128×128", () => {
    expect(cropOutputSize({ x: 0, y: 0, width: 2000, height: 2000 }, "frame")).toEqual({
      width: 256,
      height: 256,
    })
    expect(cropOutputSize({ x: 0, y: 0, width: 2000, height: 2000 }, "achievement")).toEqual({
      width: 128,
      height: 128,
    })
    expect(cropOutputSize({ x: 0, y: 0, width: 2000, height: 2000 }, "seriesAvatar")).toEqual({
      width: 128,
      height: 128,
    })
  })
})
