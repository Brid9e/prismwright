/**
 * 程序化蒙版的两个开关：「等边」与「整场翻转 / 旋转」。
 *
 * GLSL 跑不了（node 无 WebGL），故照 `shard-irregular.test.ts` 的老规矩分两半验：
 *
 * - 字符串断言钉住看不见的硬要求：等边关 = 不规则项「乘 1.0」；翻转关 / 旋转 0 = 采样点原封不动
 *   （**除**按下文那步等比换算），且**不要**换成 `mix()`（端点差 1 ulp）。这对存量系列是硬要求。
 * - 另一半是纯几何，用影子函数离线跑：默认处精确等于入参；镜像 / 绕中心旋转按预期落点。
 *
 * 生成空间见 `mask-aspect.test.ts`：整场在**卡面等比坐标**（卡高 = 1）里算，故这里的影子函数
 * 也先乘 uAspect 再旋转。与 common.ts 的 shardCell / shardField 保持一致——**若改动那段几何，
 * 务必同步改这里**。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"

describe("蒙版整场变换的 uniform", () => {
  it("声明了等边 / 翻转 / 旋转四个参数", () => {
    expect(GLSL_COMMON).toContain("float equilateral")
    expect(GLSL_COMMON).toContain("float flipX")
    expect(GLSL_COMMON).toContain("float flipY")
    expect(GLSL_COMMON).toContain("float rotation")
  })

  // 等边以「乘 (1 - 等边)」把不规则度门控掉：关（0）时是「乘 1.0」，逐位无损；开（1）时乘 0，
  // 因子恰好归零 → 形状锁成正多边形。顺序一变默认值就不再是「原式 × 1.0」。
  it("等边把不规则度门控掉，且只以乘法入场", () => {
    expect(GLSL_COMMON).toContain("irregular * (1.0 - equilateral)")
    expect(GLSL_COMMON).not.toMatch(/mix\([^)]*equilateral/)
  })

  // 镜像写成 uv * (1 - 2m) + m：m = 0 时是「乘 1 加 0」，逐位退回 uv（写成 1.0 - uv 的直译会在
  // 默认那侧就动手）。旋转写成 R*iso + (c - R*c) 而非 R*(iso - c) + c——后者的 (x - 0.5) + 0.5
  // 会差 1 ulp，默认值就不再逐位无损。
  it("翻转 / 旋转在默认值处逐位退回原式", () => {
    expect(GLSL_COMMON).toContain("* (1.0 - 2.0 *")
    expect(GLSL_COMMON).not.toMatch(/mix\([^)]*flip[XY]/)
    expect(GLSL_COMMON).not.toContain("(uv - vec2(0.5))")
  })

  // 旋转与 gradient.angle / holoGrid.angle 同口径（度），换算弧度交给着色器。
  it("旋转取度并换算弧度（与其它角度参数同口径）", () => {
    expect(GLSL_COMMON).toContain("radians(rotation)")
  })
})

/** 默认卡面宽高比，与 card-view.ts 的 DEFAULT_ASPECT 同值。 */
const ASPECT = 2.5 / 3.5

/**
 * `shardField` 进网格前那几步的纯函数版本：采样点先镜像、换算到**卡面等比坐标**（卡高 = 1）、
 * 再绕卡面中心旋转。
 *
 * 返回的是等比坐标——它就是屏幕口径（卡片平面 `PlaneGeometry(aspect, 1)` 把宽高比烘进世界坐标
 * 了），故这里的数就是看到的数；要换回 UV 就除以 ASPECT。
 *
 * 与着色器同构（含 `uv * (1 - 2m) + m`、`vec2(p.x * uAspect, p.y)`、`R*iso + (c - R*c)` 三处）。
 */
function transform(
  uv: [number, number],
  flipX: number,
  flipY: number,
  rotationDeg: number,
): [number, number] {
  const iso: [number, number] = [
    (uv[0] * (1 - 2 * flipX) + flipX) * ASPECT,
    uv[1] * (1 - 2 * flipY) + flipY,
  ]
  const r = (rotationDeg * Math.PI) / 180
  const ca = Math.cos(r)
  const sa = Math.sin(r)
  const cx = ASPECT * 0.5
  const cy = 0.5
  const tx = cx - (ca * cx - sa * cy)
  const ty = cy - (sa * cx + ca * cy)
  return [ca * iso[0] - sa * iso[1] + tx, sa * iso[0] + ca * iso[1] + ty]
}

/** 等比坐标 → UV（只为把「翻两次」这类 UV 域的说法写清楚）。 */
function toUv(p: [number, number]): [number, number] {
  return [p[0] / ASPECT, p[1]]
}

describe("整场变换几何（transform）", () => {
  // 默认那侧：除那步有意的等比换算外一个像素都不该动。用精确相等（不是 toBeCloseTo）钉住逐位无损。
  it("默认（不翻不转）只有等比换算，且逐位精确", () => {
    for (const uv of [
      [0.1, 0.7],
      [0.25, 0.4],
      [0.5, 0.5],
      [0, 1],
    ] as [number, number][]) {
      const [x, y] = transform(uv, 0, 0, 0)
      expect(x).toBe(uv[0] * ASPECT)
      expect(y).toBe(uv[1])
    }
  })

  it("左右翻转以卡面竖直中线镜像 x，y 不动", () => {
    const [x, y] = transform([0.25, 0.4], 1, 0, 0)
    expect(x).toBeCloseTo(0.75 * ASPECT, 12)
    expect(y).toBeCloseTo(0.4, 12)
  })

  it("上下翻转以卡面水平中线镜像 y，x 不动", () => {
    const [x, y] = transform([0.25, 0.4], 0, 1, 0)
    expect(x).toBeCloseTo(0.25 * ASPECT, 12)
    expect(y).toBeCloseTo(0.6, 12)
  })

  it("两个翻转可叠加（各自镜像）", () => {
    const [x, y] = transform([0.25, 0.4], 1, 1, 0)
    expect(x).toBeCloseTo(0.75 * ASPECT, 12)
    expect(y).toBeCloseTo(0.6, 12)
  })

  it("翻转两次回到原处", () => {
    const once = transform([0.3, 0.8], 1, 1, 0)
    const twice = transform(toUv(once), 1, 1, 0)
    expect(twice[0] / ASPECT).toBeCloseTo(0.3, 12)
    expect(twice[1]).toBeCloseTo(0.8, 12)
  })

  it("旋转绕卡面中心：180° 把角点送到对角，中心不动", () => {
    const [x, y] = transform([0.25, 0.4], 0, 0, 180)
    expect(x).toBeCloseTo(0.75 * ASPECT, 12)
    expect(y).toBeCloseTo(0.6, 12)
    const [cx, cy] = transform([0.5, 0.5], 0, 0, 180)
    expect(cx).toBeCloseTo(0.5 * ASPECT, 12)
    expect(cy).toBeCloseTo(0.5, 12)
  })

  // 90° 是在**等比坐标**里转的，故屏幕上就是真 90°：卡面中心右侧 0.25 卡高的点，转到中心上方
  // 0.25 卡高处。若还在 UV 里转，同样两个 UV 数在这张 0.714 宽的卡上会转出 90° 以外的角。
  it("旋转 90° 把 +x 方向转到 +y（右手、逆时针，且是屏幕上的真 90°）", () => {
    const [x, y] = transform([0.75, 0.5], 0, 0, 90)
    expect(x).toBeCloseTo(0.5 * ASPECT, 12)
    expect(y).toBeCloseTo(0.5 + 0.25 * ASPECT, 12)
  })

  it("转满一圈回到原处", () => {
    const [x, y] = transform([0.2, 0.9], 0, 0, 360)
    expect(x).toBeCloseTo(0.2 * ASPECT, 12)
    expect(y).toBeCloseTo(0.9, 12)
  })
})

/** `shardCell` 里不规则项的等效因子：等边锁定时归零，于是形状回到正多边形。 */
function irregularAmount(irregular: number, equilateral: number): number {
  return irregular * (1 - equilateral)
}

describe("等边锁定的等效因子", () => {
  it("关闭时就是原样（逐位）", () => {
    expect(irregularAmount(0.8, 0)).toBe(0.8)
    expect(irregularAmount(0, 0)).toBe(0)
  })

  it("打开时归零——无论滑块拖到哪", () => {
    expect(irregularAmount(0.8, 1)).toBe(0)
    expect(irregularAmount(1, 1)).toBe(0)
  })
})
