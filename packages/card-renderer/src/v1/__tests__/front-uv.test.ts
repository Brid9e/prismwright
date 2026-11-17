/**
 * 底图 UV 变换的纯函数契约（三种填充方式 + 偏移 + 缩放 + 旋转）。
 *
 * 放在 node 里测而不是靠看画面：拉伸 / 覆盖 / 适应三者的缩放公式只在「图片比例 ≠ 卡面比例」
 * 时才分叉；旋转在非方形卡面上又必须做宽高比换算。肉眼很难从一张已经变形的图上看出是公式
 * 错了还是本来就该这样，故用「某个卡面点采到图片上的哪个点」来钉。
 */
import { describe, expect, it } from "vitest"
import { frontUvTransform, sampleFrontUv, type FrontUvTransform } from "../front-uv"

/** 卡面宽高比（宽/高），与 CARD_ASPECT 同值，直接写出来以免测试依赖渲染常量。 */
const A = 2.5 / 3.5

/**
 * 按着色器的同一套算式求「卡面 uv → 底图 uv」。
 *
 * 矩阵按列主序存放在 `matrix` 里（与 GLSL `mat2(col0, col1)` 同序）：
 * `[m00, m10, m01, m11]`，于是 `x' = m00*x + m01*y`、`y' = m10*x + m11*y`。
 * 这里逐字复刻片元的两次乘加，若实现改了约定，测试与着色器会一起失配而非悄悄漂移。
 */
function sample(t: FrontUvTransform, u: number, v: number): [number, number] {
  const [m00, m10, m01, m11] = t.matrix
  const x = u - 0.5
  const y = v - 0.5
  return [m00 * x + m01 * y + 0.5 + t.offsetU, m10 * x + m11 * y + 0.5 + t.offsetV]
}

/** 断言两个采样坐标在容差内相等。 */
function expectUv(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0])
  expect(actual[1]).toBeCloseTo(expected[1])
}

describe("frontUvTransform 填充方式", () => {
  it("拉伸：原样采样整张图（加此字段之前的观感）", () => {
    const t = frontUvTransform({ imageAspect: 2, cardAspect: A, fit: "stretch" })
    expectUv(sample(t, 0, 0), [0, 0])
    expectUv(sample(t, 0.5, 0.5), [0.5, 0.5])
    expectUv(sample(t, 1, 1), [1, 1])
  })

  it("覆盖：比例相同时与拉伸等价", () => {
    const t = frontUvTransform({ imageAspect: A, cardAspect: A, fit: "cover" })
    expectUv(sample(t, 0, 0), [0, 0])
    expectUv(sample(t, 1, 1), [1, 1])
  })

  it("覆盖：宽图按高度顶满，左右只采中间一段", () => {
    // 图片 2:1，卡面 0.714:1 → 高顶满时只采到中间 0.714/2 的横向范围。
    const t = frontUvTransform({ imageAspect: 2, cardAspect: A, fit: "cover" })
    expect(t.matrix[0]).toBeCloseTo(A / 2)
    expect(t.matrix[3]).toBeCloseTo(1)
    expectUv(sample(t, 0, 0.5), [0.5 - A / 4, 0.5])
  })

  it("覆盖：高图按宽度顶满，上下只采中间一段", () => {
    // 图片 0.4:1，卡面 0.714:1 → 宽顶满时只采中间 1/1.786 的纵向范围。
    const t = frontUvTransform({ imageAspect: 0.4, cardAspect: A, fit: "cover" })
    expect(t.matrix[0]).toBeCloseTo(1)
    expect(t.matrix[3]).toBeCloseTo(0.4 / A)
  })

  it("适应：宽图横向铺满、上下留空（采样越界 → 卡面底色）", () => {
    const t = frontUvTransform({ imageAspect: 2, cardAspect: A, fit: "contain" })
    expect(t.matrix[0]).toBeCloseTo(1)
    expect(t.matrix[3]).toBeCloseTo(2 / A)
    // 卡面顶边已越过图片上沿。
    expect(sample(t, 0.5, 1)[1]).toBeGreaterThan(1)
  })

  it("适应：高图纵向铺满、左右留空", () => {
    const t = frontUvTransform({ imageAspect: 0.4, cardAspect: A, fit: "contain" })
    expect(t.matrix[0]).toBeCloseTo(A / 0.4)
    expect(t.matrix[3]).toBeCloseTo(1)
    expect(sample(t, 0, 0.5)[0]).toBeLessThan(0)
  })
})

describe("frontUvTransform 偏移", () => {
  it("偏移按卡高换算，且正方向是「图片向右 / 向上移」", () => {
    // 卡宽 0.5、高 1：向右移 0.1 个卡高 = 0.2 个 uv（卡宽的一半），采样坐标反向平移。
    const t = frontUvTransform({
      imageAspect: 1,
      cardAspect: 0.5,
      fit: "stretch",
      offsetX: 0.1,
      offsetY: 0.1,
    })
    expect(t.offsetU).toBeCloseTo(-0.2)
    expect(t.offsetV).toBeCloseTo(-0.1)
    // 卡面中心采到图片中心左侧 / 下方 0.1 卡高的位置。
    expectUv(sample(t, 0.5, 0.5), [0.3, 0.4])
  })

  it("偏移的观感与填充方式无关：同一个滑块值在任何模式下挪同样远的卡面距离", () => {
    // 覆盖模式下采样跨度 < 1，uv 位移要同比缩小，屏幕上才是同样的 0.1 卡高。
    const cover = frontUvTransform({
      imageAspect: 2,
      cardAspect: 0.5,
      fit: "cover",
      offsetX: 0.1,
    })
    expect(cover.offsetU).toBeCloseTo(-0.2 * (0.5 / 2))
  })
})

describe("frontUvTransform 缩放", () => {
  it("缩放 2 倍：采样跨度减半（同一块卡面只采图片中间一半）", () => {
    const t = frontUvTransform({ imageAspect: A, cardAspect: A, fit: "cover", scale: 2 })
    expect(t.matrix[0]).toBeCloseTo(0.5)
    expect(t.matrix[3]).toBeCloseTo(0.5)
    expectUv(sample(t, 0, 0), [0.25, 0.25])
  })

  it("缩放 0.5 倍：卡面四角采到图片之外（露出卡面底色）", () => {
    const t = frontUvTransform({ imageAspect: A, cardAspect: A, fit: "cover", scale: 0.5 })
    expectUv(sample(t, 0, 0), [-0.5, -0.5])
    expectUv(sample(t, 0.5, 0.5), [0.5, 0.5])
  })

  it("缩放不改变图片中心的位置（偏移量仍按卡高计）", () => {
    // 图片中心在卡面 (0.6, 0.5)；放大两倍后，中心仍落在同一处。
    const t = frontUvTransform({
      imageAspect: A,
      cardAspect: A,
      fit: "cover",
      offsetX: 0.1 * A,
      scale: 2,
    })
    expectUv(sample(t, 0.6, 0.5), [0.5, 0.5])
  })

  it("非正 / 非有限的缩放按 1 兜底，不把画面清零", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = frontUvTransform({ imageAspect: A, cardAspect: A, fit: "cover", scale: bad })
      expect(t.matrix[0]).toBeCloseTo(1)
      expect(t.matrix[3]).toBeCloseTo(1)
    }
  })
})

describe("frontUvTransform 旋转", () => {
  it("默认 0 度：与不旋转逐字一致", () => {
    const t = frontUvTransform({ imageAspect: 2, cardAspect: A, fit: "cover", rotation: 0 })
    expect(t.matrix[1]).toBeCloseTo(0)
    expect(t.matrix[2]).toBeCloseTo(0)
  })

  it("正角度 = 图片顺时针转：卡面右边采到图片上边", () => {
    // 卡面 0.5 宽（半宽 0.25）。顺时针转 90° 后，图片的上半部分转到卡面右侧：
    // 卡面右中这个点（0.25 卡单位）应采到图片中心正上方同一个卡单位距离处。
    const t = frontUvTransform({ imageAspect: 0.5, cardAspect: 0.5, fit: "stretch", rotation: 90 })
    // 卡面高 1，故 0.25 卡单位 = 图片 v 方向的 0.25（半高 0.5 的一半）。
    expectUv(sample(t, 1, 0.5), [0.5, 0.75])
  })

  it("旋转在卡面坐标里做：非方形卡面上转 90° 不会把图片拉斜", () => {
    // 同一张方图铺满 0.5 宽的卡面再转 90°：卡面上下两个对应点应采到图片左右对称的两点。
    const t = frontUvTransform({ imageAspect: 2, cardAspect: A, fit: "cover", rotation: 90 })
    const top = sample(t, 0.5, 1)
    const bottom = sample(t, 0.5, 0)
    // 上下对称 ⇒ 采到的图片点左右对称（绕图片中心），距离相等。
    expect(top[1]).toBeCloseTo(0.5)
    expect(bottom[1]).toBeCloseTo(0.5)
    expect(top[0] - 0.5).toBeCloseTo(0.5 - bottom[0])
  })

  it("旋转绕图片中心：偏移后的图片中心仍采到纹理中心", () => {
    const t = frontUvTransform({
      imageAspect: 2,
      cardAspect: A,
      fit: "cover",
      offsetX: 0.1,
      offsetY: -0.2,
      rotation: 37,
      scale: 1.5,
    })
    // 图片中心在卡面 (0.5 + 0.1/A, 0.5 - 0.2)。
    expectUv(sample(t, 0.5 + 0.1 / A, 0.5 - 0.2), [0.5, 0.5])
  })

  it("非有限的旋转按 0 兜底", () => {
    const t = frontUvTransform({
      imageAspect: A,
      cardAspect: A,
      fit: "cover",
      rotation: Number.NaN,
    })
    expect(t.matrix[1]).toBeCloseTo(0)
    expect(t.matrix[2]).toBeCloseTo(0)
  })
})

describe("frontUvTransform 兜底", () => {
  it("比例非法时按方图兜底，不产生 NaN / 除零", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = frontUvTransform({ imageAspect: bad, cardAspect: A, fit: "cover" })
      expect(t.matrix.every((n) => Number.isFinite(n))).toBe(true)
      expect(Number.isFinite(t.offsetU)).toBe(true)
      expect(Number.isFinite(t.offsetV)).toBe(true)
    }
  })
})

// 吸管在桌面端取原图像素时要自己走一遍「卡面 uv → 底图 uv」：不导出这一步，桌面端就只能
// 手抄公式（两份漂移 = 吸到的颜色与看到的画面错位）。这里钉住它与片元用的是同一个式子。
describe("sampleFrontUv", () => {
  it("与片元同一式子：卡面 uv → 底图 uv", () => {
    const t = frontUvTransform({
      imageAspect: 2,
      cardAspect: A,
      fit: "cover",
      offsetX: 0.1,
      offsetY: -0.2,
      scale: 1.5,
      rotation: 37,
    })
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [0.25, 0.8],
    ]) {
      const got = sampleFrontUv(t, u, v)
      expectUv([got.u, got.v], sample(t, u, v))
    }
  })
})
