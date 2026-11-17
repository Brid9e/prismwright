/**
 * 菜单的**纯结构**模型：原生菜单与自绘标题栏共用同一棵树。
 *
 * 与 Tauri 的菜单对象解耦：这里只产出「有哪些项、什么 id、什么文案、什么快捷键、
 * 勾没勾」，由 `nativeMenu.ts` 翻译成真正的菜单对象。分开是为了可单测——菜单结构
 * 一旦错（漏项、错快捷键、勾选态反了）在真机上极难被注意到。
 *
 * 文案用 {@link MenuText}：绝大多数走 i18n key（含命名空间前缀，如 `common:menu.save`），
 * 少数（最近项 = 系列名）是字面量。
 */
import type { Accelerator } from "./accelerators"
import { collectAccelerators } from "./accelerators"
import type { RecentPack } from "./recentPacks"

/** 文案：要么是 i18n key（带命名空间，如 `common:menu.save`），要么是字面量。 */
export type MenuText = { key: string } | { literal: string }

/**
 * 解析文案：i18n key 走 `t`，字面量原样返回。
 *
 * `t` 由调用方给（原生菜单传 i18next 实例的 `t`，标题栏传 react-i18next 的），
 * 本模块不持有语言状态。
 *
 * @param text - 待解析的文案。
 * @param t - 翻译函数。
 * @returns 展示文本。
 */
export function resolveMenuText(text: MenuText, t: (key: string) => string): string {
  return "key" in text ? t(text.key) : text.literal
}

/**
 * 菜单画在哪个界面上。
 *
 * `native` = 系统菜单（macOS / Linux）；`titlebar` = Windows 自绘标题栏内的菜单条。
 * 两者的差别只有「应用菜单」的去留，见 {@link buildMenuModel}。
 */
export type MenuSurface = "native" | "titlebar"

/** 菜单节点。 */
export type MenuNode =
  /** 分隔线。 */
  | { kind: "separator" }
  /** 普通可点项。 */
  | { kind: "item"; id: string; text: MenuText; accelerator?: string; enabled?: boolean }
  /** 带勾选态的项（视图开关）。 */
  | { kind: "check"; id: string; text: MenuText; accelerator?: string; checked: boolean }
  /** 系统预置项（关于 / 退出），外观与行为交给系统。 */
  | { kind: "predefined"; id: string; predefined: "About" | "Quit"; text: MenuText }
  /** 子菜单。 */
  | { kind: "submenu"; id: string; text: MenuText; items: MenuNode[] }

/** 构建菜单所需的上下文（全部来自 store，构建时快照一次）。 */
export interface MenuContext {
  showLeft: boolean
  showRight: boolean
  showChecker: boolean
  recent: RecentPack[]
  missing: Record<string, true>
}

/** 快捷键统一用 Tauri 的 `CmdOrCtrl` 记法（macOS 上即 ⌘，其它平台为 Ctrl）。 */
export const ACCEL = {
  newPack: "CmdOrCtrl+N",
  openPack: "CmdOrCtrl+O",
  save: "CmdOrCtrl+S",
  closePack: "CmdOrCtrl+W",
  settings: "CmdOrCtrl+,",
  undo: "CmdOrCtrl+Z",
  redo: "Shift+CmdOrCtrl+Z",
  newCard: "CmdOrCtrl+Shift+N",
  showLeft: "CmdOrCtrl+1",
  showRight: "CmdOrCtrl+2",
} as const

/**
 * 「设置」「退出」两项。
 *
 * 提出来是因为它们在不同界面上挂在不同的菜单里：原生菜单挂在「应用」菜单下，
 * 自绘标题栏挂在「文件」末尾（见 {@link toTitlebarModel}）。文案与快捷键只声明一次，
 * 两处引用同一对常量，不会各改一半。
 */
const SETTINGS_ITEM: MenuNode = {
  kind: "item",
  id: "app.settings",
  text: { key: "common:menu.settings" },
  accelerator: ACCEL.settings,
}

const QUIT_ITEM: MenuNode = {
  kind: "predefined",
  id: "app.quit",
  predefined: "Quit",
  text: { key: "common:menu.quit" },
}

/**
 * 由上下文构建整棵菜单结构。
 *
 * @param ctx - 视图勾选态与最近列表。
 * @param surface - 菜单画在哪里；默认 `native`（系统菜单）。
 * @returns 顶层菜单节点数组。
 */
export function buildMenuModel(ctx: MenuContext, surface: MenuSurface = "native"): MenuNode[] {
  const recentItems: MenuNode[] =
    ctx.recent.length === 0
      ? [
          {
            kind: "item",
            id: "file.recent.empty",
            text: { key: "common:menu.recentEmpty" },
            enabled: false,
          },
        ]
      : [
          ...ctx.recent.map<MenuNode>((r) => ({
            kind: "item",
            id: `recent:${r.rootDir}`,
            text: { literal: r.name },
            enabled: ctx.missing[r.rootDir] !== true,
          })),
          { kind: "separator" },
          { kind: "item", id: "file.recent.clear", text: { key: "common:menu.clearRecent" } },
        ]

  const model: MenuNode[] = [
    {
      kind: "submenu",
      id: "app",
      text: { key: "common:app.name" },
      items: [
        {
          kind: "predefined",
          id: "app.about",
          predefined: "About",
          text: { key: "common:menu.about" },
        },
        { kind: "separator" },
        SETTINGS_ITEM,
        { kind: "separator" },
        QUIT_ITEM,
      ],
    },
    {
      kind: "submenu",
      id: "file",
      text: { key: "common:menu.file" },
      items: [
        {
          kind: "item",
          id: "file.new",
          text: { key: "common:menu.newPack" },
          accelerator: ACCEL.newPack,
        },
        {
          kind: "item",
          id: "file.open",
          text: { key: "common:menu.openPack" },
          accelerator: ACCEL.openPack,
        },
        {
          kind: "item",
          id: "file.import",
          text: { key: "common:menu.importBundle" },
        },
        {
          kind: "submenu",
          id: "file.recent",
          text: { key: "common:menu.recent" },
          items: recentItems,
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "file.save",
          text: { key: "common:menu.save" },
          accelerator: ACCEL.save,
        },
        {
          kind: "item",
          id: "file.renamePack",
          text: { key: "common:menu.renamePack" },
        },
        {
          kind: "item",
          id: "file.covers",
          text: { key: "common:menu.covers" },
        },
        {
          kind: "item",
          id: "file.probabilities",
          text: { key: "common:menu.probabilities" },
        },
        {
          kind: "item",
          id: "file.album",
          text: { key: "common:menu.album" },
        },
        { kind: "separator" },
        {
          kind: "submenu",
          id: "file.export",
          text: { key: "common:menu.export" },
          items: [
            { kind: "item", id: "file.export.gif", text: { key: "common:menu.exportGif" } },
            { kind: "item", id: "file.export.png", text: { key: "common:menu.exportPng" } },
            { kind: "item", id: "file.export.webm", text: { key: "common:menu.exportWebm" } },
          ],
        },
        {
          kind: "item",
          id: "file.export.series",
          text: { key: "common:menu.exportSeries" },
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "file.close",
          text: { key: "common:menu.closePack" },
          accelerator: ACCEL.closePack,
        },
      ],
    },
    {
      kind: "submenu",
      id: "edit",
      text: { key: "common:menu.edit" },
      items: [
        {
          kind: "item",
          id: "edit.undo",
          text: { key: "common:menu.undo" },
          accelerator: ACCEL.undo,
        },
        {
          kind: "item",
          id: "edit.redo",
          text: { key: "common:menu.redo" },
          accelerator: ACCEL.redo,
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "edit.new-card",
          text: { key: "common:menu.newCard" },
          accelerator: ACCEL.newCard,
        },
        { kind: "item", id: "edit.delete-card", text: { key: "common:menu.deleteCard" } },
      ],
    },
    {
      kind: "submenu",
      id: "view",
      text: { key: "common:menu.view" },
      items: [
        {
          kind: "check",
          id: "view.left",
          text: { key: "common:menu.showLeft" },
          accelerator: ACCEL.showLeft,
          checked: ctx.showLeft,
        },
        {
          kind: "check",
          id: "view.right",
          text: { key: "common:menu.showRight" },
          accelerator: ACCEL.showRight,
          checked: ctx.showRight,
        },
        { kind: "separator" },
        {
          kind: "check",
          id: "view.checker",
          text: { key: "common:menu.checker" },
          checked: ctx.showChecker,
        },
      ],
    },
  ]

  return surface === "titlebar" ? toTitlebarModel(model) : model
}

/**
 * 换成自绘标题栏的形态。
 *
 * 只差一处：去掉「应用」菜单——那是 macOS 的专属位置（Windows 上没地方放，VSCode 在
 * Windows 上同样没有），把它的「设置」「退出」搬到「文件」末尾。**id 与快捷键全部沿用**，
 * 所以动作表（`menuActions.ts`）只有一份；「关于」只在原生菜单里出现。
 *
 * @param model - 原生形态的菜单树。
 * @returns 标题栏形态的菜单树。
 */
function toTitlebarModel(model: readonly MenuNode[]): MenuNode[] {
  return model
    .filter((node) => !(node.kind === "submenu" && node.id === "app"))
    .map((node) =>
      node.kind === "submenu" && node.id === "file"
        ? {
            ...node,
            items: [
              ...node.items,
              { kind: "separator" },
              SETTINGS_ITEM,
              { kind: "separator" },
              QUIT_ITEM,
            ],
          }
        : node,
    )
}

/**
 * 取快捷键绑定表用的占位上下文。
 *
 * 快捷键是菜单项自己的属性，与勾选态、最近列表无关，一份空上下文就能把表取全。
 */
const PLACEHOLDER_CONTEXT: MenuContext = {
  showLeft: true,
  showRight: true,
  showChecker: false,
  recent: [],
  missing: {},
}

/**
 * 全部快捷键绑定（菜单项 id → 快捷键），直接取自菜单模型本身。
 *
 * 「菜单里显示的」与「按下时接的」因此是同一份数据，不可能漂移。自绘标题栏的平台由
 * `shortcuts.ts` 拿它接键；原生菜单的平台仍由系统处理按键，这张表不参与。
 */
export const MENU_ACCELERATORS: readonly Accelerator[] = collectAccelerators(
  buildMenuModel(PLACEHOLDER_CONTEXT, "titlebar"),
)
