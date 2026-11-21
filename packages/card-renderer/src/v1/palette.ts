/**
 * 调色板工具（纯函数，零 three 依赖）。
 *
 * 着色器里 `uColors` 与 `uStops` 都固定为长度 {@link MAX_PALETTE} 的数组——补齐/截断都在
 * 这里完成，把「任意数量、任意位置的色标」收敛成着色器能吃的定长数组。
 *
 * 空色板：v2 起色标由 `palette` 效果承载（`PaletteParams.colors`），其为空表示「本层不出
 * 全息箔」（纯蒙版），由材质的 `uHasHolo` 门控——箔的颜色只能来自调色板，此处不回退默认配色
 * （那等于替用户选了一组颜色）。但着色器的定长数组仍须填满非空值，故空输入回退到默认调色板
 * **只当占位**：`uHasHolo = 0` 时这些值不会被采样。颜色类效果不依赖这道门——它们照常作用在
 * 本层的图片 / 文字上（见 shaders/layer.ts 的内容效果链）。默认调色板的规范定义在
 * `@prismwright/schema`，与 v2 迁移共用同一份，避免两处漂移。
 */
import { alphaOf, DEFAULT_STOPS, type ColorStop } from "@prismwright/schema"

/** 着色器 `uColors[8]` / `uStops[8]` 的固定长度。 */
export const MAX_PALETTE = 8

/** 用末项重复（或截断）到 {@link MAX_PALETTE}。`items` 必须非空。 */
function padToMax<T>(items: readonly T[]): T[] {
  const out = items.slice(0, MAX_PALETTE)
  const last = out[out.length - 1]
  while (out.length < MAX_PALETTE) out.push(last)
  return out
}

/**
 * 把任意长度颜色数组补齐（用末色重复）或截断到 {@link MAX_PALETTE}。
 *
 * @param colors - 原始 hex 颜色数组；空数组以默认调色板作占位（`uHasHolo = 0`，不会被采样）。
 * @returns 长度恒为 {@link MAX_PALETTE} 的新数组。
 */
export function padPalette(colors: readonly string[]): string[] {
  const src = colors.length > 0 ? colors : DEFAULT_STOPS.map((s) => s.color)
  return padToMax(src)
}

/**
 * 解析出「定长颜色 + 定长透明度 + 定长位置」，供材质设置
 * `uColors` / `uColorAlphas` / `uStops`。
 *
 * 命名与 `@prismwright/schema` 的 `resolvePalette(effects)` 区分：后者从效果列表挑出
 * `palette` 效果的参数，本函数则把色标数组折成着色器能吃的定长 uniform。二者常在同一处
 * 配合使用（`paletteUniforms(resolvePalette(effects)?.colors ?? [])`），故取 `*Uniforms` 之名。
 *
 * 位置也用末项重复补齐：补出来的段 `span` 为 0，着色器里被 `1e-5` 下限兜住，
 * `m` 落在该段时混的是同一个颜色，等于没混。透明度跟颜色一起补齐。
 *
 * @param stops - 色标（位置须已升序，见 `@prismwright/schema` 的解析期归一化）。
 * @returns 三者长度都恒为 {@link MAX_PALETTE}；空输入以 {@link DEFAULT_STOPS} 作占位
 *   （不会被采样——空色板的 `palette` 效果已由 `uHasHolo` 门控归零）。
 */
export function paletteUniforms(stops: readonly ColorStop[]): {
  colors: string[]
  positions: number[]
  alphas: number[]
} {
  const src = stops.length > 0 ? stops : DEFAULT_STOPS
  return {
    colors: padToMax(src.map((s) => s.color)),
    positions: padToMax(src.map((s) => s.at)),
    alphas: padToMax(src.map((s) => alphaOf(s.color))),
  }
}

/** 0–255 的整数分量。 */
type Rgb = readonly [number, number, number]

/** 解析 `#rgb` / `#rrggbb` / `#rrggbbaa` 的 RGB（合法长度见 `@prismwright/schema` 的 `HEX_COLOR`）。 */
function parseHex(hex: string): Rgb {
  const body = hex.slice(1)
  const full =
    body.length === 3 ? `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}` : body
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

function mix(a: Rgb, b: Rgb, w: number): Rgb {
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]
}

/** 0–255 分量 → `#rrggbb`。四舍五入后钳制，避免浮点误差落到 [0, 255] 之外。 */
function formatHex(rgb: Rgb): string {
  const hex = rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
  return `#${hex}`
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * 与着色器 `spectrum()` **同构**：给定相位位置 `m` 取色。
 *
 * 逐行镜像 `shaders/common.ts` 的 `spectrum()`（`m` 由余弦映射而来的那一步在调用方，
 * 与着色器里的分工一致）。镜像的理由见 `mapping.ts` 的 `maskWeight()`：**GLSL 在本仓库
 * 没有任何自动化验证手段**（各包都是 node 环境），把公式搬到 TS 至少能钉住「等距位置等于
 * 旧等距公式」与「域外钳制」两条断言。两侧任何一处改动都必须同步另一处——包括 `1e-5` 的
 * span 下限，以及循环恒为 7 次这件事。
 *
 * @param m - 相位位置，闭区间 [0, 1]。
 * @param positions - 升序的色标位置，长度须为 {@link MAX_PALETTE}（`paletteUniforms().positions`）。
 * @param colors - 与 positions 对应的 hex 颜色，长度同上。
 * @param transition - 过渡带宽度 = 段长 × 该值（0–3）。1 = 整段线性过渡（旧观感），0 = 在色标处硬跳，
 *   >1 时带子跨出本段、相邻色标浑融。
 * @returns 6 位小写 hex 颜色。
 */
export function sampleRamp(
  m: number,
  positions: readonly number[],
  colors: readonly string[],
  transition = 1,
): string {
  let col = parseHex(colors[0])
  for (let i = 0; i < MAX_PALETTE - 1; i++) {
    const span = Math.max(positions[i + 1] - positions[i], 1e-5)
    col = mix(
      col,
      parseHex(colors[i + 1]),
      clamp01((m - positions[i]) / Math.max(transition * span, 1e-5)),
    )
  }
  return formatHex(col)
}

/**
 * 与 {@link sampleRamp} 和着色器 `spectrumAlpha()` **同权重**地混色标透明度。
 *
 * 颜色只混 RGB；透明度单走一条同构的斜坡——色标半透明 = 全息箔在该相位处变淡。
 * 混色权重（含 `1e-5` 下限与 `transition`）必须与 `sampleRamp` 逐项一致，否则颜色与
 * 透明度会在过渡带里错位。
 *
 * @param m - 相位位置，闭区间 [0, 1]。
 * @param positions - 升序的色标位置，长度须为 {@link MAX_PALETTE}。
 * @param colors - 与 positions 对应的 hex 颜色，长度同上。
 * @param transition - 过渡带宽度（与 {@link sampleRamp} 同义）。
 * @returns 0–1 的混合透明度。
 */
export function sampleRampAlpha(
  m: number,
  positions: readonly number[],
  colors: readonly string[],
  transition = 1,
): number {
  let a = alphaOf(colors[0])
  for (let i = 0; i < MAX_PALETTE - 1; i++) {
    const span = Math.max(positions[i + 1] - positions[i], 1e-5)
    a +=
      (alphaOf(colors[i + 1]) - a) *
      clamp01((m - positions[i]) / Math.max(transition * span, 1e-5))
  }
  return a
}
