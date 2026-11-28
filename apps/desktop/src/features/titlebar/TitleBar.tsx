/**
 * 顶部工具条（也是 Windows 的自绘标题栏）。
 *
 * Windows 上不做这个就没有菜单可用：原生菜单栏是 Win32 的 HMENU，与无边框窗口的自绘
 * 客户区不能共存，所以走 VSCode 那条路——`decorations: false` 去掉系统标题栏。macOS 去掉
 * 的是系统标题栏的**标题文字**（窗口 `titleBarStyle: "Overlay"` + `hiddenTitle`），红黄绿
 * 交通灯仍由系统画在左上角，本组件在左侧留出空位让开它们。平台判定与理由见 `app/platform.ts`。
 *
 * 形态（见设计文档 §7.1）：一块 46 高、panel 圆角的浮层面板，浮在窗口底色上。
 *   左：品牌锁形 + 菜单（仅 Windows）
 *   中：卡片名 — 系列名（无系列时留空）
 *   右：撤销 / 重做 · 保存状态 · 布局 · 导出 · 设置 · 窗口控件
 *
 * 整条是拖拽区：外层栅格与**左右两列的留白**都各自带 `data-tauri-drag-region`。Tauri 的拖拽
 * 脚本只认**命中目标自身**有没有该属性（`hasAttribute`，不回溯祖先），故空白处必须自己带——
 * 只挂在外层栅格上时，落在这两列留白里的按下不会启动拖拽。按钮这类可点元素不带该属性，
 * 故菜单、撤销、布局、设置、窗口按钮照常能点，空白处按住能拖、双击能最大化。
 *
 * 右侧那一组只在**真有系列、且不在设置里**时才画：起始屏与设置视图都没有可撤销的编辑、
 * 也没有可切换的布局。设置图标则常驻（起始屏也要能进设置）。窗口按钮仅 Windows + 有壳。
 *
 * 形态见 {@link TitleBarVariant}：起始屏走 `minimal`——整条透明，只剩右上角设置图标。留着
 * 这一条（而不是整块删掉）是必须的：拖拽区与 Windows 的自绘窗口按钮都挂在这里，删了窗口就
 * 既拖不动、又关不掉。
 */
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Redo2, Undo2 } from "lucide-react"
import PrismwrightLogoSmall from "../../assets/prismwright-logo-small.svg?react"
import { findCard, usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { dispatch } from "../../app/menuActions"
import { hasTauriEnv, type Platform } from "../../app/platform"
import { Button } from "../../ui/Button"
import { IconButton } from "../../ui/IconButton"
import { displayCardName } from "../cards/display"
import { LayoutControls } from "./LayoutControls"
import { MenuBar } from "./MenuBar"
import { SettingsButton } from "./SettingsButton"
import { WindowControls } from "./WindowControls"
import { titlebarText } from "./titleText"

/** 交通灯让位的宽度（CSS 像素）：macOS 三个交通灯加左侧留白的经验宽度（相对窗口左缘）。 */
const TRAFFIC_LIGHT_GAP = 76

/**
 * 无系列时标题栏显示的**品牌字标**（与 `PrismwrightLogoSmall` 并排成锁形）。
 *
 * 固定为拉丁文、任何语言下都不变，故不进 i18n——要翻译的是应用名（`common:app.name`），
 * 字标不是。
 */
const APP_BRAND = "Prismwright"

/** 标题栏形态。`minimal` 专供起始屏：透明的拖拽条上只留设置图标。 */
export type TitleBarVariant = "full" | "minimal"

/**
 * 保存状态指示：一个 6px 圆点 + 短文案。
 *
 * 保存失败时变成可点按钮，展开里层浮层显示错误摘要与重试——这是旧状态栏唯一的不可替代
 * 职责，去掉底部状态栏后必须由顶栏接住。
 */
function SaveIndicator() {
  const { t } = useTranslation("editor")
  const status = usePackStore((s) => s.saveStatus)
  const lastError = usePackStore((s) => s.lastError)
  const save = usePackStore((s) => s.save)
  const [open, setOpen] = useState(false)

  const dot =
    status === "saved"
      ? "bg-success"
      : status === "saving"
        ? "bg-warning"
        : status === "error"
          ? "bg-danger"
          : "bg-disabled"

  if (status === "error") {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-7 items-center gap-1.5 rounded-control px-2 text-label text-danger outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
          {t("status.error")}
        </button>
        {open && (
          <div className="popover-shadow absolute right-0 top-full z-50 mt-2 w-64 rounded-card border border-line-soft bg-panel p-3 text-label">
            <p className="break-words text-danger">{lastError}</p>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void save()
              }}
              className="mt-2 flex h-control items-center rounded-control border border-line-soft px-2 text-foreground hover:bg-elevated"
            >
              {t("common:action.retry")}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <span
      className="flex h-7 items-center gap-1.5 px-2 text-label text-muted"
      role="status"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {t(`status.${status}`)}
    </span>
  )
}

/** 顶栏：品牌 / 菜单 · 标题 · 编辑与视图动作 · 设置 / 窗口按钮。 */
export function TitleBar({
  platform,
  variant = "full",
}: {
  platform: Platform
  variant?: TitleBarVariant
}) {
  const { t: tCard } = useTranslation("card")
  const { t: tc } = useTranslation("common")
  const { t: te } = useTranslation("editor")
  const pack = usePackStore((s) => s.pack)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const canUndo = usePackStore((s) => s.past.length > 0)
  const canRedo = usePackStore((s) => s.future.length > 0)
  const settingsOpen = useUiStore((s) => s.settingsOpen)

  // 起始屏形态：无菜单、无标题、整条透明。此时还没有可命名的系列，菜单里的动作又都能在
  // 起始屏那两个按钮上找到，留着只会跟正中的 logo 抢注意力。
  const minimal = variant === "minimal"

  const card = findCard(pack, selectedCardId)
  // 有系列才拼标题文字；无系列时中间留空。
  const text = pack
    ? titlebarText({
        cardName: card ? displayCardName(card, tCard) : null,
        packName: pack.name,
      })
    : null

  // 交通灯让位只在「macOS 且真有桌面壳」时给：dev:web 的浏览器里没有交通灯，留空槽反而
  // 突兀。空槽把左列内容整体右推，保证标题与品牌都压不到交通灯上。
  const gap = platform === "macos" && hasTauriEnv()
  // 右侧窗口按钮只在 Windows 且有壳时出现。没有它时布局图标就是最右元素，要给条尾巴的
  // 内边距，免得贴着窗口边框；有窗口按钮时则由它们贴边（系统按钮本就该顶到边）。
  const showWindowControls = platform === "windows" && hasTauriEnv()

  return (
    // 三列栅格：两翼各占 1fr、等宽，夹在正中的标题列便落在**窗口正中**。用 flex 时标题只在
    // 自己那份「剩余空间」里居中，两侧一宽一窄就整体偏移。
    // 列取 `items-stretch`（拉伸）而**不是**居中：列若收缩到内容高，列内那些 `h-full`
    // （窗口按钮）便统统解析成那个高度——悬停底色于是上下撑不满。纵向居中由各列自己负责。
    //
    // 整条与窗口上/左/右三边齐平：不铺背景、不留圆角与外边距，只保留内容中的 px-2。
    <div
      data-tauri-drag-region
      className={`grid h-topbar shrink-0 grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)_minmax(min-content,1fr)] items-stretch ${
        // 窗口按钮是原生控件，应贴住窗口右缘；没有它们时给一点收尾内边距。
        showWindowControls ? "pl-2 pr-0" : "px-2"
      }`}
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2 pl-1">
        {!minimal && (
          <>
            {/* 交通灯让位放在左列内部而不是整条栅格上：加在栅格上会把中列标题整体右推。 */}
            {gap && <div data-tauri-drag-region className="shrink-0" style={{ width: TRAFFIC_LIGHT_GAP }} />}
            {/* 品牌锁形：logo + 拉丁字标。logo 的 aria-label 已报出应用名，字标随 aria-hidden，
                免得读屏念两遍。字标尾部的负 margin 抵消 tracking 留在末字之后的空隙。 */}
            <PrismwrightLogoSmall
              className="h-4 w-auto shrink-0"
              role="img"
              aria-label={tc("app.name")}
            />
            <span
              aria-hidden="true"
              className="-mr-[0.12em] shrink-0 font-display text-title tracking-[0.12em] text-foreground"
            >
              {APP_BRAND}
            </span>
            {platform === "windows" && <MenuBar />}
          </>
        )}
      </div>
      {/* 中列。起始屏（minimal）留空占位以维持三列栅格；有系列时显示「卡片名 — 系列名」。
          `pointer-events-none` 让按住标题能拖窗；`select-none` 明确禁止标题被选中/复制。 */}
      {minimal ? (
        // 起始屏中列是块空 div：它自己就是这片空白的命中目标，故必须自带拖拽属性，否则整条
        // 正中那片是死区。有系列时中列 pointer-events-none、事件穿透落在外层栅格上。
        <div data-tauri-drag-region />
      ) : (
        <div className="pointer-events-none flex min-w-0 select-none items-center justify-center gap-1.5 px-2 text-center text-body text-muted">
          {text !== null && <span className="min-w-0 truncate">{text}</span>}
        </div>
      )}
      {/* 右侧动作组。设置图标常驻；编辑动作只在有系列、且不在设置里时出现。 */}
      <div
        data-tauri-drag-region
        className={`flex min-w-0 items-center justify-end gap-0.5 ${showWindowControls ? "" : "pr-2"}`}
      >
        {!minimal && pack && !settingsOpen && (
          <>
            <IconButton
              icon={Undo2}
              label={tc("menu.undo")}
              onClick={() => dispatch("edit.undo")}
              disabled={!canUndo}
            />
            <IconButton
              icon={Redo2}
              label={tc("menu.redo")}
              onClick={() => dispatch("edit.redo")}
              disabled={!canRedo}
            />
            <SaveIndicator />
            <LayoutControls />
            <Button
              variant="primary"
              className="ml-1"
              onClick={() => dispatch("file.export.series")}
            >
              {te("topbar.export")}
            </Button>
          </>
        )}
        <SettingsButton />
        {showWindowControls && <WindowControls />}
      </div>
    </div>
  )
}
