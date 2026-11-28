/**
 * 文本按钮。
 *
 * 编辑器里按钮的尺寸、圆角、状态必须一致，否则同一块面板里会出现两三种「差不多」的按钮。
 * 变体只表达语义（主/次/幽灵/危险），尺寸固定为规范里的 `h-button`（28px）；更小的图标按钮
 * 用 `IconButton`。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid"

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-line-soft text-muted hover:bg-elevated hover:text-foreground",
  ghost: "text-muted hover:bg-elevated hover:text-foreground",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
  // 破坏性操作的确认键：实心红，与「取消」拉开距离。
  "danger-solid": "bg-danger text-foreground hover:opacity-90",
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant
  /**
   * 尺寸：`md` 是默认（12px 字、12px 内边距），`sm` 用于面板内的工具按钮
   * （11px 字、8px 内边距）。
   *
   * 做成显式 prop 而不是让调用方用 `className` 覆盖：`px-2` 与基类 `px-3` 是同一属性，
   * Tailwind 的产出顺序决定谁赢，不按 class 书写顺序——覆盖会静默失效。
   */
  size?: "md" | "sm"
  /** 内容对齐：默认居中；带图标的列表/工具按钮传 `start`。 */
  align?: "center" | "start"
  /** 追加布局类（如 `w-full`）；不要用它改尺寸、对齐或配色。 */
  className?: string
  children: ReactNode
}

const SIZE_CLASS = {
  md: "px-3 text-body",
  sm: "px-2 text-label",
} as const

export function Button({
  variant = "secondary",
  size = "md",
  align = "center",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-button shrink-0 items-center gap-2 rounded-control font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${
        align === "start" ? "justify-start" : "justify-center"
      } ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
