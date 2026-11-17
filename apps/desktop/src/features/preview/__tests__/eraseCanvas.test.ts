/**
 * 擦除画布的纯几何约定：UV → 画布像素、画笔颜色与恢复手势。
 *
 * 这里钉的是「画一笔落在哪」：翻错的 Y 轴会让笔迹上下颠倒（画在头顶、擦在脚底），
 * 而画布本身没有断言可看，故在纯函数这一层把它固定住。
 */
import { describe, it, expect } from "vitest"
import {
  ERASE_CANVAS_HEIGHT,
  ERASE_CANVAS_WIDTH,
  eraseCanvasSize,
  brushColor,
  canvasToScreenScale,
  isRestoreGesture,
  isRestoreStroke,
  uvToCanvasPoint,
} from "../eraseCanvas"

describe("uvToCanvasPoint", () => {
  it("卡心落在画布中心", () => {
    expect(uvToCanvasPoint(0.5, 0.5, 500, 700)).toEqual({ x: 250, y: 350 })
  })

  it("v 轴翻转：v=0（贴图底边）对应画布底部，v=1 对应顶部", () => {
    expect(uvToCanvasPoint(0.25, 0, 500, 700)).toEqual({ x: 125, y: 699 })
    expect(uvToCanvasPoint(0.25, 1, 500, 700)).toEqual({ x: 125, y: 0 })
  })

  it("越界 UV 返回 null（指针不在卡面上时不落笔）", () => {
    expect(uvToCanvasPoint(-0.01, 0.5)).toBeNull()
    expect(uvToCanvasPoint(1.01, 0.5)).toBeNull()
    expect(uvToCanvasPoint(0.5, -0.01)).toBeNull()
    expect(uvToCanvasPoint(0.5, 1.01)).toBeNull()
  })

  it("非有限数与非法尺寸返回 null", () => {
    expect(uvToCanvasPoint(Number.NaN, 0.5)).toBeNull()
    expect(uvToCanvasPoint(0.5, Number.POSITIVE_INFINITY)).toBeNull()
    expect(uvToCanvasPoint(0.5, 0.5, 0, 700)).toBeNull()
    expect(uvToCanvasPoint(0.5, 0.5, 500, 0)).toBeNull()
  })

  it("默认尺寸与导出的画布尺寸一致（比例 = 卡面 1 : 1.4）", () => {
    expect(uvToCanvasPoint(0.5, 0.5)).toEqual({
      x: Math.floor(ERASE_CANVAS_WIDTH / 2),
      y: Math.floor(ERASE_CANVAS_HEIGHT / 2),
    })
    expect(ERASE_CANVAS_HEIGHT / ERASE_CANVAS_WIDTH).toBeCloseTo(1.4, 2)
  })
})

describe("brushColor", () => {
  it("默认画笔为黑（擦除），恢复态为白", () => {
    expect(brushColor(false)).toBe("black")
    expect(brushColor(true)).toBe("white")
  })
})

describe("isRestoreGesture", () => {
  it("右键或 Alt 进入恢复态", () => {
    expect(isRestoreGesture({ button: 2, altKey: false })).toBe(true)
    expect(isRestoreGesture({ button: 0, altKey: true })).toBe(true)
    expect(isRestoreGesture({ button: 0, altKey: false })).toBe(false)
  })
})

describe("isRestoreStroke", () => {
  it("默认模式：由手势（右键 / Alt）决定是否恢复", () => {
    expect(isRestoreStroke(false, { button: 0, altKey: false })).toBe(false)
    expect(isRestoreStroke(false, { button: 2, altKey: false })).toBe(true)
  })

  // 工具栏切到「恢复笔」后，手势反向：普通拖动恢复，右键 / Alt 反而擦除。
  it("恢复模式下手势反向", () => {
    expect(isRestoreStroke(true, { button: 0, altKey: false })).toBe(true)
    expect(isRestoreStroke(true, { button: 0, altKey: true })).toBe(false)
  })
})

/**
 * 画笔范围圈的大小：把卡面两条边的屏幕投影长度换成「擦除画布像素 → 屏幕像素」的比例。
 *
 * 圈画得不对不会有报错，只会「和实际擦除范围对不上」——用户据此判断笔触时会被误导，
 * 所以比例这一层在纯函数里钉住。
 */
describe("canvasToScreenScale", () => {
  it("整除时比例即屏幕尺寸 / 画布尺寸（横竖一致）", () => {
    expect(canvasToScreenScale(500, 700, 500, 700)).toBe(1)
    expect(canvasToScreenScale(250, 350, 500, 700)).toBe(0.5)
  })

  it("倾斜缩短横向时取横竖几何平均，而不是只信某一方向", () => {
    // 横向缩到一半（cos 60°）、纵向不变：sqrt(0.5 * 1) ≈ 0.7071。
    expect(canvasToScreenScale(250, 700, 500, 700)).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it("尺寸非法时返回 null（调用方据此不画圈）", () => {
    expect(canvasToScreenScale(0, 700, 500, 700)).toBeNull()
    expect(canvasToScreenScale(500, 700, 0, 700)).toBeNull()
    expect(canvasToScreenScale(NaN, 700, 500, 700)).toBeNull()
  })
})

describe("eraseCanvasSize", () => {
  it("宽度固定 500，高度按卡面宽高比推得", () => {
    expect(eraseCanvasSize(2.5 / 3.5)).toEqual({
      width: ERASE_CANVAS_WIDTH,
      height: ERASE_CANVAS_HEIGHT,
    })
    expect(eraseCanvasSize(1)).toEqual({ width: ERASE_CANVAS_WIDTH, height: ERASE_CANVAS_WIDTH })
  })

  it("比例非法时退回默认画布，不产生零或 NaN 尺寸", () => {
    expect(eraseCanvasSize(0)).toEqual({
      width: ERASE_CANVAS_WIDTH,
      height: ERASE_CANVAS_HEIGHT,
    })
  })
})
