/**
 * `shardField` 的形状几何影子测试。
 *
 * GLSL 无法在单测里跑，而 `shardCell` 的核心输出是「形状边界半径」这段纯几何。这里把
 * 逐格哈希 / 抖动 / 旋转 / 缩放剥掉，只留「给定极角与形状参数算边界半径」，好把几何性质
 * （关于顶点方向对称、spike=1 是规则多边形、星形内顶点半径）钉住。
 *
 * 与 common.ts 的 shardCell 保持一致——**若改动那段几何，务必同步改这里**。
 */
import { describe, it, expect } from "vitest"

/** shardCell 里「给定极角 θ 与形状参数，算形状边界半径」那一步的纯函数版本。 */
function starRadius(th: number, sides: number, spike: number): number {
  const n = Math.max(sides, 3)
  const phi = Math.PI / n
  const s = spike * Math.cos(phi)
  const da = s * Math.sin(phi)
  const db = s * Math.cos(phi) - 1
  return da / Math.max(da * Math.cos(th) - db * Math.sin(Math.abs(th)), 1e-4)
}

describe("shardField 几何（starRadius）", () => {
  // 形状关于顶点方向（θ = 0）对称：镜像的两侧必须给出同一半径。
  // 曾经这里写成 sin(th) 而非 sin(|th|)，负半侧取到了错误的直线，碎片因此一边鼓出来。
  it("关于顶点方向对称：r(θ) == r(−θ)", () => {
    for (const sides of [3, 4, 5, 6]) {
      for (const spike of [1, 0.38]) {
        for (const th of [0.1, 0.3, 0.5]) {
          expect(starRadius(th, sides, spike)).toBeCloseTo(starRadius(-th, sides, spike), 6)
        }
      }
    }
  })

  // spike = 1 退化为规则 n 边形：边界半径 = 内切圆半径 cos(π/n) 除以 cos(θ − π/n)。
  it("spike = 1 时是规则多边形", () => {
    for (const sides of [3, 4, 5, 6, 8]) {
      const phi = Math.PI / sides
      const apothem = Math.cos(phi)
      for (const th of [0, 0.1, 0.3, phi * 0.9]) {
        expect(starRadius(th, sides, 1)).toBeCloseTo(apothem / Math.cos(th - phi), 6)
      }
    }
  })

  // 星形的内顶点落在半径 s = spike·cos(π/n)、角度 ±π/n 处；两侧都要取到该值。
  it("星形内顶点在半径 spike·cos(π/n)", () => {
    for (const sides of [5, 6]) {
      const phi = Math.PI / sides
      const s = 0.38 * Math.cos(phi)
      expect(starRadius(phi, sides, 0.38)).toBeCloseTo(s, 6)
      expect(starRadius(-phi, sides, 0.38)).toBeCloseTo(s, 6)
    }
  })
})
