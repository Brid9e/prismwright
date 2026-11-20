import { describe, it, expect } from "vitest"
import {
  EffectSchema,
  PaletteParamsSchema,
  DEFAULT_GRADIENT_PHASE,
  type Layer,
  type Effect,
  type GradientParams,
  type MaskImageParams,
  type PaletteParams,
} from "@cardbara/schema"
import {
  toUniforms,
  maskWeight,
  colorKeyWeight,
  maskIsActive,
  paletteIsActive,
  DISTORTION_MAX,
  DISTORTION_SCALE,
  ancestorClipWeight,
  patternModeCode,
  type MaskWeightParams,
} from "../mapping"

/**
 * 构造一个字段齐全的图层，便于按需覆盖。
 *
 * 蒙版已不再是一等字段（改由 `effects` 里的 `imageMask` 承载），相位全局项与色标也已退役到
 * 效果栈（`gradient` / `palette`），故这里不含这些字段；需要蒙版 / 渐变的用例走
 * {@link withMask} / {@link gradient} / {@link palette} 单独构造。
 */
function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "l1",
    name: "",
    enabled: true,
    holoMix: 0.9,
    holoAlpha: 1,
    blend: "add",
    opacity: 1,
    kind: "normal",
    text: null,
    effects: [],
    children: [],
    ...over,
  }
}

/** 造一条 gradient 效果；`enabled=false` 时相位参数仍应被 toUniforms 读到（见设计方案 §3）。 */
function gradient(params: Partial<GradientParams> = {}, enabled = true): Effect {
  return EffectSchema.parse({ kind: "gradient", id: "g", enabled, params }) as Effect
}

/** 造一条 palette 效果。 */
function palette(colors: string[], enabled = true): Effect {
  return EffectSchema.parse({ kind: "palette", id: "p", enabled, params: { colors } }) as Effect
}

/**
 * 在 {@link layer} 基础上挂一条 `imageMask` 效果，供祖先裁切用例使用。
 *
 * `mask` 省略时不挂效果（等价于「祖先无蒙版」）；提供时字段缺省用 schema 默认值
 * （path `m.png` / mode `line` / edge0 `0` / edge1 `0.95` / invert `false`）。
 */
function withMask(
  over: Partial<Layer> = {},
  mask?: {
    path?: string
    mode?: "line" | "fill"
    edge0?: number
    edge1?: number
    invert?: boolean
    enabled?: boolean
  },
): Layer {
  if (!mask) return layer(over)
  return layer({
    ...over,
    effects: [
      EffectSchema.parse({
        kind: "imageMask",
        id: "im",
        enabled: mask.enabled ?? true,
        params: {
          path: mask.path ?? "m.png",
          mode: mask.mode ?? "line",
          edge0: mask.edge0 ?? 0,
          edge1: mask.edge1 ?? 0.95,
          invert: mask.invert ?? false,
        },
      }),
    ],
  })
}

describe("mapping", () => {
  // tanh 软饱和：小输入处 ≈ 线性 ×0.2（旧观感不变），整体单调、无死区，顶值趋近 DISTORTION_MAX。
  it("distortionStrength 走 tanh 软饱和（默认 5 → ≈1，整条滑块单调，顶值趋近上限）", () => {
    const u = (v: number) =>
      toUniforms(layer({ effects: [gradient({ distortionStrength: v })] })).uDistortionStrength
    expect(DISTORTION_SCALE).toBe(0.2)
    // 无渐变效果 → 回落到 DEFAULT_GRADIENT_PHASE（distortionStrength = 5）→ ≈1。
    expect(toUniforms(layer()).uDistortionStrength).toBeCloseTo(1)
    expect(u(5)).toBeCloseTo(1)
    expect(u(0)).toBe(0)
    // 小输入处与旧的线性 ×0.2 吻合——既有卡包（值多落在 0–50）的观感不变。
    expect(u(10)).toBeCloseTo(10 * DISTORTION_SCALE, 1)
    // 旧实现输入 >50 一律等于 10；现在整条滑块单调递增，没有死区。
    expect(u(50)).toBeGreaterThan(u(20))
    expect(u(100)).toBeGreaterThan(u(50))
    expect(u(1000)).toBeGreaterThan(u(100))
    // 上限抬到 DISTORTION_MAX：tanh 是渐近的，拉满趋近但略小于它。
    expect(u(1000)).toBeLessThan(DISTORTION_MAX)
    expect(u(1000)).toBeGreaterThan(DISTORTION_MAX * 0.99)
  })

  // 与 distortionStrength 不同，这里不做任何缩放或夹取：schema 已经把值域限制在 0–1，
  // 映射层再动一次会让「滑块刻度」和「着色器拿到的东西」对不上。
  it("透传 noiseStrength，不缩放", () => {
    expect(toUniforms(layer()).uNoiseStrength).toBe(0)
    expect(toUniforms(layer({ effects: [gradient({ noiseStrength: 0.42 })] })).uNoiseStrength).toBe(
      0.42,
    )
  })

  // 与 noiseStrength 同理：schema 已经把值域限制在 -1–1，映射层不再缩放或夹取，
  // 否则滑块刻度和着色器拿到的东西会对不上。
  it("透传图案偏移 offsetX / offsetY，不缩放", () => {
    expect(toUniforms(layer()).uOffset).toEqual([0, 0])
    expect(
      toUniforms(layer({ effects: [gradient({ offsetX: -0.3, offsetY: 0.4 })] })).uOffset,
    ).toEqual([-0.3, 0.4])
  })

  // 与 noiseStrength 同理：schema 已把值域限制在 0–1，映射层不缩放不夹取，否则滑块刻度和着色器
  // 拿到的东西会对不上。
  it("透传过渡带宽度 transition，缺省取 DEFAULT_GRADIENT_PHASE", () => {
    expect(DEFAULT_GRADIENT_PHASE.transition).toBe(1)
    expect(toUniforms(layer()).uTransition).toBe(DEFAULT_GRADIENT_PHASE.transition)
    expect(toUniforms(layer({ effects: [gradient({ transition: 0.25 })] })).uTransition).toBe(0.25)
  })

  it("透传 holoMix / holoAlpha / opacity / phaseSpeed / tiltGain", () => {
    const u = toUniforms(
      layer({
        holoMix: 0.5,
        holoAlpha: 0.4,
        opacity: 0.3,
        effects: [gradient({ phaseSpeed: 2, tiltGain: 2.5 })],
      }),
    )
    expect(u.uHoloMix).toBe(0.5)
    expect(u.uHoloAlpha).toBe(0.4)
    expect(u.uOpacity).toBe(0.3)
    expect(u.uPhaseSpeed).toBe(2)
    // 与其它相位项同理：值域由 schema 限定，映射层不缩放不夹取。
    expect(u.uTiltGain).toBe(2.5)
  })

  it("blend 直接透传为枚举名", () => {
    expect(toUniforms(layer({ blend: "screen" })).blend).toBe("screen")
    expect(toUniforms(layer({ blend: "add" })).blend).toBe("add")
  })

  it("无渐变效果时相位项等于 DEFAULT_GRADIENT_PHASE", () => {
    const u = toUniforms(layer())
    expect(u.uPhaseSpeed).toBe(DEFAULT_GRADIENT_PHASE.phaseSpeed)
    expect(u.uDistortionStrength).toBeCloseTo(
      DEFAULT_GRADIENT_PHASE.distortionStrength * DISTORTION_SCALE,
    )
    expect(u.uNoiseStrength).toBe(DEFAULT_GRADIENT_PHASE.noiseStrength)
    expect(u.uTiltGain).toBe(DEFAULT_GRADIENT_PHASE.tiltGain)
    expect(u.uOffset).toEqual([DEFAULT_GRADIENT_PHASE.offsetX, DEFAULT_GRADIENT_PHASE.offsetY])
  })

  // 空色板 = 纯蒙版：本层不出图，但作为祖先仍以其蒙版裁切子树。门控在片元的 uHasHolo。
  it("palette 色标为空 → hasHolo 为 false（纯蒙版）", () => {
    expect(toUniforms(layer({ effects: [palette([])] })).hasHolo).toBe(false)
  })

  it("palette 色标非空 → hasHolo 为 true", () => {
    expect(toUniforms(layer({ effects: [palette(["#111111"])] })).hasHolo).toBe(true)
  })

  // 箔只由调色板给出颜色：没有调色板就不出箔，也不回退默认配色（那等于替用户选了一组颜色）。
  // 颜色类效果照样作用在本层的图片 / 文字上，它们不经过这道门。
  it("没有调色板时，刻纹 / 光泽 / 摩尔纹都不会凭空造出一层箔", () => {
    const effect = (kind: string) => EffectSchema.parse({ kind, id: kind, enabled: true, params: {} }) as Effect
    for (const kind of ["gloss", "lattice", "moire", "gradient"]) {
      expect(toUniforms(layer({ effects: [effect(kind)] })).hasHolo).toBe(false)
    }
    expect(toUniforms(withMask()).hasHolo).toBe(false)
    expect(toUniforms(layer()).hasHolo).toBe(false)
  })

  it("maskWeight：line 模式暗线出全息（亮度低 → 权重高）", () => {
    const p: MaskWeightParams = {
      uMaskMode: "line",
      uMaskInvert: false,
      uLineEdge0: 0.2,
      uLineEdge1: 0.5,
      hasMask: true,
    }
    expect(maskWeight(0.0, p)).toBeCloseTo(1) // 全黑 → 全息
    expect(maskWeight(1.0, p)).toBeCloseTo(0) // 全白 → 无
  })

  it("lineEdge0 === lineEdge1 时阈值退化为硬边（无过渡带）", () => {
    const p: MaskWeightParams = {
      uMaskMode: "line",
      uMaskInvert: false,
      uLineEdge0: 0.5,
      uLineEdge1: 0.5,
      hasMask: true,
    }
    expect(maskWeight(0.4, p)).toBeCloseTo(1)
    expect(maskWeight(0.6, p)).toBeCloseTo(0)
  })

  it("maskWeight：fill 模式亮区出全息", () => {
    const p: MaskWeightParams = {
      uMaskMode: "fill",
      uMaskInvert: false,
      uLineEdge0: 0,
      uLineEdge1: 0.95,
      hasMask: true,
    }
    expect(maskWeight(1.0, p)).toBeCloseTo(1) // 全白 → 全息
    expect(maskWeight(0.0, p)).toBeCloseTo(0) // 全黑 → 无
  })

  it("invert 反转亮度（line 模式下黑白互换）", () => {
    const p: MaskWeightParams = {
      uMaskMode: "line",
      uMaskInvert: true,
      uLineEdge0: 0.2,
      uLineEdge1: 0.5,
      hasMask: true,
    }
    expect(maskWeight(1.0, p)).toBeCloseTo(1)
    expect(maskWeight(0.0, p)).toBeCloseTo(0)
  })

  it("无蒙版（hasMask 为 false）时 maskWeight 恒为 1（整卡出全息）", () => {
    const p: MaskWeightParams = {
      uMaskMode: "line",
      uMaskInvert: false,
      uLineEdge0: 0.2,
      uLineEdge1: 0.5,
      hasMask: false,
    }
    expect(maskWeight(0.0, p)).toBe(1)
    expect(maskWeight(1.0, p)).toBe(1)
  })
})

describe("paletteIsActive", () => {
  it("null → false（无 palette 效果）", () => {
    expect(paletteIsActive(null)).toBe(false)
  })

  it("色标为空 → false（已添加但删空了色标，属合法中间态）", () => {
    const empty: PaletteParams = PaletteParamsSchema.parse({ colors: [] })
    expect(paletteIsActive(empty)).toBe(false)
  })

  it("色标非空 → true", () => {
    const nonEmpty: PaletteParams = PaletteParamsSchema.parse({
      colors: [{ color: "#111111", at: 0 }],
    })
    expect(paletteIsActive(nonEmpty)).toBe(true)
  })
})

describe("patternModeCode", () => {
  it("平行 / 光环 / 射线 → 0 / 1 / 2", () => {
    expect(patternModeCode("parallel")).toBe(0)
    expect(patternModeCode("radial")).toBe(1)
    expect(patternModeCode("rays")).toBe(2)
  })
})

describe("ancestorClipWeight", () => {
  it("无祖先时权重恒为 1", () => {
    expect(ancestorClipWeight([], [])).toBe(1)
  })

  it("祖先无蒙版时不裁切（权重 1），忽略其亮度", () => {
    const a = withMask()
    expect(ancestorClipWeight([a], [1])).toBe(1)
  })

  it("多个祖先的蒙版权重逐层相乘", () => {
    // fill 模式：亮度 1 → 权重 1，亮度 0 → 权重 0。
    const a = withMask({}, { mode: "fill" })
    const b = withMask({}, { mode: "fill" })
    expect(ancestorClipWeight([a, b], [1, 0])).toBe(0)
    expect(ancestorClipWeight([a, b], [1, 1])).toBe(1)
  })

  it("line 模式下暗（亮度低于阈值下限）出全息、权重为 1", () => {
    const a = withMask({}, { mode: "line", edge0: 0.8, edge1: 0.95 })
    expect(ancestorClipWeight([a], [0])).toBeCloseTo(1)
    expect(ancestorClipWeight([a], [1])).toBeCloseTo(0)
  })
})

describe("colorKeyWeight", () => {
  const key = [0.5, 0.5, 0.5] as const
  const opts = { hasMask: true, invert: false, edge0: 0.1, edge1: 0.4 }

  it("无蒙版时恒为 1（不裁切）", () => {
    expect(colorKeyWeight([0, 0, 0], key, { ...opts, hasMask: false })).toBe(1)
  })

  it("与拾取色完全一致时权重 1，距离超出上限时 0", () => {
    expect(colorKeyWeight([0.5, 0.5, 0.5], key, opts)).toBeCloseTo(1)
    // 纯黑到中灰拾取色的 RMS 距离 = 0.5，超过 edge1 = 0.4。
    expect(colorKeyWeight([0, 0, 0], key, opts)).toBeCloseTo(0)
  })

  it("阈值带内线性过渡，且反转取补", () => {
    // d = 0.25 恰在 [0.1, 0.4] 正中：smoothstep = 0.5 → 权重 0.5。
    expect(colorKeyWeight([0.25, 0.25, 0.25], key, opts)).toBeCloseTo(0.5)
    expect(colorKeyWeight([0.25, 0.25, 0.25], key, { ...opts, invert: true })).toBeCloseTo(0.5)
  })

  it("上下限写反也按区间处理（min/max 兜底）", () => {
    expect(colorKeyWeight([0.25, 0.25, 0.25], key, { ...opts, edge0: 0.4, edge1: 0.1 })).toBeCloseTo(
      0.5,
    )
  })
})

describe("maskIsActive", () => {
  // `.params` 是各效果的联合类型：显式收窄成 imageMask 的参数形状才能喂给 maskIsActive。
  const base = EffectSchema.parse({
    kind: "imageMask",
    id: "m",
    params: { source: "color", color: "#ff0000" },
  }).params as MaskImageParams

  it("颜色源：卡面原图有效时生效，缺图时不生效", () => {
    expect(maskIsActive(base, { frontValid: true })).toBe(true)
    expect(maskIsActive(base, { frontValid: false })).toBe(false)
  })

  it("图片源仍按 path 是否为空判定（颜色字段不影响）", () => {
    const noPath = EffectSchema.parse({ kind: "imageMask", id: "m", params: {} })
      .params as MaskImageParams
    expect(maskIsActive(noPath, { frontValid: true })).toBe(false)
    const withPath = EffectSchema.parse({
      kind: "imageMask",
      id: "m",
      params: { path: "m.png", source: "image" },
    }).params as MaskImageParams
    expect(maskIsActive(withPath)).toBe(true)
  })
})
