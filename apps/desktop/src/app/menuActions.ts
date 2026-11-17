/**
 * 菜单动作表：菜单项 id → 动作。
 *
 * 原生菜单（`nativeMenu.ts`）与自绘标题栏（`features/titlebar/`）共用这一张表，所以
 * 「同一项在两个界面上做同一件事」是结构保证的，不必两处各写一遍、也不会各改一半。
 * 菜单的**结构**在 `menuModel.ts`，快捷键的接线在 `shortcuts.ts`，这里只负责按 id 触发。
 */
import { getCurrentWindow } from "@tauri-apps/api/window"
import { pickBundleForImport } from "../features/bundle/bundleActions"
import { usePackStore } from "../store/packStore"
import { useRecentStore } from "../store/recentStore"
import { useUiStore } from "../store/uiStore"
import { closePackFlow, newPackFlow, openPackFlow, openRecentFlow } from "./packActions"

/**
 * 退出应用。
 *
 * 走**窗口关闭**而不是进程硬退：`App.tsx` 挂着「关窗前先冲刷未落盘编辑」的处理器，
 * 硬退会绕过它、丢掉最后那次防抖窗口里的写入（见 `App.tsx` 的 `onCloseRequested`）。
 *
 * 无 Tauri（`dev:web`）时静默降级——那里本来也没有窗口可关。`getCurrentWindow()` 读
 * `window.__TAURI_INTERNALS__`，无 Tauri 时会**同步**抛错，故 try/catch 包住整句；
 * `close()` 的拒绝另有一层 `.catch()`（同 `App.tsx` 对 `setTitle` 的写法）。
 */
function quit(): void {
  try {
    void getCurrentWindow()
      .close()
      .catch(() => {})
  } catch {
    // dev:web：没有窗口可关。
  }
}

/**
 * 按菜单项 id 触发动作。
 *
 * @param id - 菜单项 id；`recent:` 前缀的项打开对应的最近系列。
 */
export function dispatch(id: string): void {
  const ui = useUiStore.getState()
  switch (id) {
    case "app.settings":
      ui.setSettingsOpen(true)
      return
    case "app.quit":
      quit()
      return
    case "file.new":
      void newPackFlow()
      return
    case "file.open":
      void openPackFlow()
      return
    case "file.save":
      void usePackStore.getState().save()
      return
    case "file.renamePack":
      // 没有打开系列时没有可改的名字；菜单项在起始屏本就不可见，这里按同一语义空操作。
      if (usePackStore.getState().pack) ui.requestRenamePack()
      return
    case "file.probabilities":
      // 同「重命名系列」：没有打开系列就没有可配置的权重。
      if (usePackStore.getState().pack) ui.requestProbabilities()
      return
    case "file.album":
      // 没有打开系列就没有卡册可排。
      if (usePackStore.getState().pack) ui.setAlbumOpen(true)
      return
    case "file.import":
      void pickBundleForImport()
      return
    case "file.export.series":
      // 没有打开系列就没有可导出的工程；此时对话框无从取名字，按空操作处理。
      if (usePackStore.getState().pack) ui.openBundleExport(null)
      return
    case "file.close":
      void closePackFlow()
      return
    case "file.recent.clear":
      void useRecentStore.getState().clear()
      return
    // 绘画期间撤销 / 重做作用在画布上（撤一笔 / 恢复一笔），不碰 pack 的历史：否则
    // Ctrl+Z 会把卡片在画笔底下改掉，甚至删掉正在画的擦除效果。会话结束后回调摘除，
    // 这里自然回到 pack 撤销（见 `uiStore.erasePaintHistory`）。
    case "edit.undo":
      if (ui.erasePaintHistory) ui.erasePaintHistory.undo()
      else usePackStore.getState().undo()
      return
    case "edit.redo":
      if (ui.erasePaintHistory) ui.erasePaintHistory.redo()
      else usePackStore.getState().redo()
      return
    case "edit.new-card":
      usePackStore.getState().addCard(false)
      return
    case "edit.delete-card": {
      const { selectedCardId } = usePackStore.getState()
      if (selectedCardId) ui.requestConfirm({ kind: "delete-card", cardId: selectedCardId })
      return
    }
    case "view.left":
      ui.toggleCollapsed("left")
      return
    case "view.right":
      ui.toggleCollapsed("right")
      return
    case "view.checker":
      ui.setShowChecker(!ui.showChecker)
      return
    case "file.export.gif":
      ui.openExportDialog("gif")
      return
    case "file.export.png":
      ui.openExportDialog("png")
      return
    case "file.export.webm":
      ui.openExportDialog("webm")
      return
    default:
      // 未知 id 静默忽略：菜单结构改过之后，残留的旧 id 不该把界面炸掉。
      if (id.startsWith("recent:")) void openRecentFlow(id.slice("recent:".length))
  }
}
