/**
 * 自绘标题栏（Windows 与 macOS）。
 *
 * Windows 上不做这个就没有菜单可用：原生菜单栏是 Win32 的 HMENU，与无边框窗口的自绘
 * 客户区不能共存，所以走 VSCode 那条路——`decorations: false` 去掉系统标题栏。macOS 去掉
 * 的是系统标题栏的**标题文字**（窗口 `titleBarStyle: "Overlay"` + `hiddenTitle`），红黄绿
 * 交通灯仍由系统画在左上角，本组件在左侧留出空位让开它们。平台判定与理由见 `app/platform.ts`。
 *
 * 中间显示「卡片名 — 系列名」（无卡时只显系列名）；无系列时（仅设置视图可达）改显品牌锁形
 * 「logo + Cardbara」（见下方中列渲染，文字拼接见 `titlebarText`）。
 * 整条是拖拽区：外层栅格与**左右两列的留白**都各自带 `data-tauri-drag-region`。Tauri 的拖拽
 * 脚本只认**命中目标自身**有没有该属性（`hasAttribute`，不回溯祖先），故空白处必须自己带——
 * 只挂在外层栅格上时，落在这两列留白里的按下不会启动拖拽（中列的标题能拖，只因它
 * `pointer-events-none`，事件穿透落到了外层栅格上）。按钮这类可点元素不带该属性，故菜单、
 * 布局图标、设置图标、窗口按钮照常能点，空白处按住能拖、双击能最大化。
 *
 * 右侧的布局图标只在**真有系列、且不在设置里**时才画：起始屏与设置视图都没有可显隐的左右栏，
 * 留着只会点出个空动作；设置图标则常驻（起始屏也要能进设置）。
 *
 * 形态见 {@link TitleBarVariant}：起始屏走 `minimal`——整条透明，只剩右上角设置图标。留着
 * 这一条（而不是整块删掉）是必须的：拖拽区与 Windows 的自绘窗口按钮都挂在这里，删了窗口就
 * 既拖不动、又关不掉。
 */
import { useTranslation } from "react-i18next"
import CardbaraLogo from "../../assets/cardbara-logo.svg?react"
import { findCard, usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { hasTauriEnv, type Platform } from "../../app/platform"
import { displayCardName } from "../cards/display"
import { LayoutControls } from "./LayoutControls"
import { MenuBar } from "./MenuBar"
import { SettingsButton } from "./SettingsButton"
import { WindowControls } from "./WindowControls"
import { titlebarText } from "./titleText"

/** 交通灯让位的宽度（CSS 像素）：macOS 三个交通灯加左侧留白的经验宽度。 */
const TRAFFIC_LIGHT_GAP = 76

/**
 * 无系列时标题栏显示的**品牌字标**（与下方的 `CardbaraLogo` 并排成锁形）。
 *
 * 固定为拉丁文、任何语言下都不变，故不进 i18n——要翻译的是应用名（`common:app.name`），
 * 字标不是。改了要一起改的只有 StartScreen 那套锁形，二者是同一套品牌。
 */
const APP_BRAND = "Cardbara"

/** 标题栏形态。`minimal` 专供起始屏：透明的拖拽条上只留设置图标。 */
export type TitleBarVariant = "full" | "minimal"

/** 标题栏：菜单条 / 交通灯让位 +（居中的）标题 + 布局图标 / 设置图标 / 窗口按钮。 */
export function TitleBar({
  platform,
  variant = "full",
}: {
  platform: Platform
  variant?: TitleBarVariant
}) {
  const { t: tCard } = useTranslation("card")
  const { t: tc } = useTranslation("common")
  const pack = usePackStore((s) => s.pack)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const settingsOpen = useUiStore((s) => s.settingsOpen)

  // 起始屏形态：无菜单、无标题、整条透明。此时还没有可命名的系列，菜单里的动作又都能在
  // 起始屏那两个按钮上找到，留着只会跟正中的 logo 抢注意力。
  const minimal = variant === "minimal"

  const card = findCard(pack, selectedCardId)
  // 有系列才拼标题文字；无系列时 `text` 为 null，正中改画品牌锁形（见下方中列）。
  const text = pack
    ? titlebarText({
        cardName: card ? displayCardName(card, tCard) : null,
        packName: pack.name,
      })
    : null

  // 交通灯让位只在「macOS 且真有桌面壳」时给：dev:web 的浏览器里没有交通灯，留空槽反而
  // 突兀。空槽的作用到栅格里变了——不再是「把标题往右推」，而是把左列的最小宽度顶到 76px，
  // 于是标题即便拉得很长也压不到交通灯上（下详）。
  const gap = platform === "macos" && hasTauriEnv()
  // 右侧窗口按钮只在 Windows 且有壳时出现。没有它时布局图标就是最右元素，要给条尾巴的
  // 内边距，免得贴着窗口边框；有窗口按钮时则由它们贴边（系统按钮本就该顶到边）。
  const showWindowControls = platform === "windows" && hasTauriEnv()

  return (
    // 三列栅格，而非 flex：两翼各占 1fr、等宽，夹在正中的标题列便落在**窗口正中**。用 flex 时
    // 标题只在自己那份「剩余空间」里居中，两侧一宽一窄（如 macOS 左侧交通灯空槽 76px、右侧仅
    // 一个设置图标）就整体偏移——这正是之前标题看着不居中的原因。
    //   左右列 `minmax(min-content, 1fr)`：内容不被压扁，同时等分余量；
    //   中列 `minmax(0, max-content)`：封顶在内容宽，超长时可收缩——配合 truncate 让省略号生效。
    // 列取 `items-stretch`（拉伸）而**不是**居中：列若收缩到内容高（十几个像素），列内那些
    // `h-full`（窗口按钮、布局图标、设置图标）便统统解析成那个高度——悬停底色于是上下撑不
    // 满 h-8，只在图标周围糊一小块。纵向居中改由各列自己 `items-center` 负责（三列都写了）。
    <div
      data-tauri-drag-region
      className={`grid h-8 shrink-0 grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)_minmax(min-content,1fr)] items-stretch ${
        minimal ? "" : "border-b border-border bg-panel"
      }`}
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center pl-1">
        {!minimal && platform === "windows" && <MenuBar />}
        {!minimal && gap && (
          <div data-tauri-drag-region className="shrink-0" style={{ width: TRAFFIC_LIGHT_GAP }} />
        )}
      </div>
      {/* 中列。起始屏（minimal）留空占位以维持三列栅格；有系列时显示「卡片名 — 系列名」，
          无系列（仅设置视图可达）时显示品牌锁形。`pointer-events-none` 让按住标题能拖窗；
          `select-none` 再明确禁止标题被选中/复制；`truncate` 让超长标题打省略号。 */}
      {minimal ? (
        // 起始屏中列是块空 div：它自己就是这片空白的命中目标，故必须自带拖拽属性，否则整条
        // 正中那片是死区（正是「初始化页面没法拖」）。有系列时中列 pointer-events-none、事件
        // 穿透落在外层栅格上，反而不需要它。
        <div data-tauri-drag-region />
      ) : (
        <div className="pointer-events-none flex min-w-0 select-none items-center justify-center gap-1.5 px-2 text-center text-[12px] text-muted">
          {text === null ? (
            // 品牌锁形：logo 与字标并排成一行，同 StartScreen 那套（只是横排、更小）。
            // logo 的 aria-label 已报出应用名，字标随之 aria-hidden，免得读屏念两遍。
            //
            // 纵向对齐：容器 `items-center` + 字标 `leading-none` 把 16px 的 logo 与
            // 1em 行框对到同一水平中轴。字标改用系统字体后不再做逐字体的 translateY
            // 微调——系统字体的竖直度量因平台而异，写死的偏移会在别的机器上偏掉。
            // 字标尾部的 `-mr` 抵消 tracking 留在末字之后的空隙，否则整行进位会偏左一点。
            <>
              <CardbaraLogo
                className="h-4 w-auto shrink-0"
                role="img"
                aria-label={tc("app.name")}
              />
              <span
                aria-hidden="true"
                className="-mr-[0.15em] font-display tracking-[0.15em]"
              >
                {APP_BRAND}
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate">{text}</span>
          )}
        </div>
      )}
      {/* 布局图标无系列 / 在设置里时不画（见顶部注释）；设置图标常驻。 */}
      <div
        data-tauri-drag-region
        className={`flex min-w-0 items-center justify-end ${showWindowControls ? "" : "pr-2"}`}
      >
        {!minimal && pack && !settingsOpen && <LayoutControls />}
        <SettingsButton />
        {showWindowControls && <WindowControls />}
      </div>
    </div>
  )
}
