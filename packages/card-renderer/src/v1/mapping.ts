/**
 * 图层 → 材质参数映射（纯函数，零 three 依赖）。
 *
 * 把 schema 的 {@link Layer}（面向用户、量纲友好）翻译为着色器 uniform 与混合模式名。
 * 这里刻意不 import three：一方面让映射逻辑可零依赖单测，另一方面把「枚举值」这一
 * three 版本相关细节挡在 three-bridge 之外。
 */
import {
  DEFAULT_GRADIENT_PHASE,
  resolveGradient,
  resolveImageMask,
  resolvePalette,
  type Layer,
  type MaskImageParams,
  type MaskMode,
  type PaletteParams,
  type PatternMode,
} from "@prismwright/schema"

/** 混合模式的枚举名（真正的 THREE.Blending 值在 three-bridge 里映射）。 */
export type BlendName = Layer["blend"]

/**
 * distortionStrength 的线性系数（曲线在小输入处的斜率）。
 *
 * schema 用 0–1000 的「用户量纲」（默认 5），着色器沿用 buling 的「≈1」量纲：靠近默认值时
 * 曲线近似 `strength × 0.2`（默认 5 → 1.0），与 buling overlay 的默认一致。
 */
export const DISTORTION_SCALE = 0.2

/**
 * 着色器扭曲强度的上限（曲线的渐近线）：UI 拉满时趋近此值。
 *
 * 旧实现是线性 ×0.2 后**硬夹**到 10，等价于「输入 50 以上全是死区」——滑块后 95% 的行程无响应。
 * 这里改用 tanh 软饱和（见 {@link mapDistortionStrength}）并把上限抬到 20：整条滑块都有效，
 * 极值也比过去更猛。想让极值更猛 / 更收敛，只改这一个常量即可。
 */
export const DISTORTION_MAX = 20

/**
 * distortionStrength（UI 0–1000）→ 着色器扭曲强度。
 *
 * `MAX · tanh(strength · SCALE / MAX)`：在 0 处斜率恰好是 {@link DISTORTION_SCALE}，故小输入处
 * 与旧的线性映射逐值吻合（既有卡包的观感不变）；随后平滑饱和到 {@link DISTORTION_MAX}——
 * 既消掉了旧硬夹造成的死区（整条滑块都有效），高段又自然放缓（扭曲越大越接近噪声、收益递减，
 * 不值得再线性放大）。
 *
 * @param strength - schema 的 distortionStrength；负值按 0 处理（tanh 单调递增，上界无需夹）。
 * @returns 着色器扭曲强度，落在 `[0, DISTORTION_MAX)`。
 */
export function mapDistortionStrength(strength: number): number {
  const s = Math.max(0, strength)
  return DISTORTION_MAX * Math.tanh((s * DISTORTION_SCALE) / DISTORTION_MAX)
}

/** 由「蒙版亮度」与阈值计算权重，供实现与单测共用同一公式。 */
export interface MaskWeightParams {
  uMaskMode: MaskMode
  uMaskInvert: boolean
  uLineEdge0: number
  uLineEdge1: number
  /** 是否绑定了蒙版纹理；未绑定时权重恒为 1。 */
  hasMask: boolean
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  if (e0 === e1) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 蒙版权重（0–1）：与着色器 `maskWeight()` 同构，便于在 TS 侧单测公式。
 *
 * @param lum - 蒙版亮度（0–1，取 `dot(rgb, (0.299,0.587,0.114))`）。
 * @param p - 阈值与模式参数。
 * @returns 该像素出全息的比例；无蒙版时为 1。
 */
export function maskWeight(lum: number, p: MaskWeightParams): number {
  if (!p.hasMask) return 1
  const l = p.uMaskInvert ? 1 - lum : lum
  return p.uMaskMode === "line"
    ? 1 - smoothstep(p.uLineEdge0, p.uLineEdge1, l)
    : smoothstep(0.5, 1.0, l)
}

/** 颜色蒙版权重的参数（见 {@link colorKeyWeight}）。 */
export interface ColorKeyWeightParams {
  /** 是否启用蒙版；false 时权重恒为 1（不裁切）。 */
  hasMask: boolean
  /** 反转最终权重。 */
  invert: boolean
  /** 颜色距离下限（完全纳入）。 */
  edge0: number
  /** 颜色距离上限（完全排除）。 */
  edge1: number
}

/**
 * 颜色蒙版权重（0–1）：与着色器 `colorKeyWeight()` 同构，便于在 TS 侧单测公式。
 *
 * 距离取 RGB 三分量的均方根差（0–1；纯黑到纯白为 1）。
 * `edge0` 以内完全纳入、`edge1` 以外完全排除，中间平滑过渡；反转作用于最终权重。
 * 上下限写反时按 min/max 兜底，与着色器同构。
 *
 * @param rgb - 待判定的像素颜色（线性工作空间，与片元采样同域）。
 * @param key - 吸管拾取的颜色（同一空间）。
 * @param p - 阈值 / 反转 / 是否启用。
 * @returns 该像素出全息的比例；无蒙版时为 1。
 */
export function colorKeyWeight(
  rgb: readonly [number, number, number],
  key: readonly [number, number, number],
  p: ColorKeyWeightParams,
): number {
  if (!p.hasMask) return 1
  const dr = rgb[0] - key[0]
  const dg = rgb[1] - key[1]
  const db = rgb[2] - key[2]
  const d = Math.sqrt((dr * dr + dg * dg + db * db) / 3)
  const lo = Math.min(p.edge0, p.edge1)
  const hi = Math.max(p.edge0, p.edge1)
  const w = 1 - smoothstep(lo, hi, d)
  return p.invert ? 1 - w : w
}

/** {@link maskIsActive} 的补充上下文。 */
export interface MaskActiveOptions {
  /**
   * 卡面原图是否有效。颜色源必须在原图上采样，缺图时视作无蒙版（否则会拿 1×1 占位纹理的
   * 颜色做一次无意义的匹配）。默认 `true`——不关心原图的调用方（如纯公式单测）可省略。
   */
  frontValid?: boolean
}

/**
 * 已解析的图蒙版参数是否**生效**。
 *
 * - 图片源：`path` 非空才生效。空 path 是「已添加但还没选图」的中间态，不该当作有蒙版。
 * - 颜色源：卡面原图有效即生效（颜色字段本身总有 schema 默认值）。
 *
 * 材质侧（本层 / 祖先）与祖先裁切公式共用此判定，避免各处各写一遍而彼此漂移。
 *
 * @param imageMask - `resolveImageMask` 的返回值（无 imageMask 时为 `null`）。
 * @param opts - 见 {@link MaskActiveOptions}。
 * @returns 是否应视作「有蒙版」。
 */
export function maskIsActive(
  imageMask: MaskImageParams | null,
  opts: MaskActiveOptions = {},
): boolean {
  if (imageMask === null) return false
  if (imageMask.source === "color") return opts.frontValid ?? true
  return imageMask.path.length > 0
}

/**
 * 已解析的调色板参数是否**生效**：有 palette 且色标非空。
 *
 * `resolvePalette` 只按 kind / enabled 挑出第一条，不判空 `colors`——「已添加但删空了色标」是合法
 * 中间态（= 不出全息）。`toUniforms` 与单测共用此判定，避免各处各写一遍 `p.colors.length > 0`。
 *
 * @param p - `resolvePalette` 的返回值（无色板时为 `null`）。
 * @returns 是否应视作「出全息」。
 */
export function paletteIsActive(p: PaletteParams | null): boolean {
  return p !== null && p.colors.length > 0
}

/**
 * 祖先蒙版权重的乘积——与着色器里那段祖先裁切循环同构，供单测钉住公式。
 *
 * 祖先蒙版已不是一等字段，改从各祖先的效果列表解析（`imageMask`）——与材质侧的绑定口径一致。
 * `mode / invert / edge0 / edge1` 的兜底值（`line / false / 0 / 1`）只在**无生效蒙版**时被取用，
 * 那时 `hasMask` 为 false（见 {@link maskIsActive}），{@link maskWeight} 会直接返回 1，这几个值
 * 不参与计算——它们并非各字段的 schema 默认（如 `edge1` 的默认是 0.95），只是一组占位实参。
 *
 * @param ancestors - 祖先链（最外层在前、直接父层在末）。
 * @param lums - 与 `ancestors` 一一对应的蒙版亮度（0–1）；无蒙版的祖先其值被忽略（权重记 1）。
 * @returns 该像素被祖先裁切后应乘上的系数（0–1）。
 */
export function ancestorClipWeight(ancestors: readonly Layer[], lums: readonly number[]): number {
  let clip = 1
  for (let i = 0; i < ancestors.length; i++) {
    const m = resolveImageMask(ancestors[i].effects)
    clip *= maskWeight(lums[i], {
      uMaskMode: m?.mode ?? "line",
      uMaskInvert: m?.invert ?? false,
      uLineEdge0: m?.edge0 ?? 0,
      uLineEdge1: m?.edge1 ?? 1,
      hasMask: maskIsActive(m),
    })
  }
  return clip
}

/** 单个图层映射出的 uniform 值（尚不含纹理）。 */
export interface LayerUniforms {
  uHoloMix: number
  uHoloAlpha: number
  uOpacity: number
  uPhaseSpeed: number
  /** 倾斜灵敏度倍数（透传自 `tiltGain`，不缩放）。 */
  uTiltGain: number
  uDistortionStrength: number
  uNoiseStrength: number
  /** 色标过渡带宽度（段长的倍数，0–3），透传自 `transition`，不缩放（值域已由 schema 限定）。 */
  uTransition: number
  /** 图案偏移（UV 域），透传自 `offsetX` / `offsetY`，不缩放。 */
  uOffset: [number, number]
  blend: BlendName
  /**
   * 本层是否出全息箔——由目标是否挂有**生效的 `palette` 效果**决定（空色标 = 不出箔）。
   *
   * 箔的颜色只能来自调色板：没有调色板就不回退默认配色（那等于替用户选了一组颜色）。颜色 /
   * 相位类效果并不依赖这道门——它们照常作用在本层的图片 / 文字上（见 shaders/layer.ts 的
   * 内容效果链）。
   *
   * 为 `false` 时材质把 `uHasHolo` 置 0，片元据此把该层全息 alpha 归零：只挂蒙版的层自己不画
   * （纯蒙版），但作为祖先仍以其蒙版裁切子树。
   */
  hasHolo: boolean
}

/**
 * 把一个 {@link Layer} 映射为 uniform 值集合。
 *
 * @param layer - 数据层图层。
 * @returns 供材质构造使用的定值参数。
 */
export function toUniforms(layer: Layer): LayerUniforms {
  // 6 个相位全局项从渐变效果读；无渐变效果时回落到 schema 的默认值（单一来源）。
  const phase = resolveGradient(layer.effects) ?? DEFAULT_GRADIENT_PHASE
  return {
    uHoloMix: layer.holoMix,
    uHoloAlpha: layer.holoAlpha,
    uOpacity: layer.opacity,
    uPhaseSpeed: phase.phaseSpeed,
    uTiltGain: phase.tiltGain,
    uDistortionStrength: mapDistortionStrength(phase.distortionStrength),
    uNoiseStrength: phase.noiseStrength,
    uTransition: phase.transition,
    uOffset: [phase.offsetX, phase.offsetY],
    blend: layer.blend,
    hasHolo: paletteIsActive(resolvePalette(layer.effects)),
  }
}


/**
 * 图样方向模式 → 着色器整型码：0 = 平行，1 = 光环（同心环），2 = 射线。
 *
 * 着色器用 `float` 承载这一枚举（GLSL ES 1.00 无原生枚举），各处分支都按这三个码值判断。
 * 集中在此换算，避免每个材质各写一遍三元链、彼此漂移；枚举新增取值时只改这一处。
 */
export function patternModeCode(mode: PatternMode): number {
  return mode === "parallel" ? 0 : mode === "radial" ? 1 : 2
}
