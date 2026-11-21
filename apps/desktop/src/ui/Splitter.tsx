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

/** 可拖拽的分隔条：默认 1px，悬浮/拖拽时高亮。 */
function Handle() {
  return (
    <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-state=drag]:bg-accent data-[resize-handle-state=hover]:bg-accent/60" />
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
  /** 左栏折叠状态。 */
  leftCollapsed: boolean
  /** 右栏折叠状态。 */
  rightCollapsed: boolean
}

export function Splitter({ left, center, right, leftCollapsed, rightCollapsed }: SplitterProps) {
  const leftRef = useCollapsedSync(leftCollapsed)
  const rightRef = useCollapsedSync(rightCollapsed)

  return (
    <PanelGroup direction="horizontal" autoSaveId="prismwright-layout" className="min-h-0 flex-1">
      <ResizePanel
        ref={leftRef}
        id="left"
        order={1}
        defaultSize={18}
        minSize={12}
        maxSize={32}
        collapsible
        collapsedSize={0}
        className="min-w-0"
      >
        {left}
      </ResizePanel>
      <Handle />
      <ResizePanel id="center" order={2} minSize={30} className="min-w-0 bg-sunken">
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
        className="min-w-0"
      >
        {right}
      </ResizePanel>
    </PanelGroup>
  )
}
