/**
 * 工具栏与其按钮。
 *
 * 按钮一律「图标 + tooltip」：编辑器界面紧凑，文字标签放不下，但纯图标不可猜，
 * 所以 tooltip 是必需的而非装饰。
 */
import type { LucideIcon } from "lucide-react"
import { Tooltip } from "./Tooltip"

export interface ToolbarButtonProps {
  /** lucide 图标组件。 */
  icon: LucideIcon
  /** 提示文本（调用方负责翻译）。 */
  label: string
  onClick: () => void
  /** 是否为激活态（如开关已打开）。 */
  active?: boolean
  disabled?: boolean
}

export function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: ToolbarButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-7 w-7 items-center justify-center rounded-control outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 ${
          active
            ? "bg-accent-soft text-accent"
            : "text-muted hover:bg-elevated hover:text-foreground"
        } disabled:text-disabled disabled:hover:bg-transparent`}
      >
        <Icon size={15} />
      </button>
    </Tooltip>
  )
}
