/**
 * 全局快捷键。
 *
 * 两件事：
 *
 * 1. **带修饰键的菜单快捷键**（Ctrl+N/O/S/W/Z/⇧Z/,）。它们在哪个界面被接住，取决于菜单画在哪：
 *    macOS / Linux 是**原生菜单**（系统按键，见 `nativeMenu.ts`），Windows 是**自绘标题栏**，
 *    系统不再代劳，由这里查 {@link MENU_ACCELERATORS} 派发。表取自菜单模型本身，所以「标题栏里
 *    显示的键」与「按下时接的键」是同一份数据；两个平台各接一头，不会双触发。
 * 2. **无法做成菜单快捷键的键**：Delete / Backspace 删除选中项；Esc 关闭设置视图；
 *    Ctrl+C / Ctrl+V 复制粘贴图层（键位判定见 `clipboardKeys.ts`）。
 *
 * 挂在 window 上而非某个容器：编辑器里焦点可能落在任意输入框上，快捷键仍应生效。
 * 但焦点在可编辑控件内时**整体让路**——那里 Ctrl+Z 是输入框自己的撤销、Backspace 是删字符，
 * 抢过来会毁掉正在输入的文本。
 */
import { useEffect } from "react"
import { usePackStore } from "../store/packStore"
import { useUiStore } from "../store/uiStore"
import { findAccelerator } from "./accelerators"
import { matchLayerClipboardKey } from "./clipboardKeys"
import { MENU_ACCELERATORS } from "./menuModel"
import { dispatch } from "./menuActions"
import { detectPlatform, usesNativeMenu } from "./platform"

/** 判断事件是否发生在可编辑控件内（输入框、文本域、下拉、富文本）。 */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

/** 注册全局快捷键，组件卸载时移除。 */
export function useShortcuts(): void {
  useEffect(() => {
    // 菜单画在窗口内（自绘标题栏）时才由这里接带修饰键的快捷键；原生菜单的平台（macOS /
    // Linux）按键归系统管，这里只留 Delete / Backspace。
    const menusInDom = !usesNativeMenu(detectPlatform(navigator.userAgent))

    function onKeyDown(e: KeyboardEvent) {
      // Esc 关闭设置视图：置于「编辑控件让路」判断**之前**，确保焦点无论落在哪——含外观面板的
      // 下拉框——都能退出。设置视图没有可输入文本，Esc 与输入语义不冲突。
      if (e.key === "Escape" && useUiStore.getState().settingsOpen) {
        e.preventDefault()
        useUiStore.getState().setSettingsOpen(false)
        return
      }

      if (isEditingTarget(e.target)) return

      if (menusInDom) {
        const id = findAccelerator(e, MENU_ACCELERATORS)
        if (id) {
          // 挡掉浏览器默认的 Ctrl+S 存网页、Ctrl+O 开文件、Ctrl+W 关标签页。
          e.preventDefault()
          dispatch(id)
          return
        }
      }

      // 复制 / 粘贴图层：编辑器自带的图层剪贴板，可跨卡片、跨正背面粘贴。
      // 不走菜单表——菜单项常驻，而这两个键只在「选中了图层 / 剪贴板里有东西」时才有
      // 意义；焦点在输入控件里时上面已整体让路，Ctrl+C/V 仍归文本框自己。
      const clipboardKey = matchLayerClipboardKey(e)
      if (clipboardKey) {
        const { selectedCardId, selectedLayerId, layerClipboard, copyLayer, pasteLayer } =
          usePackStore.getState()
        const ui = useUiStore.getState()
        // 与右栏、Delete 同一口径：图层所属卡面由预览正/背面决定。
        const ref =
          ui.previewSide === "back"
            ? ({ kind: "back" } as const)
            : selectedCardId
              ? ({ kind: "card", cardId: selectedCardId } as const)
              : null
        if (ref && clipboardKey === "copy" && selectedLayerId) {
          e.preventDefault()
          copyLayer(ref, selectedLayerId)
        } else if (ref && clipboardKey === "paste" && layerClipboard) {
          e.preventDefault()
          pasteLayer(ref)
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedCardId, selectedLayerId, pack } = usePackStore.getState()
        if (selectedLayerId) {
          e.preventDefault()
          const ui = useUiStore.getState()
          // 图层所属卡面由预览正/背面决定，与右栏的推导保持一致。
          const ref =
            ui.previewSide === "back"
              ? ({ kind: "back" } as const)
              : ({ kind: "card", cardId: selectedCardId ?? "" } as const)
          ui.requestConfirm({ kind: "delete-layer", ref, layerId: selectedLayerId })
        } else if (selectedCardId && pack) {
          e.preventDefault()
          useUiStore.getState().requestConfirm({ kind: "delete-card", cardId: selectedCardId })
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
