/**
 * 卡包图合成预览：底层卡包图（按原卡包 alpha 轮廓裁边）+ 上层原卡包（混合 + 滤镜）。
 *
 * 与抽卡页同一套做法：底图用原卡包的 alpha 作遮罩，四角被裁成袋子轮廓；上层原卡包
 * 自带高光、折边与锯齿封口，靠 `mix-blend-mode` 与底图合成。没配卡包图时只显示原卡包。
 */
import type { PackArtStyle } from "@cardbara/schema"
import packSrc from "./assets/pack.webp"
import { artLayerCss, packLayerCss } from "./pack-art-style"

export interface PackArtPreviewProps {
  /** 卡包图的 object URL；`null` 表示还没配图。 */
  artSrc: string | null
  style: PackArtStyle
  className?: string
}

/** 预览底色取应用面板色：袋子的透明边角透出的就是这个颜色。 */
const PAGE_BG = "var(--color-surface-app)"

export function PackArtPreview({ artSrc, style, className }: PackArtPreviewProps) {
  return (
    <div
      // `isolate` 把混合限制在这两层之间，不与编辑器面板的深色底串色。
      className={`relative isolate overflow-hidden ${className ?? ""}`}
      style={{ background: PAGE_BG }}
    >
      {artSrc && (
        // 原卡包整张也是遮罩：alpha 轮廓外面的底图直接被裁掉。
        <img
          src={artSrc}
          alt=""
          className="absolute inset-0 h-full w-full"
          style={{
            ...artLayerCss(style),
            WebkitMaskImage: `url(${packSrc})`,
            maskImage: `url(${packSrc})`,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
          }}
        />
      )}
      <img
        src={packSrc}
        alt=""
        className="absolute inset-0 h-full w-full"
        // 没有底图时不混合：screen 叠在页面底色上会把袋子本体整个减淡。
        style={artSrc ? packLayerCss(style) : undefined}
      />
    </div>
  )
}
