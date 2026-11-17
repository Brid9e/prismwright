/**
 * 卡包图合成样式的纯换算：样式对象 → 两层的 CSS。
 *
 * 预览用的就是这两组 CSS，改错了用户在编辑器里看到的就不是小程序里的样子，
 * 所以数值与字符串都钉死。
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_PACK_ART_STYLE } from "@cardbara/schema"
import { PACK_ART_BLENDS, PACK_ART_FITS, artLayerCss, packLayerCss } from "../pack-art-style"

describe("图层 CSS", () => {
  it("上层原卡包：混合方式、透明度与滤镜", () => {
    expect(packLayerCss({ ...DEFAULT_PACK_ART_STYLE })).toEqual({
      mixBlendMode: "screen",
      opacity: 1,
      filter: "brightness(1) contrast(1)",
    })

    const styled = packLayerCss({
      ...DEFAULT_PACK_ART_STYLE,
      blend: "soft-light",
      opacity: 0.6,
      packBrightness: 1.2,
      packContrast: 0.8,
      packInvert: true,
    })
    expect(styled.mixBlendMode).toBe("soft-light")
    expect(styled.opacity).toBe(0.6)
    expect(styled.filter).toBe("brightness(1.2) contrast(0.8) invert(1)")
  })

  it("底图：填充方式、取景位置与滤镜", () => {
    expect(artLayerCss({ ...DEFAULT_PACK_ART_STYLE })).toEqual({
      objectFit: "cover",
      objectPosition: "50% 50%",
      filter: "brightness(1) saturate(1)",
    })

    const styled = artLayerCss({
      ...DEFAULT_PACK_ART_STYLE,
      fit: "fill",
      x: 10,
      y: 90,
      artBrightness: 0.5,
      artSaturate: 1.5,
    })
    expect(styled.objectFit).toBe("fill")
    expect(styled.objectPosition).toBe("10% 90%")
    expect(styled.filter).toBe("brightness(0.5) saturate(1.5)")
  })
})

describe("枚举", () => {
  it("混合方式就是 schema 允许的那九种，默认 screen 排在最前", () => {
    expect(PACK_ART_BLENDS).toEqual([
      "screen",
      "soft-light",
      "overlay",
      "hard-light",
      "multiply",
      "normal",
      "lighten",
      "color-dodge",
      "difference",
    ])
  })

  it("填充方式与 schema 的 PackArtFit 一致", () => {
    expect(PACK_ART_FITS).toEqual(["cover", "fill", "contain"])
  })
})
