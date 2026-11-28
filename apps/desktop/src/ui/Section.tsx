/**
 * 面板内的分组卡：把长属性列表按语义折成几块。
 *
 * 与 `Panel` 的区别：`Panel` 是占满整块的三栏外壳，`SectionCard` 是外壳**内部**的圆角卡片。
 * 展开态由组件自身持有（非受控）；同一面板里的多张卡各自独立折叠。
 *
 * `Section` 是旧名，保留导出以免迁移期大面积改调用点，行为等同 `SectionCard`。
 */
import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

export interface SectionCardProps {
  /** 标题文本（调用方负责翻译）。 */
  title: string
  /** 初始是否展开；之后由组件自身状态接管。默认展开。 */
  defaultOpen?: boolean
  /** 标题栏右侧的附加控件（如启用开关、摘要文本）。 */
  actions?: ReactNode
  /** 是否允许折叠；固定分组传 `false`，标题只作分隔。 */
  collapsible?: boolean
  children: ReactNode
}

export function SectionCard({
  title,
  defaultOpen = true,
  actions,
  collapsible = true,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="overflow-hidden rounded-card border border-line bg-elevated/40">
      <div className="flex h-row items-center gap-2 px-3">
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={title}
            aria-expanded={open}
            className="flex h-6 w-6 items-center justify-center rounded-control text-muted outline-none hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <span className="select-none text-body font-semibold text-muted">{title}</span>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {(!collapsible || open) && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

export type SectionProps = Omit<SectionCardProps, "collapsible">

/** 旧名：默认任意分组都可折叠。 */
export function Section(props: SectionProps) {
  return <SectionCard {...props} />
}
