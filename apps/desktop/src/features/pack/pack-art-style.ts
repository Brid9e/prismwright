/**
 * 卡包图合成样式的纯换算：样式对象 → 两层预览的 CSS。
 *
 * 抽卡页由两层叠成：底下是系列卡包图，上面是原卡包（混合 + 滤镜）。编辑器预览必须
 * 与小程序同一套算法，用户调的是什么，真机就是什么。小程序端的等价实现见
 * `apps/miniprogram/miniprogram/utils/pack-style.js`（那边拼的是内联样式字符串）。
 */
import type { CSSProperties } from "react"
import type { PackArtBlend, PackArtFit, PackArtStyle } from "@cardbara/schema"

/**
 * 混合方式下拉框的顺序：默认值在前，其余按「常用 → 强烈 → 少见」排。
 *
 * 取值范围必须与 schema 的 `PackArtBlend` 完全一致（类型约束兜住）。
 */
export const PACK_ART_BLENDS: readonly PackArtBlend[] = [
  "screen",
  "soft-light",
  "overlay",
  "hard-light",
  "multiply",
  "normal",
  "lighten",
  "color-dodge",
  "difference",
]

/** 填充方式下拉框的顺序，默认 `cover` 在前。 */
export const PACK_ART_FITS: readonly PackArtFit[] = ["cover", "fill", "contain"]

/** 去掉浮点尾巴，避免 `brightness(0.30000000000000004)` 这类字符串。 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 上层原卡包的 CSS：整张铺满袋面，按样式混合到底图上。
 *
 * `mix-blend-mode` 只有在同一个层叠上下文里才和底图合成，预览容器必须
 * `isolation: isolate`（见 `PackArtPreview`），否则会连页面底色一起混。
 */
export function packLayerCss(style: PackArtStyle): CSSProperties {
  const filter =
    `brightness(${round(style.packBrightness)}) contrast(${round(style.packContrast)})` +
    (style.packInvert ? " invert(1)" : "")
  return {
    mixBlendMode: style.blend,
    opacity: round(style.opacity),
    filter,
  }
}

/**
 * 底层卡包图的 CSS：填充方式与取景位置。
 *
 * 用 `object-fit` + `object-position` 而不是小程序那边的「放大 140% 再平移」：
 * 两种写法在 cover 下等价，编辑器直接写位置更省事。
 */
export function artLayerCss(style: PackArtStyle): CSSProperties {
  return {
    objectFit: style.fit,
    objectPosition: `${round(style.x)}% ${round(style.y)}%`,
    filter: `brightness(${round(style.artBrightness)}) saturate(${round(style.artSaturate)})`,
  }
}
