/**
 * 面板容器：标题栏（可折叠）+ 内容区。
 *
 * 三栏共用同一个外壳，使标题栏高度、字号、折叠交互在全应用一致。
 *
 * 折叠只收起**内容区**，标题栏常驻——一栏里因此可以叠放多个面板、逐个折叠，
 * 标题始终可点开（与整栏隐藏分开：后者由顶部菜单栏控制，见 `uiStore.folded`）。
 */
import type { ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

/** 面板标题栏右侧的操作位（按钮、下拉等）。 */
export interface PanelProps {
  /** 标题文本（调用方负责翻译）。 */
  title: string
  /** 标题栏右侧的附加控件。 */
  actions?: ReactNode
  /** 内容区是否折叠（标题栏保留）；不传表示该面板不可折叠。 */
  collapsed?: boolean
  /** 折叠开关回调；与 `collapsed` 成对出现。 */
  onToggleCollapsed?: () => void
  /** 内容区是否可滚动（长列表用）。 */
  scroll?: boolean
  children: ReactNode
}

export function Panel({
  title,
  actions,
  collapsed,
  onToggleCollapsed,
  scroll = true,
  children,
}: PanelProps) {
  const collapsible = collapsed !== undefined && onToggleCollapsed !== undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line px-2">
        {collapsible && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={title}
            aria-expanded={!collapsed}
            className="flex h-5 w-5 items-center justify-center rounded-control text-muted hover:bg-elevated hover:text-foreground"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <span className="select-none text-label font-medium uppercase tracking-wide text-muted">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {!collapsed && (
        // 纵向滚动的属性面板不该出现横向滚动条：横向溢出一律是内部元素没受约束的布局瑕疵。
        // 这里只放开 y，x 裁掉，配合内部文本的 `truncate` 表现为省略号而非滚动条。
        <div
          className={`min-h-0 flex-1 ${scroll ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden"}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
