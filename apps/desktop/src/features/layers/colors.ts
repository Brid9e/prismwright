/**
 * 色标数组的纯操作。
 *
 * 从 UI 组件里抽出来的原因：这些规则（上限、位置夹取、边界）是需要测的**逻辑**，
 * 而组件本身在本阶段的测试策略里不做 DOM 测试。全部返回新数组，便于直接
 * 交给 store 的效果色标编辑（`updateEffect`）。
 *
 * 百分比的含义是**色标在色带上的位置**（与 CSS 渐变的百分比一致）：每个颜色各有一个
 * 0–100% 的落点，改一行只改这一行，其它行的百分比原样不动。位置必须非递减
 * （着色器累积混合与 CSS 渐变共同的前提），所以越界时夹到左右邻居之间；两个颜色可以
 * 停在同一位置，那表示硬边。
 *
 * 刻意**不** import `@cardbara/renderer`：它的出口指向 `dist`，反向依赖会把
 * 「先 build 渲染器」变成本模块单测的隐含前置，并在 node 里把 three 拖进来。
 * 因此上限保持本地字面量（见 `MAX_COLOR_STOPS`）。
 */
import type { ColorStop } from "@cardbara/schema"

/** 色标数量上限。必须与 `@cardbara/schema` 中 `PaletteParams.colors` 的校验上限保持一致。 */
export const MAX_COLOR_STOPS = 8

/**
 * 新增色标时的默认色值（中等灰，方便用户直接改）。
 *
 * 这是**用户数据**的初值——渐变色标最终存进 `pack.json`，不是主题色，没有语义
 * token 可对应。本文件因此是 `eslint.config.js` 里硬编码色值守卫的唯一豁免处。
 */
export const DEFAULT_NEW_STOP = "#9a9a9a"

/**
 * 十六进制色值：6 位或 8 位（第 7–8 位是透明度）。UI 的取色器只产出 6 位，透明度由
 * 色标 / 颜色控件的滑杆合成 8 位；3 位只可能来自手工编辑的数据。
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * 把 3 位色值展开、8 位色值去掉透明度，得到原生取色器认的 6 位；6 位原样返回。
 *
 * 原生 `<input type="color">` 只认 6 位：把 `#abc` 或 `#aabbcc80` 绑上去会显示成黑色。而这两者
 * 在数据层都是合法的（`schema.ts` 的 `HEX_COLOR` 接受 `#rgb` 与 `#rrggbbaa`），所以这不是防御性
 * 代码，是真实可达的输入。展开规则与渲染器 `palette.ts` 的 `parseHex` 一致；不在这儿 import 它，
 * 理由见文件头。
 */
export function toSixDigitHex(hex: string): string {
  const body = hex.slice(1)
  if (body.length === 8) return `#${body.slice(0, 6)}`
  if (body.length !== 3) return hex
  return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
}

/**
 * 当前是否还能再加一个色标。
 *
 * @param colors - 现有色标数组。
 */
export function canAddStop(colors: readonly ColorStop[]): boolean {
  return colors.length < MAX_COLOR_STOPS
}

/**
 * 当前是否还能删色标。
 *
 * 下限为 0：删空即「本层不出全息箔」（纯蒙版，见渲染器片元的 `uHasHolo` 门）。空数组在 UI 上
 * 是一条空色带 + 一个「+」按钮——v2 起 `colors: []` 不再回退默认色板，故也不会再
 * 凭空冒出默认游标（这正是过去把下限卡在 1 的原因）。
 */
export function canRemoveStop(colors: readonly ColorStop[]): boolean {
  return colors.length > 0
}

/**
 * 在色带最右端追加一个色标。
 *
 * 新色标固定在位置 `1`，因此永远排在**从左往右数的最后一个**——与「+」按钮在色带右端、
 * 新颜色接在末尾的直觉一致。已有颜色的位置一概不动。
 *
 * @param colors - 现有色标数组。
 * @param hex - 新色值；非法（非十六进制）时原样返回，不写入脏数据。
 * @returns 新数组；已达上限或色值非法时返回原数组引用。
 */
export function addStop(colors: ColorStop[], hex: string): ColorStop[] {
  if (!canAddStop(colors)) return colors
  if (!HEX_COLOR.test(hex)) return colors
  if (colors.length === 0) return [{ color: hex, at: 0 }]
  return [...colors, { color: hex, at: 1 }]
}

/**
 * 删除指定下标的色标。其余颜色的位置原样保留。
 *
 * @param colors - 现有色标数组。
 * @param index - 待删除下标。
 * @returns 新数组；下标越界或已是空数组时返回原数组引用。
 */
export function removeStop(colors: ColorStop[], index: number): ColorStop[] {
  if (index < 0 || index >= colors.length) return colors
  if (!canRemoveStop(colors)) return colors
  return colors.filter((_, i) => i !== index)
}

/**
 * 替换指定下标的色值（位置不动）。
 *
 * @param colors - 现有色标数组。
 * @param index - 目标下标。
 * @param hex - 新色值；非法时原样返回。
 * @returns 新数组；下标越界或色值非法时返回原数组引用。
 */
export function replaceStop(colors: ColorStop[], index: number, hex: string): ColorStop[] {
  if (index < 0 || index >= colors.length) return colors
  if (!HEX_COLOR.test(hex)) return colors
  const next = [...colors]
  next[index] = { color: hex, at: colors[index].at }
  return next
}

/**
 * 拖拽排序：把颜色拖到别的**位置槽**里，百分比（位置）留在原处。
 *
 * 位置决定行的先后，所以「排序」只能是颜色换槽：把红色从 0% 拖到 100% 的槽，红色就
 * 显示在最后一行，而三行的百分比仍是 0 / 50 / 100。这样拖拽也不会让任何一行的数字
 * 跟着别的行变化。
 *
 * @param colors - 现有色标数组。
 * @param from - 被拖动的下标。
 * @param to - 落点下标。
 * @returns 新数组；下标越界时返回原数组引用。
 */
export function reorderStop(colors: ColorStop[], from: number, to: number): ColorStop[] {
  if (from < 0 || from >= colors.length || to < 0 || to >= colors.length) return colors
  if (from === to) return [...colors]

  const order = colors.map((_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)

  return colors.map((stop, i) => ({ color: colors[order[i]].color, at: stop.at }))
}

/**
 * 调整某个颜色的位置。**只改这一个**，其它颜色的百分比原样保留。
 *
 * 位置必须非递减，所以输入会夹在左右邻居的位置之间（允许相等 = 硬边）；
 * 首尾再夹到 0–100%。
 *
 * @param colors - 现有色标数组。
 * @param index - 目标下标。
 * @param at - 新位置（0–1）；越界时夹到边界。
 * @returns 新数组；下标越界时返回原数组引用。
 */
export function setStopPosition(colors: ColorStop[], index: number, at: number): ColorStop[] {
  if (index < 0 || index >= colors.length) return colors
  const prev = index === 0 ? 0 : colors[index - 1].at
  const next = index === colors.length - 1 ? 1 : colors[index + 1].at
  const value = Math.min(next, Math.max(prev, clamp01(at)))
  const result = [...colors]
  result[index] = { color: colors[index].color, at: value }
  return result
}

/**
 * 只读预览用的 CSS 渐变。渲染器在 linear-light 里插值，这里退回 sRGB——只当色带
 * 排列的示意，不追求与画面逐像素一致。
 *
 * @param colors - 现有色标数组。
 * @returns `linear-gradient(to right, …)`；空色板返回 `transparent`。
 */
export function gradientCss(colors: readonly ColorStop[]): string {
  if (colors.length === 0) return "transparent"
  const stops = colors.map((s) => `${s.color} ${(clamp01(s.at) * 100).toFixed(2)}%`)
  return `linear-gradient(to right, ${stops.join(", ")})`
}
