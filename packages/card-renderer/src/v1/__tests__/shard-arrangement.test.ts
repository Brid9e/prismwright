/**
 * `shardCell` 的排布开关（规则 / 随机）契约。
 *
 * GLSL 跑不了（node 无 WebGL），而这个开关带一条**看不见的**硬要求：默认值必须让存量系列的
 * 画面逐像素不变。因此因子只允许以 `* 1.0` / `* 0.0` 的形式入场——写成 `mix()` 会差 1 ulp，
 * 画面整体挪动分毫，单测与 typecheck 却全绿。这里用字符串断言把这件事钉住。
 *
 * 另一半是「规则排布到底把形状摆成什么角度」：那是纯几何，可以在这里用影子函数跑一遍。
 *
 * 与 common.ts 的 shardCell 保持一致——**若改动那段排布，务必同步改这里**。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"

describe("shardCell 的排布开关", () => {
  it("声明了排布参数（arrangement）", () => {
    expect(GLSL_COMMON).toContain("float arrangement")
  })

  it("因子直接取自入参，不做任何平滑过渡", () => {
    expect(GLSL_COMMON).toContain("float jitter = arrangement")
    // mix() 在端点上不是逐位等价：默认值那侧的像素会漂。
    expect(GLSL_COMMON).not.toMatch(/mix\([^)]*arrangement/)
  })

  // 位置、朝向、尺寸三处缺一不可：只归零位置，碎片仍各自乱转（看着还是散的）；只归零朝向，
  // 碎片仍散落在格子里。三处的写法也要钉住——顺序一变（如 jitter 乘到中间），
  // 默认值就不再是「原式 × 1.0」，逐位等价随之作废。
  it("位置 / 朝向 / 尺寸三处都被因子门控", () => {
    expect(GLSL_COMMON).toContain("(vec2(r0, r1) - 0.5) * 0.6 * jitter")
    expect(GLSL_COMMON).toContain("sizeJitter * r3 * jitter")
    // 朝向：随机角乘因子、基准角乘它的补。因子为 1 时第二项乘 0，加 0 逐位无损。
    expect(GLSL_COMMON).toContain("r2 * 6.2831853 * jitter + base * (1.0 - jitter)")
  })
})

/**
 * shardCell 里「规则排布下所有碎片的共同朝向」那一步的纯函数版本。
 *
 * 顶点方向 = base + k·2π/n（外顶点在本地坐标的 θ = 0 处，见 shard-geometry.test.ts）。
 */
function baseAngle(sides: number): number {
  const n = Math.max(sides, 3)
  const step = (2 * Math.PI) / n
  // 奇数边取顶点朝上、偶数边取边朝上下。**判据是「余数 > 0.5」**：写成 «< 0.5» 会把三角
  // 判进偶数分支，尖朝下（这条曾经真写反过，被下面两个用例抓住）。
  const base = n % 2 > 0.5 ? Math.PI / 2 : Math.PI / 2 - step / 2
  return ((base % step) + step) % step
}

/** 顶点方向（弧度），归一化到 [0, 2π)。 */
function vertexAngles(sides: number): number[] {
  const step = (2 * Math.PI) / sides
  return Array.from({ length: sides }, (_, k) => (baseAngle(sides) + k * step) % (2 * Math.PI))
}

const rad = (deg: number) => (deg * Math.PI) / 180
const hasVertexAt = (sides: number, deg: number) =>
  vertexAngles(sides).some((a) => Math.abs(a - rad(deg)) < 1e-9)

describe("规则排布的形状朝向（baseAngle）", () => {
  // 奇数边取「顶点朝上」：三角尖朝上、五角星不歪。基准角是 90° 对步长取余，
  // 故落在离 90° 最近的那个顶点位上。
  it("奇数边：有一个顶点正对 90°", () => {
    expect(hasVertexAt(3, 90)).toBe(true)
    expect(hasVertexAt(5, 90)).toBe(true)
  })

  // 偶数边取「一条边朝上下」：正四边形于是边贴轴（不再成菱形）、六边形平顶。
  // 注意判据是**没有**顶点在 90°（那里是边中点），而不是某个具体角度值——
  // 基准角落到步长的哪一侧都能给出同一套顶点方向。
  it("偶数边：90° 处是边中点，不是顶点", () => {
    expect(hasVertexAt(4, 90)).toBe(false)
    expect(hasVertexAt(6, 90)).toBe(false)
    // 四边形的四个顶点恰在 ±45°、±135°，即边与坐标轴平行。
    expect(hasVertexAt(4, 45)).toBe(true)
    expect(hasVertexAt(4, 135)).toBe(true)
    expect(hasVertexAt(4, 225)).toBe(true)
    expect(hasVertexAt(4, 315)).toBe(true)
  })
})
