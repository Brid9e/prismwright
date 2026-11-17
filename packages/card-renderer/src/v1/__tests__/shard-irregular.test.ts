/**
 * `shardCell` 的「不规则度」契约。
 *
 * 不规则度是给规则多边形加随机顶点的开关：等边三角 → 随机三角，拉高即参考图那种碎片感。
 * GLSL 跑不了（node 无 WebGL），故分两半验证：
 *
 * - 字符串断言钉住两件看不见的硬要求：（1）不规则为 0 时因子必须是「乘 1.0」（逐位无损，存量
 *   系列画面不变）；（2）**不要**换成 `mix()`（它在端点差 1 ulp）。
 * - 另一半是纯几何（顶点缩放随角度怎么变），用影子函数离线跑：不规则 0 时恒为 1、顶点处取该
 *   顶点的散列、以及对 n 取模带来的 ±π 连续（否则正 -x 轴那儿会有一道接缝）。
 *
 * 与 common.ts 的 shardCell 保持一致——**若改动那段几何，务必同步改这里**。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"

describe("shardCell 的不规则开关", () => {
  it("声明了不规则参数（irregular）", () => {
    expect(GLSL_COMMON).toContain("float irregular")
  })

  // 因子只以「乘 (1 + 0)」入场：不规则为 0 时是「乘 1.0」，逐位无损。顺序一变（如把因子
  // 乘到 base 里）默认值就不再到「原式 × 1.0」，逐位等价随之作废。
  it("因子直接取自入参、只以乘法入场、不做平滑过渡", () => {
    expect(GLSL_COMMON).toContain("rshape *= 1.0 + irr * (vscale - 0.5)")
    // mix() 在端点上不是逐位等价：默认值那侧的像素会漂。
    expect(GLSL_COMMON).not.toMatch(/mix\([^)]*irregular/)
  })

  // 顶点序号要对 n 取模：否则 a = ±π（正 -x 轴）落到两个不同序号上，接缝处的半径会跳。
  it("顶点序号对 n 取模（±π 无接缝）", () => {
    expect(GLSL_COMMON).toContain("mod(k0, n)")
    expect(GLSL_COMMON).toContain("mod(k0 + 1.0, n)")
  })
})

/**
 * shardCell 里「顶点缩放」那一步的纯函数版本：给定极角与散列，返回恒为 1 附近的缩放因子。
 *
 * 无规则的顶点缩放 = 1（逐位无损）；有规则时是按「顶点散列」在相邻两顶点间**分段线性**。
 */
function irregularScale(
  a: number,
  sides: number,
  irregular: number,
  hash: (vertex: number) => number,
): number {
  const n = Math.max(sides, 3)
  const angStep = (2 * Math.PI) / n
  const kf = a / angStep
  const k0 = Math.floor(kf)
  const fr = kf - k0
  const mod = (x: number, y: number) => ((x % y) + y) % y
  const v0 = hash(mod(k0, n))
  const v1 = hash(mod(k0 + 1, n))
  // mix 的展开：v0 * (1 - fr) + v1 * fr，与着色器同构。
  const vscale = v0 + (v1 - v0) * fr
  return 1 + irregular * (vscale - 0.5)
}

/** 确定性的顶点散列（只要给出互不相同的值即可，不需要复刻 GLSL 的 hash21）。 */
const hash = (v: number) => (((Math.sin(v * 12.9898) * 43758.5453) % 1) + 1) % 1

describe("不规则度几何（irregularScale）", () => {
  // 默认那侧：不规则 0 时缩放恒为 1，任何角度 / 边数都不能有一丝偏移。
  it("不规则为 0 时恒等于 1", () => {
    for (const sides of [3, 4, 5, 6]) {
      for (const deg of [0, 37, 90, 180, 359]) {
        const a = (deg * Math.PI) / 180
        expect(irregularScale(a, sides, 0, hash)).toBe(1)
      }
    }
  })

  // a = ±π 是同一个方向：对 n 取模后必须给出同一缩放，否则半径在那儿跳一下（接缝）。
  it("±π 连续（同一个顶点）", () => {
    for (const sides of [3, 4, 5, 6]) {
      expect(irregularScale(Math.PI, sides, 1, hash)).toBeCloseTo(
        irregularScale(-Math.PI, sides, 1, hash),
        12,
      )
    }
  })

  // 周期 2π：绕一圈回到原处，缩放一致。
  it("以 2π 为周期", () => {
    for (const sides of [3, 4, 5, 6]) {
      for (const deg of [10, 55, 123]) {
        const a = (deg * Math.PI) / 180
        expect(irregularScale(a + 2 * Math.PI, sides, 1, hash)).toBeCloseTo(
          irregularScale(a, sides, 1, hash),
          12,
        )
      }
    }
  })

  // 顶点处取该顶点的散列：a = k·(2π/n) 上，缩放 = 1 + irregular·(hash(k mod n) − 0.5)。
  // 这是「等边三角 → 随机三角」的落点：三个角各自被推到不同半径。
  it("顶点处取该顶点的散列值", () => {
    const sides = 4
    const n = sides
    const angStep = (2 * Math.PI) / n
    for (let k = -6; k < 6; k++) {
      const a = k * angStep
      const v = ((k % n) + n) % n
      expect(irregularScale(a, sides, 1, hash)).toBeCloseTo(1 + (hash(v) - 0.5), 12)
    }
  })
})
