/**
 * 应用外壳：设置视图 ⇄ 启动屏 ⇄ 编辑器 + 状态栏。
 *
 * 正文由两个状态决定：`uiStore.settingsOpen` 为真时整块让位给 `SettingsView`（优先于其余
 * 两者，于是从起始页也能进设置）；否则看 `packStore.pack` 是否为空——没有系列时整窗是
 * `StartScreen`，有系列时是三栏编辑器。标题栏与菜单的形态由平台决定（见 `platform.ts`）：
 * Windows 与 macOS 用自绘 `TitleBar`（Windows 无边框窗口，原生菜单栏与它不能共存），但 macOS
 * 的菜单仍留在屏幕顶部原生菜单栏，只有 Windows 改由 `shortcuts.ts` 接快捷键。
 */
import { useEffect, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { getCurrentWindow } from "@tauri-apps/api/window"
import i18n from "../i18n/init"
import { useDefaultBackStore } from "../store/defaultBackStore"
import { usePackStore } from "../store/packStore"
import { useRecentStore } from "../store/recentStore"
import { useUiStore } from "../store/uiStore"
import { attachAutosave, type AutosaveHandle } from "../store/autosave"
import { ContextMenuHost } from "../ui/ContextMenu"
import { editorContextItems, isTextEntry } from "../ui/contextMenuModel"
import { Splitter } from "../ui/Splitter"
import { TooltipProvider } from "../ui/Tooltip"
import { CloseProgressDialog } from "../features/preview-assets/CloseProgressDialog"
import {
  attachPreviewAssets,
  type PreviewAssetsHandle,
  type PreviewProgress,
} from "../features/preview-assets/pipeline"
import { PreviewPanel } from "../features/preview/PreviewPanel"
import { HierarchyPanel } from "../features/cards/HierarchyPanel"
import { InspectorPanel } from "../features/cards/InspectorPanel"
import { SettingsView } from "../features/settings/SettingsView"
import { NewPackDialog } from "../features/pack/NewPackDialog"
import { AlbumDialog } from "../features/pack/AlbumDialog"
import { ProbabilityDialog } from "../features/pack/ProbabilityDialog"
import { RenamePackDialog } from "../features/pack/RenamePackDialog"
import { ExportDialog } from "../features/export/ExportDialog"
import { BundleExportDialog } from "../features/bundle/BundleExportDialog"
import { BundleImportDialog } from "../features/bundle/BundleImportDialog"
import { StartScreen } from "../features/start/StartScreen"
import { TitleBar } from "../features/titlebar/TitleBar"
import { isDefaultBackPack } from "../features/default-back/default-back"
import { leaveDefaultBackFlow } from "./defaultBack"
import { saveLanguage } from "./language"
import { saveEditorVersion } from "./editorVersion"
import { dispatch } from "./menuActions"
import { installNativeMenu } from "./nativeMenu"
import { detectPlatform, usesHtmlTitleBar, usesNativeMenu } from "./platform"
import { useShortcuts } from "./shortcuts"

/** 底部状态栏：保存状态，失败时附错误摘要与重试。 */
function StatusBar() {
  const { t } = useTranslation("editor")
  const saveStatus = usePackStore((s) => s.saveStatus)
  const lastError = usePackStore((s) => s.lastError)
  const save = usePackStore((s) => s.save)

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-panel px-2 text-[11px] text-muted">
      <span className={saveStatus === "error" ? "text-danger" : ""}>
        {t(`status.${saveStatus}`)}
      </span>
      {saveStatus === "error" && (
        <>
          <span className="min-w-0 flex-1 truncate text-danger" title={lastError ?? ""}>
            {lastError}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            className="shrink-0 rounded-sm border border-border-subtle px-1.5 hover:text-foreground"
          >
            {t("common:action.retry")}
          </button>
        </>
      )}
    </div>
  )
}

export default function App() {
  const { t } = useTranslation("common")
  const openContextMenu = useUiStore((s) => s.openContextMenu)
  const collapse = useUiStore((s) => s.collapsed)
  const language = useUiStore((s) => s.language)
  const editorVersion = useUiStore((s) => s.editorVersion)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const pack = usePackStore((s) => s.pack)
  const packRootDir = usePackStore((s) => s.rootDir)
  const defaultBackRoot = useDefaultBackStore((s) => s.rootDir)
  // 当前打开的就是默认卡背工程：编辑器里要挂一条提示条，否则用户会以为自己开错了系列。
  const editingDefaultBack = isDefaultBackPack(packRootDir, defaultBackRoot)
  const [autosave, setAutosave] = useState<AutosaveHandle | null>(null)
  const [previews, setPreviews] = useState<PreviewAssetsHandle | null>(null)
  // 非 `null` 即表示正在等预览生成完再关窗；其值即进度快照，驱动关闭进度弹窗。
  const [closeProgress, setCloseProgress] = useState<PreviewProgress | null>(null)

  // `navigator.userAgent` 终身不变，每次渲染重算也得同一个值——故把它当 effect 依赖是恒定的，
  // 菜单那条 effect 不会因它重复安装。（不上 `useState` 惰性初始化：一个不会变的值不值得多存一份状态。）
  const platform = detectPlatform(navigator.userAgent)

  // 效果内挂载并在卸载时 detach：若在模块顶层只调用不回收，HMR 每次热更新都会
  // 叠加一个新的 zustand 订阅者，导致一次 commit 落盘 N 次。
  useEffect(() => {
    const handle = attachAutosave(500)
    setAutosave(handle)
    return handle.detach
  }, [])

  // 预览资产流水线：编辑落盘后（saveStatus 到 saved）为变更过的卡后台生成透明 PNG / WebM。
  // 与 autosave 同理，挂载时 attach、卸载时 detach——否则 HMR 每次都叠一层订阅。
  useEffect(() => {
    const handle = attachPreviewAssets()
    setPreviews(handle)
    return handle.detach
  }, [])

  // 语言变化 → 切换 i18next 并落盘。放在这里而不是 `setLanguage` 里：
  // store 不该知道 i18next 或 Tauri 存储的存在。
  useEffect(() => {
    void i18n.changeLanguage(language)
    void saveLanguage(language)
  }, [language])

  // 编辑器版本变化 → 落盘。与语言同理：store 不碰 Tauri 存储。
  useEffect(() => {
    void saveEditorVersion(editorVersion)
  }, [editorVersion])

  // 最近列表：启动读入，随后由 RecentList / 菜单各自触发探测。
  useEffect(() => {
    void useRecentStore.getState().load()
  }, [])

  // 卡册排版依赖 HTML5 拖放，而 Windows 上 Tauri 默认会用自己的 WebView2 拖放处理器
  // 把它接管掉（见 tauri.conf.json 的 dragDropEnabled）。关掉之后 WebView2 恢复原生处理，
  // 代价是「把文件拖进窗口」会被当成导航：没人 preventDefault 就会离开编辑器。这里统一
  // 吞掉默认行为——页面内部的 drop 处理器（卡册对话框）在事件冒泡到 window 之前已经执行，
  // 不受影响。
  useEffect(() => {
    const preventDefault = (event: DragEvent) => event.preventDefault()
    window.addEventListener("dragover", preventDefault)
    window.addEventListener("drop", preventDefault)
    return () => {
      window.removeEventListener("dragover", preventDefault)
      window.removeEventListener("drop", preventDefault)
    }
  }, [])

  // 默认卡背：启动读入一份快照，之后跟随编辑实时同步——没有卡背的系列在预览里要立刻
  // 看到刚改的卡背。订阅在卸载时退订，理由同 autosave（HMR 会叠订阅）。
  useEffect(() => {
    void useDefaultBackStore.getState().load()
    return usePackStore.subscribe((state, prev) => {
      if (state.pack === prev.pack) return
      useDefaultBackStore.getState().observe(state.rootDir, state.pack?.back ?? null)
    })
  }, [])

  // 原生菜单：安装并按语言 / 视图态 / 最近列表重建。
  // macOS 仍装原生菜单（菜单栏在屏幕顶部），只有 Windows 不装——它把菜单画进了自绘
  // 标题栏（见下方 <TitleBar />），无边框窗口里原生菜单没有显示位置，留着只会占掉系统
  // 菜单位。Windows 的快捷键随之改由 `shortcuts.ts` 接（`nativeMenu.ts` 顶部注释说明了这件事）。
  useEffect(() => {
    if (!usesNativeMenu(platform)) return
    return installNativeMenu()
  }, [platform])

  // 窗口标题跟随系列名；纯浏览器下无 Tauri，静默降级为固定标题。
  useEffect(() => {
    // `getCurrentWindow()` 读 `window.__TAURI_INTERNALS__`，无 Tauri 环境会**同步**抛错，
    // 故必须 try/catch 包住整句，不能只 `.catch()` 它返回的 Promise（同步抛错时拿不到 Promise）。
    try {
      void getCurrentWindow()
        .setTitle(pack?.name ?? "Prismwright")
        .catch(() => {})
    } catch {
      // dev:web：无 Tauri，标题保持默认，不影响编辑。
    }
  }, [pack?.name])

  // 关闭窗口前先冲刷未落盘的编辑，再等预览资产生成跑空。
  //
  // `attachAutosave(500)` 把落盘排在 500ms 防抖窗口之后（见 store/autosave.ts 的
  // `detach`：它只清计时器、不冲刷）。若用户改完立刻关窗，那次改动会随进程退出
  // 而静默丢失——这是产品里唯一能让已落盘编辑消失的路径。故在关闭请求到达时
  // 先 flush 再放行。
  //
  // 落盘成功又会触发预览流水线（见 features/preview-assets/pipeline.ts）：为变更过的卡生成
  // 透明 PNG / WebM。若此时队列未跑空就放行进程，产物会被写到一半。故第三步在流水线忙碌时
  // **拦下关闭**、弹进度框、等 `idle()` 兑现后再关（用户可以「强制关闭」中途脱身）。
  //
  // 用 `destroy()` 而非 `close()`：`close()` 会再次发出 close-requested 事件，
  // 让本处理器重新进入自身，窗口永远关不掉；`destroy()` 强制关闭且不再发事件。
  //
  // flush 再套 ~2s 硬上限并置于 `finally` 之外兜底：卡住的写入绝不能让用户面对
  // 一个无法关闭的窗口——丢一次编辑可恢复，关不掉的窗口不可恢复，故无论如何都
  // 在 finally 里 destroy。
  useEffect(() => {
    if (!autosave || !previews) return
    let unlisten: (() => void) | null = null
    // effect 已清理的标记：`onCloseRequested` 返回的 Promise 异步兑现，兑现时
    // effect 可能已被卸载（HMR / 组件卸载），此时不能再把监听器留下。
    let disposed = false

    /** 兜底硬上限：卡住的写盘绝不能让窗口关不掉（见上方说明）。 */
    const cap = <T,>(p: Promise<T>): Promise<T | void> =>
      Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, 2000))])

    const setup = async () => {
      try {
        const stop = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault()
          try {
            // 1) 冲刷防抖窗口内待落盘的编辑。
            await cap(autosave.flush())

            // 2) 若有正在写 / 待写的保存，等它完成：既保住编辑，也借此让 saveStatus 落到
            //    `saved`、从而触发预览流水线（flush 对「已在进行中的写盘」不等待）。
            const { saveStatus, save } = usePackStore.getState()
            if (saveStatus === "saving" || saveStatus === "dirty") await cap(save())

            // 3) 预览未生成完：展示进度、等队列跑空再真正关闭。
            if (previews.isBusy()) {
              setCloseProgress(previews.getProgress())
              const unsubscribe = previews.subscribe(setCloseProgress)
              try {
                await previews.idle()
              } finally {
                unsubscribe()
              }
            }
          } catch {
            // flush / save 失败本已由 store 的 saveStatus 状态机记录；这里再吞一层，
            // 避免处理器返回的 rejected promise 变成未处理的 rejection。
          } finally {
            void getCurrentWindow().destroy()
          }
        })
        if (disposed) stop()
        else unlisten = stop
      } catch {
        // 静默降级：`dev:web` 在纯浏览器里跑，缺少 `__TAURI_INTERNALS__`，
        // `getCurrentWindow()` 会同步抛错。此处吞掉异常，绝不让它冒泡白屏该服务；
        // 同时一并吞掉 `onCloseRequested` 的拒绝，避免未处理的 Promise rejection。
      }
    }

    void setup()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [autosave, previews])

  useShortcuts()

  /**
   * 立即关窗，不再等待未完成的预览生成（关闭进度弹窗上的「强制关闭」）。
   *
   * 与关闭处理器同用 `destroy()`：`close()` 会再次触发 close-requested、被处理器重新拦下。
   * `getCurrentWindow()` 在纯浏览器（`dev:web`）下同步抛错，故包一层 try 保持降级可用。
   */
  function forceClose(): void {
    try {
      void getCurrentWindow().destroy()
    } catch {
      // dev:web：无原生窗口可关，忽略。
    }
  }

  /**
   * 编辑器空白处的右键菜单（画布、面板背景、状态栏）。
   *
   * 卡片行 / 图层行会 `stopPropagation`，轮不到这里；文本控件交给全局宿主上的编辑菜单
   * （见 `ui/ContextMenu.tsx`），故这里直接放行。
   *
   * 动作一律走 `dispatch`：右键菜单与标题栏菜单、快捷键共用同一张动作表，三处不会各做
   * 一套。`edit.undo` / `edit.redo` 在绘画会话中会被 `dispatch` 路由到画布历史，这也是
   * 复用而不是直连 `packStore` 的原因。
   */
  function handleEditorContextMenu(event: MouseEvent<HTMLDivElement>): void {
    if (isTextEntry(event.target)) return
    event.preventDefault()
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: editorContextItems({
        t,
        newCard: () => dispatch("edit.new-card"),
        undo: () => dispatch("edit.undo"),
        redo: () => dispatch("edit.redo"),
        exportSeries: () => dispatch("file.export.series"),
      }),
    })
  }

  // 起始屏（无系列、也不在设置里）：标题栏退化为透明的拖拽条，只留右上角设置图标
  // （见 TitleBar 的 variant）。此刻菜单与标题栏标题都没有意义。
  const startPage = !pack && !settingsOpen

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-app text-foreground">
        {usesHtmlTitleBar(platform) && (
          <TitleBar platform={platform} variant={startPage ? "minimal" : "full"} />
        )}
        {settingsOpen ? (
          <SettingsView />
        ) : pack ? (
          // 右键菜单只覆盖编辑器本体：起始屏 / 设置 / 对话框里不弹（文本控件除外，那由
          // 全局宿主接管）。所以监听挂在这一层而不是最外层。
          <div className="flex min-h-0 flex-1 flex-col" onContextMenu={handleEditorContextMenu}>
            {editingDefaultBack && (
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-accent/10 px-3 text-[12px] text-foreground">
                <span className="min-w-0 flex-1 truncate">{t("defaultBack.banner")}</span>
                <button
                  type="button"
                  onClick={() => void leaveDefaultBackFlow()}
                  className="shrink-0 rounded-sm border border-border-subtle px-2 py-0.5 hover:bg-elevated"
                >
                  {t("defaultBack.done")}
                </button>
              </div>
            )}
            <Splitter
              leftCollapsed={collapse.left}
              rightCollapsed={collapse.right}
              left={<HierarchyPanel />}
              center={<PreviewPanel />}
              right={<InspectorPanel />}
            />
            <StatusBar />
          </div>
        ) : (
          <StartScreen />
        )}
      </div>
      <NewPackDialog />
      <AlbumDialog />
      <RenamePackDialog />
      <ProbabilityDialog />
      <ExportDialog previews={previews} />
      <BundleExportDialog />
      <BundleImportDialog />
      <CloseProgressDialog
        open={closeProgress !== null}
        progress={closeProgress}
        onForceClose={forceClose}
      />
      <ContextMenuHost />
    </TooltipProvider>
  )
}
