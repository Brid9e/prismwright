/**
 * 颜色取色器的纯换算：hex ↔ HSV、透明度、输入归一。
 *
 * 组件只负责画与收事件；所有会算错的地方都放在这里，node 环境单测覆盖。
 * 透明度沿用 schema 的 `#rrggbbaa` 语义：1 输出 6 位，<1 输出 8 位。
 */
import { withAlpha } from "@prismwright/schema"

export interface Hsv {
  /** 色相 0–360。 */
  h: number
  /** 饱和度 0–1。 */
  s: number
  /** 明度 0–1。 */
  v: number
}

const HEX_INPUT = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 把 3 位展开成 6 位；6/8 位原样；非法返回 null。 */
function bodyOf(input: string): string | null {
  const match = HEX_INPUT.exec(input.trim())
  if (!match) return null
  const body = match[1].toLowerCase()
  return body.length === 3
    ? body
        .split("")
        .map((c) => c + c)
        .join("")
    : body
}

/** 合法 hex → `#rrggbb` 或 `#rrggbbaa`（小写）；非法返回 null。 */
export function normalizeHexInput(input: string): string | null {
  const body = bodyOf(input)
  return body ? `#${body}` : null
}

/**
 * hex → HSV。只读 RGB；透明度由 `alphaOf` 单独取。
 * 非法输入按黑色返回，让控件始终有一个可绘制的值。
 */
export function hexToHsv(hex: string): Hsv {
  const body = bodyOf(hex)
  if (!body) return { h: 0, s: 0, v: 0 }
  const r = Number.parseInt(body.slice(0, 2), 16) / 255
  const g = Number.parseInt(body.slice(2, 4), 16) / 255
  const b = Number.parseInt(body.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

/** HSV + 透明度 → hex；色相回绕、s/v/alpha 夹取。 */
export function hsvToHex(hsv: Hsv, alpha: number): string {
  const h = ((hsv.h % 360) + 360) % 360
  const s = clamp01(hsv.s)
  const v = clamp01(hsv.v)
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  const byte = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0")
  return withAlpha(`#${byte(r)}${byte(g)}${byte(b)}`, alpha)
}
