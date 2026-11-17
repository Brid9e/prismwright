/**
 * 右键菜单的纯模型：条目构造、文本控件识别、文本编辑命令。
 *
 * 组件（`ContextMenu.tsx`）只管定位、绘制与键盘导航；「哪个区域弹出哪些项」「点了做什么」
 * 全在这里，于是可以在 node 环境里直接测——本项目的测试配置不收 JSX。
 *
 * 条目文案由调用方传入的 `t` 解析，且统一写**带命名空间的完整 key**（`common:` /
 * `bundle:` / `layer:`）：右键菜单横跨多个区域，若依赖某个默认命名空间，换个调用点就会
 * 静默取到另一份文案。
 */
import { ACCEL } from "../app/menuModel"

/** 取文案的函数（`i18next` 的 `t` 的结构子集）。 */
export type Translate = (key: string) => string

/** 菜单里的一项。分隔符不占回调。 */
export type ContextMenuItem =
  | { kind: "separator" }
  | {
      kind: "item"
      label: string
      /** 右侧显示的快捷键（Tauri 记法，由 UI 层格式化）。 */
      accelerator?: string
      disabled?: boolean
      /** 破坏性动作：悬停时文字转危险色。 */
      danger?: boolean
      onSelect: () => void
    }

/** 一次右键请求：指针位置（视口坐标）+ 要显示的条目。 */
export interface ContextMenuRequest {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** 分隔符复用同一个冻结对象即可——它不含状态。 */
const SEPARATOR: ContextMenuItem = { kind: "separator" }

function item(
  label: string,
  onSelect: () => void,
  extra?: { accelerator?: string; danger?: boolean; disabled?: boolean },
): ContextMenuItem {
  return { kind: "item", label, onSelect, ...extra }
}

/** 编辑器空白处（画布 / 面板背景）的菜单。 */
export function editorContextItems(params: {
  t: Translate
  newCard: () => void
  undo: () => void
  redo: () => void
  exportSeries: () => void
}): ContextMenuItem[] {
  return [
    item(params.t("common:menu.newCard"), params.newCard, { accelerator: ACCEL.newCard }),
    SEPARATOR,
    item(params.t("common:menu.undo"), params.undo, { accelerator: ACCEL.undo }),
    item(params.t("common:menu.redo"), params.redo, { accelerator: ACCEL.redo }),
    SEPARATOR,
    item(params.t("common:menu.exportSeries"), params.exportSeries),
  ]
}

/** 卡片树的单行菜单。 */
export function cardContextItems(params: {
  cardId: string
  t: Translate
  exportCard: (cardId: string) => void
  duplicateCard: (cardId: string) => void
  deleteCard: (cardId: string) => void
}): ContextMenuItem[] {
  return [
    item(params.t("bundle:export.titleCard"), () => params.exportCard(params.cardId)),
    SEPARATOR,
    item(params.t("common:action.duplicate"), () => params.duplicateCard(params.cardId)),
    item(params.t("common:menu.deleteCard"), () => params.deleteCard(params.cardId), {
      danger: true,
    }),
  ]
}

/** 图层树的单行菜单。启用 / 禁用仍走行尾的眼睛按钮，这里只放成对出现的复制与删除。 */
export function layerContextItems(params: {
  layerId: string
  t: Translate
  duplicateLayer: (layerId: string) => void
  deleteLayer: (layerId: string) => void
}): ContextMenuItem[] {
  return [
    item(params.t("layer:action.duplicate"), () => params.duplicateLayer(params.layerId)),
    item(params.t("layer:action.delete"), () => params.deleteLayer(params.layerId), {
      danger: true,
    }),
  ]
}

/** 文本编辑命令。 */
export type TextCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"

/** 文本输入框里的菜单：系统默认菜单被我们拦掉之后，这些命令要补回来。 */
export function textContextItems(params: {
  t: Translate
  run: (command: TextCommand) => void
}): ContextMenuItem[] {
  return [
    item(params.t("common:menu.undo"), () => params.run("undo"), { accelerator: ACCEL.undo }),
    item(params.t("common:menu.redo"), () => params.run("redo"), { accelerator: ACCEL.redo }),
    SEPARATOR,
    item(params.t("common:context.cut"), () => params.run("cut"), {
      accelerator: "CmdOrCtrl+X",
    }),
    item(params.t("common:context.copy"), () => params.run("copy"), {
      accelerator: "CmdOrCtrl+C",
    }),
    item(params.t("common:context.paste"), () => params.run("paste"), {
      accelerator: "CmdOrCtrl+V",
    }),
    SEPARATOR,
    item(params.t("common:context.selectAll"), () => params.run("selectAll"), {
      accelerator: "CmdOrCtrl+A",
    }),
  ]
}

/** 可编辑文本的输入类型；其余（checkbox / range / date…）没有文本编辑语义。 */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number"])

/**
 * 判断事件目标是「可编辑文本」。
 *
 * 用结构化判断而不是 `instanceof HTMLElement`：本项目的单测跑在 node 环境，没有 DOM
 * 构造器，结构化写法让这条规则能被直接测到。
 */
export function isTextEntry(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown }
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : ""
  if (tag === "TEXTAREA") return true
  if (tag === "INPUT") {
    const type = typeof el.type === "string" ? el.type.toLowerCase() : "text"
    return TEXT_INPUT_TYPES.has(type)
  }
  return el.isContentEditable === true
}

/**
 * 对当前文本控件执行一条编辑命令。
 *
 * 先 `focus()`：菜单项一按下，焦点就到了菜单上，不还回去的话命令作用不到原来那个输入框。
 * 选中区域在失焦后仍保留，所以剪切 / 复制不用自己记 selection。
 *
 * @param doc - 便于测试注入（node 环境没有 `document`）。
 */
export function runTextCommand(
  command: TextCommand,
  el: HTMLElement,
  doc: Pick<Document, "execCommand"> = document,
): Promise<void> {
  const target = el as HTMLElement & { select?: () => void }
  target.focus()
  if (command === "selectAll") {
    // input / textarea 自己知道怎么全选；contenteditable 交给命令。
    if (typeof target.select === "function") target.select()
    else doc.execCommand("selectAll")
    return Promise.resolve()
  }
  if (command === "paste") return pasteInto(doc)
  doc.execCommand(command)
  return Promise.resolve()
}

/**
 * 粘贴：先试 `execCommand("paste")`，浏览器拒绝时退回读剪贴板。
 *
 * Chromium 系内核（含 WebView2）默认不支持用 `execCommand` 粘贴，所以要这条退路；
 * 读剪贴板再被系统拒绝时静默放弃，用户仍可按 Ctrl+V。
 */
async function pasteInto(doc: Pick<Document, "execCommand">): Promise<void> {
  if (doc.execCommand("paste")) return
  try {
    const text = await navigator.clipboard.readText()
    if (text) doc.execCommand("insertText", false, text)
  } catch {
    // 系统不允许读剪贴板：保持原内容。
  }
}
