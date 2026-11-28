/**
 * 分段控件：少量互斥选项的一行切换（正面/背面、预览/绘画、三种布局）。
 *
 * 用 `role="tablist"` / `role="tab"` 而非单选按钮：它切换的是「当前视图」，
 * 选中项与读屏语义都更贴近页签。尺寸固定为规范里的 `h-control`（24px），
 * 各项与容器共用 `rounded-control`。
 */
import type { KeyboardEvent } from "react"
import type { LucideIcon } from "lucide-react"

export interface SegmentedOption {
  value: string
  /** 展示文本（调用方负责翻译）；纯图标项传空串。 */
  label: string
  icon?: LucideIcon
  /** 可访问名：纯图标项必须传，否则读屏只报「页签」。 */
  ariaLabel?: string
}

export interface SegmentedProps {
  value: string
  options: SegmentedOption[]
  onChange: (value: string) => void
  /** 整组的可访问名。 */
  ariaLabel?: string
  disabled?: boolean
}

export function Segmented({ value, options, onChange, ariaLabel, disabled }: SegmentedProps) {
  const selectedIndex = options.findIndex((option) => option.value === value)

  /**
   * 方向键在选项间移动。`tabIndex` 用 roving 模式：整组只有一个 Tab 停点，
   * 进入后靠左右键切换，与 WAI-ARIA 的页签模式一致。
   */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const delta = event.key === "ArrowRight" ? 1 : -1
    const next = options[(index + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex shrink-0 items-center gap-1">
      {options.map((option, index) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={option.ariaLabel}
            title={option.ariaLabel ?? option.label}
            disabled={disabled}
            tabIndex={active || (selectedIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`inline-flex h-control items-center gap-1.5 rounded-control px-2.5 text-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "bg-elevated text-foreground shadow-sm"
                : "text-muted hover:bg-elevated/60 hover:text-foreground"
            }`}
          >
            {Icon && <Icon size={13} className="shrink-0" />}
            {option.label && <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
