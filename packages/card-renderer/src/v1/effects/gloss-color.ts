/**
 * 光泽条目的颜色 → `uGlossColor` 定长数组（`vec3[GLOSS_MAX]`）。
 *
 * 颜色不进 `packUniforms`（那里只打包标量 / vec2，且是零 three 依赖的纯数据层）：与调色板
 * 同理，材质侧直接解析成 `Color` 绑定。缺省色是**老的暖白常量**——不在 schema 里补默认 hex
 * 是刻意的，见 `GlossParams.color` 的注释：补了默认值，存量卡的光带颜色就会变。
 */
import { Color } from "three"
import { alphaOf, type Effect } from "@cardbara/schema"
import { GLOSS_MAX } from "./registry"

/**
 * 缺省光带颜色（线性工作空间）。三个分量刻意 >1，是原实现过曝的暖白；
 * 改成任何 hex 都会让存量系列的画面发生变化，故只能原样保留。
 */
export const LEGACY_GLOSS_COLOR: readonly [number, number, number] = [1.15, 1.1, 1.05]

/** 一条光泽的定长槽位颜色：缺省 = 老的暖白常量，设了 = 该 hex（sRGB → 线性）。 */
function colorOf(color: string | undefined): Color {
  return color
    ? new Color(color)
    : new Color().setRGB(LEGACY_GLOSS_COLOR[0], LEGACY_GLOSS_COLOR[1], LEGACY_GLOSS_COLOR[2])
}

/**
 * 取启用的光泽条目（保持列表序、按 `GLOSS_MAX` 截断）的颜色，并补满定长数组。
 *
 * 未占用的槽位同样填老暖白：它们不参与着色（着色器以 `uGlossCount` 门控），取值只为让
 * 定长数组确定下来，避免留下 `undefined`。
 */
export function glossColorUniforms(effects: readonly Effect[]): Color[] {
  const out: Color[] = []
  for (const e of effects) {
    if (e.kind !== "gloss" || !e.enabled || out.length >= GLOSS_MAX) continue
    out.push(colorOf(e.params.color))
  }
  while (out.length < GLOSS_MAX) out.push(colorOf(undefined))
  return out
}

/**
 * 光泽条目颜色的透明度 → `uGlossAlpha` 定长数组（`float[GLOSS_MAX]`）。
 *
 * 只在着色器里缩放该条光带的贡献（加光与压暗两项），不参与色彩空间换算。缺省色 /
 * 6 位色都是 1；未占用槽位同样补 1——它们不参与着色，见 {@link glossColorUniforms}。
 */
export function glossAlphaUniforms(effects: readonly Effect[]): number[] {
  const out: number[] = []
  for (const e of effects) {
    if (e.kind !== "gloss" || !e.enabled || out.length >= GLOSS_MAX) continue
    out.push(e.params.color ? alphaOf(e.params.color) : 1)
  }
  while (out.length < GLOSS_MAX) out.push(1)
  return out
}
