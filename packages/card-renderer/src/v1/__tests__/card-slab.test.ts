/**
 * 卡片厚度的几何契约（{@link createCardSlab}）。
 *
 * 厚度是「倾斜时才看得见」的错觉：正视角下侧壁与视线平行、投不出像素。正因为看不见，
 * 几何摆错位置（比如板子跑到卡面前面、或封盖没关）不会立刻报错，却会在镂空处垫出一块底色、
 * 或在导出图边缘多出一圈毛边。这几条断言钉住「板子只在卡面之后、只有侧壁会画」。
 */
import { describe, expect, it } from "vitest"
import type { Material, MeshBasicMaterial } from "three"
import { CARD_THICKNESS, clampCornerRadius, createCardSlab } from "../card-scene"

const A = 2.5 / 3.5

describe("createCardSlab", () => {
  it("厚度是「一点点」：远小于卡高 1", () => {
    expect(CARD_THICKNESS).toBeGreaterThan(0)
    expect(CARD_THICKNESS).toBeLessThan(0.05)
  })

  // 厚度是目测定下的观感值（2026-10-29 从 0.015 减半、2026-11-06 再减到 0.003：真实卡厚
  // 0.76mm 按比例算出来显得太厚，倾斜时像一块砖；圆角侧壁比真实卡纸更容易显厚）。
  // 0.003 在真机上又薄到几乎看不出边，2026-11-12 回调到 0.006 的一半。
  // 它不是推导出来的，改动应当是有意为之，故钉住当前取值。
  it("厚度钉在 0.006 卡高", () => {
    // 精度取 4：默认的 2 位容差是 ±0.005，整条断言等于没钉。
    expect(CARD_THICKNESS).toBeCloseTo(0.006, 4)
  })

  it("板子整体位于卡面之后（z ∈ [-厚度, 0]），不与卡面抢深度", () => {
    const slab = createCardSlab(A, 0.06)
    slab.geometry.computeBoundingBox()
    const box = slab.geometry.boundingBox!
    expect(box.max.z).toBeCloseTo(0, 6)
    expect(box.min.z).toBeCloseTo(-CARD_THICKNESS, 6)
  })

  it("外轮廓与卡面一致（宽 = 卡面宽高比，高 = 1）", () => {
    const slab = createCardSlab(A, 0.06)
    slab.geometry.computeBoundingBox()
    const box = slab.geometry.boundingBox!
    expect(box.min.x).toBeCloseTo(-A / 2, 5)
    expect(box.max.x).toBeCloseTo(A / 2, 5)
    expect(box.min.y).toBeCloseTo(-0.5, 5)
    expect(box.max.y).toBeCloseTo(0.5, 5)
  })

  it("切边是深色卡芯：浅色页面底上也要看得见", () => {
    // 真卡（游戏王这种）是白面纸夹一层深色卡芯，切边看过去是一条黑影；
    // 我们用浅灰白时，页面底色本身也偏白，倾斜时整条边糊没了。
    const materials = createCardSlab(A, 0.06).material as MeshBasicMaterial[]
    const { r, g, b } = materials[1].color
    expect(Math.max(r, g, b)).toBeLessThan(0.2)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.06)
  })

  it("封盖不画、侧壁要画", () => {
    // 封盖若可见，就会给整张卡垫一层实色：镂空与圆角外的透明都会失效。
    const materials = createCardSlab(A, 0.06).material as Material[]
    expect(Array.isArray(materials)).toBe(true)
    expect(materials).toHaveLength(2)
    expect(materials[0].visible).toBe(false)
    expect(materials[1].visible).toBe(true)
  })

  it("圆角折线足够密：倾斜时侧壁轮廓不出现肉眼可见的折角", () => {
    const radius = 0.06
    const pos = createCardSlab(A, radius).geometry.getAttribute("position")
    // 只看右上角那段圆弧：取圆心，把落在这 90° 象限内的顶点按角度排开。
    const cx = A / 2 - radius
    const cy = 0.5 - radius
    const angles: number[] = []
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i) - cy, pos.getX(i) - cx)
      if (a > 1e-4 && a < Math.PI / 2 - 1e-4) angles.push(a)
    }
    angles.sort((p, q) => p - q)
    // 相邻顶点的角度差就是侧壁上的一段直线；差越大，倾斜时那一段越像被折了一下。
    const gaps = [angles[0], Math.PI / 2 - angles[angles.length - 1]]
    for (let i = 1; i < angles.length; i++) gaps.push(angles[i] - angles[i - 1])
    const maxGapDeg = (Math.max(...gaps) * 180) / Math.PI
    expect(maxGapDeg).toBeLessThan(6)
  })

  it("圆角半径超过半宽 / 半高时被夹住，几何仍然合法", () => {
    const slab = createCardSlab(A, 5)
    slab.geometry.computeBoundingBox()
    const box = slab.geometry.boundingBox!
    expect(Number.isFinite(box.min.x)).toBe(true)
    expect(box.max.x - box.min.x).toBeCloseTo(A, 5)
    expect(box.max.y - box.min.y).toBeCloseTo(1, 5)
  })
})

describe("clampCornerRadius", () => {
  it("正常半径原样返回", () => {
    expect(clampCornerRadius(1, 0.4)).toBeCloseTo(0.4)
    expect(clampCornerRadius(A, 0.06)).toBeCloseTo(0.06)
  })

  it("窄卡被半宽夹住（着色器与几何必须同一条规则）", () => {
    expect(clampCornerRadius(0.5, 0.4)).toBeCloseTo(0.25)
  })

  it("上限是 0.5（完全圆头），负数归零", () => {
    expect(clampCornerRadius(2, 2)).toBe(0.5)
    expect(clampCornerRadius(A, -1)).toBe(0)
  })
})
