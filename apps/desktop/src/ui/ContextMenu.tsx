/**
 * 自绘右键菜单：全局唯一的宿主。
 *
 * 两件事：
 * 1. **拦掉 WebView 的默认右键菜单**——捕获阶段挂 `contextmenu`，在任何组件处理之前
 *    `preventDefault()`。Tauri 的 WebView2 默认菜单是「刷新 / 另存为 / 检查」，出现在编辑器
 *    里既没用又出戏。
 * 2. 在文本输入框上补回编辑菜单（撤销 / 剪切 / 复制 / 粘贴 / 全选）。拦掉默认菜单是有代价
 *    的：输入框自带的编辑菜单也一并没了，不补回来用户只能靠快捷键。
 *
 * 各区域（卡片行 / 图层行 / 编辑器空白处）通过 `useUiStore.openContextMenu` 打开自己的
 * 条目；同一时刻只可能有一个菜单，因为状态只有一份。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { formatAccelerator } from "../app/accelerators"
import { useUiStore } from "../store/uiStore"
import {
  isTextEntry,
  runTextCommand,
  textContextItems,
  type ContextMenuItem,
} from "./contextMenuModel"
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS } from "./menuStyles"

/** 距离视口边缘的最小留白：菜单贴边时也要留出一圈阴影的位置。 */
const VIEWPORT_MARGIN = 6

/** 右键菜单宿主，挂在 `App` 顶层、整个进程只渲染一份。 */
export function ContextMenuHost() {
  const { t } = useTranslation("common")
  const menu = useUiStore((s) => s.contextMenu)
  const openContextMenu = useUiStore((s) => s.openContextMenu)
  const close = useUiStore((s) => s.closeContextMenu)

  const ref = useRef<HTMLDivElement>(null)
  /** 测量后的落点；未测量时先按指针位置画（布局副作用会在首帧绘制前纠正）。 */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  /** 键盘高亮项的数组下标；`-1` 表示没有。 */
  const [active, setActive] = useState(-1)

  // 拦掉默认菜单；文本控件上补一份编辑菜单。
  // 捕获阶段：React 的行级处理会 `stopPropagation`，冒泡阶段就再也收不到这些事件了。
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      if (!isTextEntry(event.target)) return
      const el = event.target as HTMLElement
      openContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: textContextItems({
          t,
          run: (command) => {
            void runTextCommand(command, el)
          },
        }),
      })
    }
    document.addEventListener("contextmenu", onContextMenu, true)
    return () => document.removeEventListener("contextmenu", onContextMenu, true)
  }, [t, openContextMenu])

  // 打开 / 换菜单时：重置高亮、量尺寸、夹回视口内、把焦点交给菜单。
  useLayoutEffect(() => {
    setActive(-1)
    if (!menu) {
      setPos(null)
      return
    }
    const el = ref.current
    const width = el?.offsetWidth ?? 0
    const height = el?.offsetHeight ?? 0
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(menu.x, window.innerWidth - width - VIEWPORT_MARGIN),
    )
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(menu.y, window.innerHeight - height - VIEWPORT_MARGIN),
    )
    setPos({ left, top })
    el?.focus({ preventScroll: true })
  }, [menu])

  // 点别处 / 按 Esc / 窗口失焦或变形时关闭。
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return
      close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [menu, close])

  /** 可跳转的条目下标（分隔符与禁用项不参与键盘导航）。 */
  const enabled = useMemo(() => {
    if (!menu) return []
    return menu.items.flatMap((item, index) =>
      item.kind === "item" && !item.disabled ? [index] : [],
    )
  }, [menu])

  if (!menu) return null

  const items = menu.items

  function activate(item: Extract<ContextMenuItem, { kind: "item" }>): void {
    // 先关再执行：动作可能打开对话框，残留的菜单会浮在它上面。
    close()
    item.onSelect()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    if (event.key === "Tab") {
      close()
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (enabled.length === 0) return
      const current = enabled.indexOf(active)
      const step = event.key === "ArrowDown" ? 1 : -1
      const next =
        current === -1
          ? step === 1
            ? 0
            : enabled.length - 1
          : (current + step + enabled.length) % enabled.length
      setActive(enabled[next])
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      const item = items[active]
      if (item && item.kind === "item" && !item.disabled) activate(item)
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={t("context.menuLabel")}
      onKeyDown={onKeyDown}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
      className={`fixed z-[60] outline-none ${MENU_CONTENT_CLASS}`}
    >
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <div key={`sep-${index}`} role="separator" className="mx-1 my-1 h-px bg-border-subtle" />
        ) : (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            // 不抢焦点：文本菜单的命令要作用在原来的输入框上，焦点一丢就落错地方。
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => activate(item)}
            className={`${MENU_ITEM_CLASS} ${
              index === active ? "bg-accent/25" : ""
            } ${item.danger ? "text-danger" : ""} disabled:text-disabled`}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.accelerator && (
              <span className="ml-auto shrink-0 pl-4 text-[11px] text-muted">
                {formatAccelerator(item.accelerator)}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  )
}
