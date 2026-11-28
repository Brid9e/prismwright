/**
 * 文本按钮。
 *
 * 编辑器里按钮的尺寸、圆角、状态必须一致，否则同一块面板里会出现两三种「差不多」的按钮。
 * 变体只表达语义（主/次/幽灵/危险），尺寸固定为规范里的 `h-button`（28px）；更小的图标按钮
 * 用 `IconButton`。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-line-soft text-muted hover:bg-elevated hover:text-foreground",
  ghost: "text-muted hover:bg-elevated hover:text-foreground",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant
  /** 追加布局类（如 `w-full`、`justify-start`）；不参与尺寸与配色。 */
  className?: string
  children: ReactNode
}

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-button shrink-0 items-center justify-center gap-1.5 rounded-control px-3 text-body font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
