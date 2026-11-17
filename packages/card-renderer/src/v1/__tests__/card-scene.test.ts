/**
 * 「贴合卡面」取景角（{@link fitFov}）的契约。
 *
 * 离屏导出靠它把卡面**正好**填满画幅：角度算错不会报错，只会让导出的图或留白、或被裁边——
 * 而这类偏差在一张缩略图上肉眼很难判「差了几像素」。故不钉死某一个魔数，而是钉住**定义式**：
 * 在距离 d 处可见的竖直半高必须恰好等于平面半高（`d * tan(fov/2) === planeHeight / 2`）。
 * 用什么距离、什么高度都成立，才是「贴合」的正确含义。
 */
import { describe, it, expect } from "vitest"
import { CARD_ASPECT, createCardSlab, fitFov } from "../card-scene"

/** 角度转弧度。 */
const toRad = (deg: number): number => (deg * Math.PI) / 180

describe("fitFov", () => {
  it("使距离处可见的竖直半高恰好等于平面半高（定义式）", () => {
    for (const [planeHeight, distance] of [
      [1, 4],
      [1, 2],
      [1, 10],
      [3.5, 4],
    ]) {
      const halfVisible = distance * Math.tan(toRad(fitFov(planeHeight, distance)) / 2)
      expect(halfVisible).toBeCloseTo(planeHeight / 2, 10)
    }
  })

  it("高度 1、距离 4（预览基准距离）时约 14.25°（窄于交互视图的 35° 取景）", () => {
    // 交互视图用 35° 留白给倾斜与摆动；贴合取景只到约 14.25°，卡面才正好顶满画幅。
    expect(fitFov(1, 4)).toBeCloseTo(14.25, 2)
  })

  it("距离越远，取景角越小（透视投影的必然）", () => {
    expect(fitFov(1, 8)).toBeLessThan(fitFov(1, 4))
  })
})

/**
 * 与 `shaders/common.ts` 的 `roundedRectMask` 同一口径的圆角矩形 SDF。
 *
 * 卡面靠它做圆角遮盖（> 0 即在卡面之外、看不见）；侧壁是**实体几何**，不吃着色器遮盖。
 * 两者必须重合：侧壁一旦探出遮盖，就在卡面的透明处露出那条浅色切边。
 */
const cornerMaskSdf = (x: number, y: number, aspect: number, radius: number): number => {
  const qx = Math.abs(x) - aspect / 2 + radius
  const qy = Math.abs(y) - 0.5 + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

describe("卡片侧壁", () => {
  const radius = 0.06
  const slab = createCardSlab(CARD_ASPECT, radius)
  const pos = slab.geometry.attributes.position

  /** 所有顶点里离卡面遮盖最远的那个：正 = 探出遮盖，负 = 缩在里面。 */
  const worstSdf = (): number => {
    let worst = -Infinity
    for (let i = 0; i < pos.count; i++) {
      worst = Math.max(worst, cornerMaskSdf(pos.getX(i), pos.getY(i), CARD_ASPECT, radius))
    }
    return worst
  }

  it("轮廓不探出卡面的圆角遮盖（圆角处白边的成因）", () => {
    // 用二次贝塞尔近似圆角时，它在 45° 处比正圆**外凸**约 6% 半径：半径 0.06、卡高 1 时
    // 外凸 0.0036——屏幕上就是四角那条几像素宽的浅色切边。
    expect(worstSdf()).toBeLessThanOrEqual(1e-6)
  })

  it("轮廓与卡面贴齐，不缩进（缩进会让直边露出缝隙）", () => {
    expect(worstSdf()).toBeGreaterThanOrEqual(-1e-6)
  })
})
