/**
 * 面板内可折叠分区：一组相关属性的分组容器。
 *
 * 与 `Panel` 的区别：`Panel` 是占满整块的三栏外壳，`Section` 是外壳**内部**的分组——
 * 用来把长属性列表按语义折叠成几块，单个面板因此不必一次性铺满几十行。
 * 展开态由组件自身持有（非受控）；同一面板里的多个 `Section` 各自独立折叠。
 */
import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

export interface SectionProps {
  /** 标题文本（调用方负责翻译）。 */
  title: string
  /** 初始是否展开；之后由组件自身状态接管。默认展开。 */
  defaultOpen?: boolean
  /** 标题栏右侧的附加控件（如启用开关、摘要文本）。 */
  actions?: ReactNode
  children: ReactNode
}

export function Section({ title, defaultOpen = true, actions, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex h-7 items-center gap-1 bg-elevated/40 px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={title}
          aria-expanded={open}
          className="flex h-5 w-5 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-foreground"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="select-none text-[10px] font-medium uppercase tracking-wide text-disabled">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {open && <div>{children}</div>}
    </div>
  )
}
