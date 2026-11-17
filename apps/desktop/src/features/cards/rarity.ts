/**
 * 稀有度识别配色（卡片树、卡册等列表里的小色标）。
 *
 * 色值在 `styles/tokens.css` 的 `--color-rarity-*`，与小程序 `utils/rarity-config.js`、
 * `rarity-*.png` 徽章同一套——两个前端看到的同一张卡应该是同一个颜色，改色时两边一起改。
 * 类名写成完整字符串（不拼模板），Tailwind 才能静态扫到并生成样式。
 */
import type { Rarity } from "@cardbara/schema"

export interface RarityTone {
  /** 文字与描边色。 */
  text: string
  /** 低透明度底色。 */
  tint: string
  /** 左侧 3px 色条（卡册格子用）。 */
  edge: string
}

const TONES: Record<Rarity, RarityTone> = {
  common: { text: "text-rarity-common", tint: "bg-rarity-common/15", edge: "border-l-rarity-common" },
  rare: { text: "text-rarity-rare", tint: "bg-rarity-rare/15", edge: "border-l-rarity-rare" },
  epic: { text: "text-rarity-epic", tint: "bg-rarity-epic/15", edge: "border-l-rarity-epic" },
  legendary: {
    text: "text-rarity-legendary",
    tint: "bg-rarity-legendary/15",
    edge: "border-l-rarity-legendary",
  },
}

/** 取一档配色；数据异常时退回普通档，避免列表里出现没颜色的空白标签。 */
export function rarityTone(rarity: Rarity): RarityTone {
  return TONES[rarity] ?? TONES.common
}
