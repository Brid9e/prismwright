/**
 * 蒙版的**生成空间**：碎片场必须在「卡面等比」坐标里算，不能直接拿 UV。
 *
 * 卡片平面是 `PlaneGeometry(aspect, 1)`（见 card-view.ts 的 DEFAULT_ASPECT = 2.5/3.5），
 * 它的 uv 属性两轴都是 0–1，于是 **UV 的 u 跨 0.714、v 跨 1**——同一个「1 单位」在屏幕上横向
 * 只有纵向的 0.714 倍。直接拿 UV 当几何空间，图形就被横向压扁 1.4 倍：
 *
 *   等边三角 → 等腰三角（实测边长 1.732 / 1.378 / 1.378），正方形 → 长方形。
 *
 * 「等边」开关因此看着不生效——形状在 UV 里确实精确等边（这点是好的），只是画到屏幕上被拉歪了。
 * 修法是把碎片场换成「卡高 = 1」的等比坐标（与 `roundedRectMask` / `uOffset` 同一口径）：
 * `vec2(p.x * uAspect, p.y)`。于是等边真等边、正方形真正方形，旋转也是屏幕上的真旋转。
 *
 * GLSL 跑不了（node 无 WebGL），故照本仓库的老规矩分两半验：
 *
 * - **字符串断言**钉住真家伙（着色器里那几行）——这是唯一能在改动生产代码时变红的一半；
 * - **影子函数**把几何离线跑一遍（`boundaryRadius` / `verticesInCardSpace`），充当那段数学的
 *   可执行说明书。它测不出着色器改动，故**改动那段几何时必须同步改这里**。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"
import { BASE_FRAGMENT } from "../shaders/base"
import { LAYER_FRAGMENT } from "../shaders/layer"

/** 默认卡面宽高比，与 card-view.ts 的 DEFAULT_ASPECT 同值。 */
const ASPECT = 2.5 / 3.5

describe("碎片场在卡面等比坐标里生成", () => {
  // 进入网格之前先换算：UV → 卡面等比坐标（卡高 = 1）。少了这一行，等边就是假的。
  it("先把 UV 按 uAspect 换成卡面等比坐标，再切网格", () => {
    expect(GLSL_COMMON).toContain("vec2(p.x * uAspect, p.y)")
    // 网格行本身也得在等比坐标里，否则前一行换算完又被 UV 位移拽回去。
    expect(GLSL_COMMON).toMatch(/vec2 g = \([^\n]*uAspect[^\n]*\) \* density;/)
  })

  // 旋转中心必须是**等比坐标里的卡面中心**（aspect/2, 0.5）。写成 (0.5, 0.5) 会把旋转支点挪到
  // 卡面偏右的地方，转起来整场跟着平移。
  it("旋转支点是等比坐标里的卡面中心", () => {
    expect(GLSL_COMMON).toContain("vec2(uAspect * 0.5, 0.5)")
  })

  // uAspect 由宿主片元（layer / base）声明，GLSL_COMMON 只是被拼进去的函数体。声明必须在前，
  // 否则着色器编译不过——而这种错只会在真机上炸，测试里看不出来。
  it.each([
    ["LAYER_FRAGMENT", LAYER_FRAGMENT],
    ["BASE_FRAGMENT", BASE_FRAGMENT],
  ])("%s 在拼入 GLSL_COMMON 之前声明了 uAspect", (_name, src) => {
    const decl = src.indexOf("uniform float uAspect")
    const common = src.indexOf("float shardField(")
    expect(decl).toBeGreaterThan(-1)
    expect(common).toBeGreaterThan(-1)
    expect(decl).toBeLessThan(common)
  })
})

/** `shardCell` 的极坐标边界 r(θ)：spike = 1，于是一个 n 边形的顶点半径恰好是 1。 */
function boundaryRadius(th: number, n: number): number {
  const phi = Math.PI / n
  const s = Math.cos(phi) // spike = 1
  const da = s * Math.sin(phi)
  const db = s * Math.cos(phi) - 1
  const t = ((((th + phi) % (2 * phi)) + 2 * phi) % (2 * phi)) - phi
  return da / Math.max(da * Math.cos(t) - db * Math.sin(Math.abs(t)), 1e-4)
}

/**
 * 一个规则排布碎片（spike = 1、不规则 0）的顶点**在屏幕上**的位置。
 *
 * 与着色器同构：`base` 是规则排布的共同朝向（见 shardCell），顶点在其上按 2π/n 均分。
 *
 * 这里**不**乘 aspect——正是修好的那一点：着色器在卡面等比坐标里算，而卡面等比坐标就是世界
 * 坐标（卡片平面 `PlaneGeometry(aspect, 1)` 已经把宽高比烘进坐标里了），故数学空间的位置直接
 * 就是屏幕上的位置。修之前数学空间是 UV，屏幕上还要再乘一次 aspect，于是形状与卡面宽高比有关
 * ——下面 `it.each(ASPECTS)` 因此是在验「形状与卡面宽高比**无关**」。
 */
function onScreenVertices(n: number): [number, number][] {
  const angStep = (2 * Math.PI) / n
  const base =
    n % 2 === 1 ? (Math.PI / 2) % angStep : (Math.PI / 2 - angStep * 0.5 + 2 * Math.PI) % angStep
  const ca = Math.cos(base)
  const sa = Math.sin(base)
  return Array.from({ length: n }, (_, k) => {
    // 形状本地帧里顶点在 θ ≡ 0 (mod 2π/n)：r(θ) 在这些方向上取到 1。
    const th = k * angStep
    const r = boundaryRadius(th, n)
    const x = r * Math.cos(th)
    const y = r * Math.sin(th)
    // 再按规则排布的共同朝向 base 摆正（着色器里是 ang 的 jitter = 0 那一支）。
    return [ca * x - sa * y, sa * x + ca * y]
  })
}

/** 依次相连的边长（闭合）。 */
function sideLengths(v: [number, number][]): number[] {
  return v.map((p, i) => {
    const q = v[(i + 1) % v.length]
    return Math.hypot(q[0] - p[0], q[1] - p[1])
  })
}

/** 相邻边的夹角（度）。 */
function interiorAngles(v: [number, number][]): number[] {
  return v.map((p, i) => {
    const prev = v[(i - 1 + v.length) % v.length]
    const next = v[(i + 1) % v.length]
    const a: [number, number] = [prev[0] - p[0], prev[1] - p[1]]
    const b: [number, number] = [next[0] - p[0], next[1] - p[1]]
    const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
  })
}

describe("等比坐标里的形状（影子几何）", () => {
  // 这一条是**说明书**（影子几何测不出着色器改动，门在上面的字符串断言）：把两种空间并排摆出来，
  // 钉住用户看到的那种形状。同一个正三角（顶点朝上），在 UV 里算是「等腰、底更短」，在卡面等比
  // 坐标里算才是等边。
  it("同样一个等边三角：在 UV 里算是等腰，在卡面等比坐标里算才等边", () => {
    const regular = onScreenVertices(3) // 卡面等比坐标 = 世界坐标
    // 修之前：数学空间是 UV，画到屏幕上还得再乘一次 aspect（横向被压）。
    const preFix = regular.map(([x, y]): [number, number] => [x * ASPECT, y])

    // 顶点朝上 ⇒ 0 与 2 是两腰、1 是底。UV 空间里两腰被同样压扁、底是水平的被压得最狠：
    // 1.7321 的等边三角 → 两腰 1.6226、底 1.2372 的等腰三角。
    const bad = sideLengths(preFix)
    expect(bad[0]).toBeCloseTo(bad[2], 12)
    expect(bad[1]).toBeLessThan(bad[0])
    expect(bad[0]).toBeCloseTo(1.6226, 3)
    expect(bad[1]).toBeCloseTo(1.2372, 3)

    // 修之后：三边等长、三角 60°。
    const good = sideLengths(regular)
    for (const s of good) expect(s).toBeCloseTo(good[0], 12)
    expect(good[0]).toBeCloseTo(1.7321, 3)
    for (const a of interiorAngles(regular)) expect(a).toBeCloseTo(60, 12)
  })

  // 正方形同理：四边等长**且**四角 90°。只钉边长会漏掉菱形——修之前 X 方向压扁恰好把 45° 摆位
  // 的正方形压成四边仍等长的菱形，只查边长是查不出来的。
  it("正四边形在卡面等比坐标里是正方形（四边等长 + 四角 90°）", () => {
    const v = onScreenVertices(4)
    const sides = sideLengths(v)
    for (const s of sides) expect(s).toBeCloseTo(sides[0], 12)
    for (const a of interiorAngles(v)) expect(a).toBeCloseTo(90, 12)
  })
})
