import { describe, it, expect } from "vitest"
import { DEFAULT_PALETTE, DEFAULT_STOPS } from "@cardbara/schema"
import {
  MAX_PALETTE,
  padPalette,
  paletteUniforms,
  sampleRamp,
  sampleRampAlpha,
} from "../palette"

const stops = (pairs: [string, number][]) => pairs.map(([color, at]) => ({ color, at }))

describe("palette", () => {
  it("把不足 MAX_PALETTE 的颜色用末色补齐", () => {
    const out = padPalette(["#FFD700", "#0099FF"])
    expect(out).toHaveLength(MAX_PALETTE)
    expect(out[0]).toBe("#FFD700")
    expect(out[1]).toBe("#0099FF")
    expect(out[MAX_PALETTE - 1]).toBe("#0099FF")
  })

  it("超过 MAX_PALETTE 时截断", () => {
    const many = Array.from({ length: MAX_PALETTE + 4 }, (_, i) => `#00000${i % 10}`)
    const out = padPalette(many)
    expect(out).toHaveLength(MAX_PALETTE)
    expect(out[0]).toBe(many[0])
    expect(out[MAX_PALETTE - 1]).toBe(many[MAX_PALETTE - 1])
  })

  it("空数组回退到默认色板", () => {
    expect(padPalette([])[0]).toBe(DEFAULT_PALETTE[0])
  })

  it("DEFAULT_STOPS 与 DEFAULT_PALETTE 一一对应且等距（位置 0, 1/(N-1), …, 1）", () => {
    expect(DEFAULT_STOPS.map((s) => s.color)).toEqual([...DEFAULT_PALETTE])
    DEFAULT_STOPS.forEach((stop, i) => {
      expect(stop.at).toBeCloseTo(i / (DEFAULT_PALETTE.length - 1))
    })
  })

  it("paletteUniforms 把颜色与位置都补齐到 MAX_PALETTE", () => {
    const { colors, positions } = paletteUniforms(
      stops([
        ["#111111", 0],
        ["#222222", 1],
      ]),
    )
    expect(colors).toHaveLength(MAX_PALETTE)
    expect(positions).toHaveLength(MAX_PALETTE)
    expect(colors.slice(0, 2)).toEqual(["#111111", "#222222"])
    expect(colors[MAX_PALETTE - 1]).toBe("#222222")
    // 位置也用末项重复：补出来的段 span 为 0，着色器里被 1e-5 兜住，混了等于没混。
    expect(positions).toEqual([0, 1, 1, 1, 1, 1, 1, 1])
  })

  it("paletteUniforms 同时给出与颜色等长的透明度和位置", () => {
    const { alphas } = paletteUniforms(
      stops([
        ["#11111100", 0],
        ["#222222ff", 1],
      ]),
    )
    expect(alphas).toHaveLength(MAX_PALETTE)
    expect(alphas[0]).toBe(0)
    expect(alphas[1]).toBe(1)
    // 补齐项跟末色走：末色不透明，补出来的段也就不会把箔裁没。
    expect(alphas[MAX_PALETTE - 1]).toBe(1)
  })

  it("sampleRampAlpha 与 sampleRamp 用同一组混色权重", () => {
    const { colors, positions } = paletteUniforms(
      stops([
        ["#00000000", 0],
        ["#ffffffff", 1],
      ]),
    )
    // 中点：颜色混到 #808080（sRGB 直接线性混合），透明度也应是两者中点 0.5。
    expect(sampleRamp(0.5, positions, colors)).toBe("#808080")
    expect(sampleRampAlpha(0.5, positions, colors)).toBeCloseTo(0.5, 10)
    expect(sampleRampAlpha(0, positions, colors)).toBe(0)
    expect(sampleRampAlpha(1, positions, colors)).toBe(1)
  })

  it("paletteUniforms 保留非等距的位置", () => {
    const { colors, positions } = paletteUniforms(
      stops([
        ["#111111", 0.3],
        ["#222222", 0.6],
      ]),
    )
    expect(positions.slice(0, 2)).toEqual([0.3, 0.6])
    expect(colors.slice(0, 2)).toEqual(["#111111", "#222222"])
  })

  it("paletteUniforms 对空输入回退默认色板，长度恰为 MAX_PALETTE 时不截断", () => {
    const { colors } = paletteUniforms([])
    expect(colors[0]).toBe(DEFAULT_PALETTE[0])
    const exact = stops(
      Array.from({ length: MAX_PALETTE }, (_, i) => [`#00000${i % 10}`, i / 7] as [string, number]),
    )
    expect(paletteUniforms(exact).colors).toHaveLength(MAX_PALETTE)
  })

  it("paletteUniforms 超过 MAX_PALETTE 时截断", () => {
    const many = stops(
      Array.from({ length: MAX_PALETTE + 4 }, () => ["#000000", 0] as [string, number]),
    )
    expect(paletteUniforms(many).colors).toHaveLength(MAX_PALETTE)
    expect(paletteUniforms(many).positions).toHaveLength(MAX_PALETTE)
  })
})

describe("sampleRamp", () => {
  // 三个整数分量色，手算旧公式的期望值——不用生产实现里的 mix/parse 当参考，避免互相掩护。
  // 用 paletteUniforms 造输入而不是手写数组：该函数要求位置与颜色都是**补齐到 8 槽**的定长数组
  // （它与着色的 GLSL 同构，循环恒 7 次，短数组会让 undefined 参与运算得出 NaN 颜色），
  // 补齐正是 paletteUniforms 的职责，顺手也就把这条契约钉住了。
  const { colors: COLORS, positions: POS } = paletteUniforms(
    stops([
      ["#000000", 0],
      ["#646464", 0.5],
      ["#ffffff", 1],
    ]),
  )

  it("等距位置下的取值与旧等距公式逐点相同", () => {
    // 旧公式：seg = 2、pos = 2m，w1 = clamp(2m)、w2 = clamp(2m - 1)。
    expect(sampleRamp(0, POS, COLORS)).toBe("#000000")
    // m=0.25 → w1=0.5 → mix(0,100,0.5)=50=0x32
    expect(sampleRamp(0.25, POS, COLORS)).toBe("#323232")
    // m=0.5 → w1=1, w2=0
    expect(sampleRamp(0.5, POS, COLORS)).toBe("#646464")
    // m=0.6 → w2=0.2 → 100 + 155*0.2 = 131 = 0x83
    expect(sampleRamp(0.6, POS, COLORS)).toBe("#838383")
    // m=0.75 → w2=0.5 → 100 + 155*0.5 = 177.5 → 四舍五入 178 = 0xb2
    expect(sampleRamp(0.75, POS, COLORS)).toBe("#b2b2b2")
    expect(sampleRamp(1, POS, COLORS)).toBe("#ffffff")
  })

  it("首色标不在 0 时，它左侧钳制为首色", () => {
    const positions = [0.3, 0.6, 1, 1, 1, 1, 1, 1]
    const colors = [
      "#111111",
      "#222222",
      "#333333",
      "#333333",
      "#333333",
      "#333333",
      "#333333",
      "#333333",
    ]
    expect(sampleRamp(0, positions, colors)).toBe("#111111")
    expect(sampleRamp(0.3, positions, colors)).toBe("#111111")
  })

  it("只有一个色标时整条相位都是它（位置被补齐成 8 个 0.5）", () => {
    const { colors, positions } = paletteUniforms(stops([["#336699", 0.5]]))
    expect(sampleRamp(0, positions, colors)).toBe("#336699")
    expect(sampleRamp(0.5, positions, colors)).toBe("#336699")
    expect(sampleRamp(1, positions, colors)).toBe("#336699")
  })

  it("末色标不在 1 时，它右侧钳制为末色", () => {
    const positions = [0, 0.2, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]
    const colors = [
      "#111111",
      "#222222",
      "#333333",
      "#333333",
      "#333333",
      "#333333",
      "#333333",
      "#333333",
    ]
    expect(sampleRamp(0.7, positions, colors)).toBe("#333333")
    expect(sampleRamp(1, positions, colors)).toBe("#333333")
  })

  it("位置重合不给 NaN，且是硬边", () => {
    const positions = [0, 0.5, 0.5, 1, 1, 1, 1, 1]
    const colors = [
      "#000000",
      "#646464",
      "#ffffff",
      "#ffffff",
      "#ffffff",
      "#ffffff",
      "#ffffff",
      "#ffffff",
    ]
    const before = sampleRamp(0.4999, positions, colors)
    const after = sampleRamp(0.5001, positions, colors)
    expect(before).not.toMatch(/nan/i)
    expect(after).not.toMatch(/nan/i)
    // 0.4999 落在 [0, 0.5] 段：w = 0.4999 / 0.5 = 0.9998 → 0 + 100 * 0.9998 = 99.98 → 100 = 0x64
    expect(before).toBe("#646464")
    expect(after).toBe("#ffffff")
  })

  it("接受 3 位 hex", () => {
    const colors = ["#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff"]
    expect(sampleRamp(0, [0, 0.5, 1, 1, 1, 1, 1, 1], colors)).toBe("#ffffff")
  })

  it("输出恒为 6 位小写十六进制", () => {
    expect(sampleRamp(0.31, POS, COLORS)).toMatch(/^#[0-9a-f]{6}$/)
  })

  // transition 是「过渡带占该段的比例」：缺省 1 必须与旧公式逐点相同，否则所有既有系列会变色。
  it("transition 缺省为 1，与显式传 1 逐点相同（旧公式原样）", () => {
    for (const m of [0, 0.25, 0.5, 0.6, 0.75, 1]) {
      expect(sampleRamp(m, POS, COLORS)).toBe(sampleRamp(m, POS, COLORS, 1))
    }
  })

  it("transition = 0 → 在每个色标处硬跳，段内无混色", () => {
    // 过渡带宽度塌成 1e-5：m=0 仍是首色，刚离开 0 就整段跳到次色。
    expect(sampleRamp(0, POS, COLORS, 0)).toBe("#000000")
    expect(sampleRamp(0.01, POS, COLORS, 0)).toBe("#646464")
    expect(sampleRamp(0.5, POS, COLORS, 0)).toBe("#646464")
    expect(sampleRamp(0.51, POS, COLORS, 0)).toBe("#ffffff")
  })

  it("中间值：过渡带占该段的比例，带外是该段纯色", () => {
    // t=0.5 → 首段 [0, 0.5] 的混色只发生在 [0, 0.25]，其余是纯次色。
    expect(sampleRamp(0.1, POS, COLORS, 0.5)).toBe("#282828") // w = 0.1/0.25 = 0.4 → 100×0.4 = 40 = 0x28
    expect(sampleRamp(0.25, POS, COLORS, 0.5)).toBe("#646464") // w = 1 → 已经到次色
    expect(sampleRamp(0.4, POS, COLORS, 0.5)).toBe("#646464") // 带外，维持次色
  })

  // >1 时带子跨出本段：相邻色标浑融，代价是相位域两端不再落到纯首 / 纯末色。
  it("transition > 1 让过渡带跨出本段（末色因此取不满）", () => {
    // t=2 → 首段 [0, 0.5] 的带子宽 1.0，m=0.5 才走到一半：
    expect(sampleRamp(0.5, POS, COLORS, 2)).toBe("#323232") // mix(0, 100, 0.5) = 50 = 0x32
    // 末段 [0.5, 1] 的带子要伸到 1.5 才走满，故 m=1（相位域右端）只混到一半：
    expect(sampleRamp(1, POS, COLORS, 2)).toBe("#b2b2b2") // 100 + 155×0.5 = 177.5 → 178 = 0xb2
  })
})
