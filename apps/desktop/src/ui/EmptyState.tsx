/**
 * 空态：图标 + 一行说明（+ 可选的补充行）。
 *
 * 统一成「小图标 + 一句话」而不是大段占位文字：检查器里空态出现的频率很高
 * （未选图层、图层没有效果），大块插画会把本就不宽的面板撑得很空。
 */
import type { LucideIcon } from "lucide-react"

export interface EmptyStateProps {
  icon?: LucideIcon
  /** 主要说明（调用方负责翻译）。 */
  title: string
  /** 补充说明（可选）。 */
  hint?: string
}

export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      {Icon && <Icon size={20} className="text-disabled" />}
      <p className="text-body text-muted">{title}</p>
      {hint && <p className="text-num text-disabled">{hint}</p>}
    </div>
  )
}
