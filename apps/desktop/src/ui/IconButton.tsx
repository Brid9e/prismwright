/**
 * 图标按钮（带 tooltip）。
 *
 * 与 `ToolbarButton` 的区别：本组件用于属性行内联位置，尺寸更小、无激活态。
 */
import type { LucideIcon } from "lucide-react"
import { Tooltip } from "./Tooltip"

export interface IconButtonProps {
  icon: LucideIcon
  /** 提示文本（调用方负责翻译）。 */
  label: string
  onClick: () => void
  disabled?: boolean
}

export function IconButton({ icon: Icon, label, onClick, disabled }: IconButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted outline-none hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/50 disabled:text-disabled disabled:opacity-40"
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  )
}
