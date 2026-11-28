/**
 * 小标签：稀有度、状态等一行内的短标记。
 *
 * 颜色不在这里自由发挥——稀有度色标与卡片、卡册、小程序共用同一套 token，
 * 通过 `rarityTone` 取色，避免同一个「传说」在两个界面是两种黄。
 */
import type { ReactNode } from "react"
import type { Rarity } from "@prismwright/schema"
import { rarityTone } from "./rarityTone"

export interface TagProps {
  tone: Rarity
  children: ReactNode
  /** 追加布局类；不参与配色。 */
  className?: string
}

export function Tag({ tone, children, className = "" }: TagProps) {
  const colors = rarityTone(tone)
  return (
    <span
      className={`shrink-0 rounded-chip px-1.5 text-num leading-4 ${colors.text} ${colors.tint} ${className}`}
    >
      {children}
    </span>
  )
}
