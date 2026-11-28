/**
 * 三栏布局：左右两栏可拖拽调宽、可折叠，中栏占据剩余空间。
 *
 * 布局经 `autoSaveId` 持久化到 localStorage，重启后保持用户拖过的宽度。
 * 折叠交给 react-resizable-panels 处理：由命令式的 `collapse()`/`expand()` 驱动，
 * 宽度记忆存在库内部（折叠再展开要回到折叠前的宽度），自己实现很容易丢。
 */
import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { ImperativePanelHandle } from "react-resizable-panels"
import { Panel as ResizePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { layoutSizes, type LayoutMode } from "../app/layoutMode"

/**
 * 可拖拽的分隔条：8px 留白（与面板间距一致），悬浮/拖拽时中部亮起一条绿线。
 *
 * 不用 1px 实线：左右栏是浮层，中间那 8px 应该像「空气」而不是分割线；只有鼠标靠近时
 * 才提示这里可以拖。
 */
function Handle() {
  return (
    <PanelResizeHandle className="group relative w-2 transition-colors">
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-data-[resize-handle-state=hover]:bg-accent/50 group-data-[resize-handle-state=drag]:bg-accent" />
    </PanelResizeHandle>
  )
}

/**
 * 把「是否折叠」的受控状态同步到面板上。
 *
 * react-resizable-panels 的 `Panel` 没有受控的 `collapsed` prop，折叠只能通过
 * 命令式的 `collapse()`/`expand()` 触发。这里先比对面板当前状态再调用，避免挂载后
 * 被 effect 覆盖掉 `autoSaveId` 恢复出来的宽度。
 */
function useCollapsedSync(collapsed: boolean) {
  const ref = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    if (collapsed && !panel.isCollapsed()) panel.collapse()
    if (!collapsed && panel.isCollapsed()) panel.expand()
  }, [collapsed])

  return ref
}

export interface SplitterProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  /** 当前布局模式；切换时把两栏调到该模式的配比。 */
  layout: LayoutMode
  /** 左栏折叠状态（菜单显隐）。 */
  leftCollapsed: boolean
  /** 右栏折叠状态（菜单显隐）。 */
  rightCollapsed: boolean
}

export function Splitter({
  left,
  center,
  right,
  layout,
  leftCollapsed,
  rightCollapsed,
}: SplitterProps) {
  const leftRef = useCollapsedSync(leftCollapsed)
  const rightRef = useCollapsedSync(rightCollapsed)

  /**
   * 布局模式 → 列宽。
   *
   * 首次挂载且模式是「工作室」时跳过：此时 `autoSaveId` 恢复的是用户上次拖出来的宽度，
   * 用 18% 覆盖会把这份记忆冲掉。其余情况（切模式、启动时就是专注/紧凑）一律套用配比。
   */
  const applied = useRef(false)
  useEffect(() => {
    const leftPanel = leftRef.current
    const rightPanel = rightRef.current
    if (!leftPanel || !rightPanel) return
    if (!applied.current && layout === "studio") {
      applied.current = true
      return
    }
    applied.current = true
    const sizes = layoutSizes(layout)
    if (sizes.left === 0) {
      if (!leftPanel.isCollapsed()) leftPanel.collapse()
    } else {
      if (leftPanel.isCollapsed()) leftPanel.expand()
      leftPanel.resize(sizes.left)
    }
    if (!rightPanel.isCollapsed()) rightPanel.resize(sizes.right)
  }, [layout, leftRef, rightRef])

  return (
    <PanelGroup direction="horizontal" autoSaveId="prismwright-layout" className="min-h-0 flex-1">
      <ResizePanel
        ref={leftRef}
        id="left"
        order={1}
        defaultSize={18}
        // 紧凑模式左栏只有缩略图条，允许压到比常规更窄。
        minSize={layout === "compact" ? 4 : 12}
        maxSize={32}
        collapsible
        collapsedSize={0}
        className="min-w-0 overflow-hidden"
      >
        <div className="panel-shadow flex h-full flex-col overflow-hidden rounded-panel border border-line-soft bg-panel">
          {left}
        </div>
      </ResizePanel>
      <Handle />
      {/* 中栏不铺底色：舞台直接落在应用底色上，四周的浮层是左右栏与顶栏。 */}
      <ResizePanel id="center" order={2} minSize={30} className="min-w-0">
        {center}
      </ResizePanel>
      <Handle />
      <ResizePanel
        ref={rightRef}
        id="right"
        order={3}
        defaultSize={26}
        minSize={18}
        maxSize={40}
        collapsible
        collapsedSize={0}
        className="min-w-0 overflow-hidden"
      >
        <div className="panel-shadow flex h-full flex-col overflow-hidden rounded-panel border border-line-soft bg-panel">
          {right}
        </div>
      </ResizePanel>
    </PanelGroup>
  )
}
