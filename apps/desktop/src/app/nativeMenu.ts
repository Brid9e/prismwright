/**
 * 原生菜单的安装与重建（Tauri 适配层）。
 *
 * 结构来自纯函数 `buildMenuModel`（动作表在 `menuActions.ts`），这里只负责把模型翻译成
 * Tauri 的菜单对象，并在**语言 / 视图态 / 最近列表**变化时整体重建（全量替换，不做增量）。
 *
 * 纯浏览器（`dev:web`）里没有 Tauri 环境，菜单 API 的 invoke 会 reject；本模块
 * 静默降级，绝不让菜单问题冒泡白屏（同 `App.tsx` 对 `getCurrentWindow` 的处理）。
 */
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu"
import i18n from "../i18n/init"
import { useRecentStore } from "../store/recentStore"
import { useUiStore } from "../store/uiStore"
import { dispatch } from "./menuActions"
import { buildMenuModel, resolveMenuText, type MenuNode } from "./menuModel"

/** 菜单文案的翻译函数：key 带命名空间前缀（如 `common:menu.save`），直接交给 i18next。 */
const translate = (key: string): string => i18n.t(key)

type TauriItem = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu

/** 把一个模型节点翻译成 Tauri 菜单项。 */
async function toTauriNode(node: MenuNode): Promise<TauriItem> {
  switch (node.kind) {
    case "separator":
      return PredefinedMenuItem.new({ item: "Separator" })
    case "predefined":
      // macOS 的 About 不接受字符串 "About"，必须传 { About: null }（null = 用 tauri.conf 里的元数据）。
      return PredefinedMenuItem.new({
        item: node.predefined === "About" ? { About: null } : "Quit",
        text: resolveMenuText(node.text, translate),
      })
    case "item":
      return MenuItem.new({
        id: node.id,
        text: resolveMenuText(node.text, translate),
        accelerator: node.accelerator,
        enabled: node.enabled ?? true,
        action: () => dispatch(node.id),
      })
    case "check":
      return CheckMenuItem.new({
        id: node.id,
        text: resolveMenuText(node.text, translate),
        accelerator: node.accelerator,
        checked: node.checked,
        action: () => dispatch(node.id),
      })
    case "submenu": {
      const items = await Promise.all(node.items.map(toTauriNode))
      return Submenu.new({ id: node.id, text: resolveMenuText(node.text, translate), items })
    }
  }
}

/** 重建序号：并发重建时只让最新的一次真正安装，避免旧快照后到覆盖新菜单。 */
let buildSeq = 0

/** 按当前 store 快照重建并安装菜单。 */
async function buildAndSet(): Promise<void> {
  const seq = ++buildSeq
  const ui = useUiStore.getState()
  const { recent, missing } = useRecentStore.getState()
  const model = buildMenuModel({
    showLeft: !ui.collapsed.left,
    showRight: !ui.collapsed.right,
    showChecker: ui.showChecker,
    recent,
    missing,
  })
  const items = await Promise.all(model.map(toTauriNode))
  // 期间又触发了新一轮重建：本次快照已过期，丢弃，让最新那次去装。
  if (seq !== buildSeq) return
  const menu = await Menu.new({ items })
  // 换上新菜单后关掉旧的：菜单句柄由 Rust 端持有，不 close 会随每次重建泄漏资源。
  const previous = await menu.setAsAppMenu()
  await previous?.close()
}

/**
 * 安装原生菜单，并订阅视图态 / 最近列表（走 zustand）与语言（走 i18next
 * `languageChanged`）的变化做整体重建。
 *
 * @returns 取消订阅的清理函数；无 Tauri 环境或构建失败时是空操作。
 */
export function installNativeMenu(): () => void {
  const rebuild = () => {
    void buildAndSet().catch(() => {
      // dev:web 无 Tauri，或权限缺失：静默降级，菜单不出现而已，不影响编辑。
    })
  }
  rebuild()

  // 只在折叠态 / 棋盘底真的变化时重建，避免预览缩放等高频状态把菜单打爆。
  const unsubUi = useUiStore.subscribe((s, prev) => {
    if (s.collapsed !== prev.collapsed || s.showChecker !== prev.showChecker) {
      rebuild()
    }
  })
  const unsubRecent = useRecentStore.subscribe((s, prev) => {
    if (s.recent !== prev.recent || s.missing !== prev.missing) rebuild()
  })

  // 语言重建**听 i18next**而非 uiStore 的 language：`setLanguage` 是同步的 zustand
  // `set`，此刻 i18n 还没切换（`App` 的 `[language]` effect 稍后才 `changeLanguage`），
  // 若在这里重建，`resolveMenuText` 用的还是旧语言、菜单文案不跟随。`languageChanged` 在
  // 语言真正切换后触发，才是重建的正确时机。
  const rebuildOnLanguageChanged = () => rebuild()
  i18n.on("languageChanged", rebuildOnLanguageChanged)

  return () => {
    unsubUi()
    unsubRecent()
    i18n.off("languageChanged", rebuildOnLanguageChanged)
  }
}
