/**
 * 菜单快捷键：摊平、展示文案与命中判定。
 *
 * 快捷键此前**全部由原生菜单承担**（见 `nativeMenu.ts`）——那样只需在建模处写一次
 * `accelerator`，系统负责按键。改用自绘标题栏后系统不再代劳，本模块把菜单模型里声明的
 * 快捷键摊平成一张表，交给 `shortcuts.ts` 在 `keydown` 上匹配，**菜单里显示什么就接什么**，
 * 两边不可能漂移。
 *
 * 只在 Windows 上用（自绘标题栏只在 Windows 上启用），因此 `CmdOrCtrl` 一律按 Ctrl 解释；
 * macOS 的 ⌘ 仍由原生菜单处理。
 */
import type { MenuNode } from "./menuModel"

/** 展示文案里的修饰键顺序，取 Windows 惯例（Ctrl 在前、Shift 在后）。 */
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Win"] as const

/** Tauri 记法里的修饰键 → 展示文案。 */
const MODIFIER_LABEL: Record<string, string> = {
  CmdOrCtrl: "Ctrl",
  CommandOrControl: "Ctrl",
  Ctrl: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
  Cmd: "Win",
  Command: "Win",
  Super: "Win",
  Meta: "Win",
}

/** 一条快捷键绑定：菜单项 id → Tauri 记法的快捷键。 */
export interface Accelerator {
  id: string
  accelerator: string
}

/**
 * 摊平菜单模型，取出所有带快捷键的项（含嵌套子菜单）。
 *
 * 顺序即遍历顺序（父菜单在前、子菜单随后）。没有快捷键的项（最近列表、分隔线、
 * 关于/退出这类系统项）不进表。
 *
 * @param model - 顶层菜单节点。
 * @returns 快捷键绑定表。
 */
export function collectAccelerators(model: readonly MenuNode[]): Accelerator[] {
  const out: Accelerator[] = []
  const walk = (nodes: readonly MenuNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "submenu") walk(node.items)
      else if ((node.kind === "item" || node.kind === "check") && node.accelerator) {
        out.push({ id: node.id, accelerator: node.accelerator })
      }
    }
  }
  walk(model)
  return out
}

/**
 * 把 Tauri 记法的快捷键翻成 Windows 上显示的样子。
 *
 * 修饰键按 {@link MODIFIER_ORDER} 重排：模型里写 `Shift+CmdOrCtrl+Z`（macOS 的习惯顺序），
 * 而 Windows 上该显示 `Ctrl+Shift+Z`。认不出的修饰键原样保留，不至于把没见过的写法吞掉。
 *
 * @param accelerator - 例如 `CmdOrCtrl+Shift+N`。
 * @returns 例如 `Ctrl+Shift+N`。
 */
export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split("+")
  const key = parts[parts.length - 1] ?? ""
  const labels = parts
    .slice(0, -1)
    .map((mod) => MODIFIER_LABEL[mod] ?? mod)
    .sort((a, b) => rank(a) - rank(b))
  return [...labels, key].join("+")
}

/** 修饰键在展示顺序里的排名；未知修饰键排在最后。 */
function rank(label: string): number {
  const index = MODIFIER_ORDER.indexOf(label as (typeof MODIFIER_ORDER)[number])
  return index === -1 ? MODIFIER_ORDER.length : index
}

/** 键盘事件里本模块用到的字段（`KeyboardEvent` 的结构子集，便于单测构造）。 */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * 键盘事件是否命中某条快捷键。
 *
 * 判定为**完全相等**：修饰键多按一个也不算命中（⇧⌘S 不是 ⌘S）。键位大小写不敏感——
 * 按下 Shift 时 `event.key` 会变成大写（`Z` 而非 `z`），而模型里写的是大写，两边都要能对上。
 *
 * @param event - 键盘事件（或其结构子集）。
 * @param accelerator - Tauri 记法的快捷键。
 * @returns 命中时为真。
 */
export function matchesAccelerator(event: KeyEventLike, accelerator: string): boolean {
  const parts = accelerator.split("+")
  const key = parts[parts.length - 1] ?? ""
  const mods = new Set(parts.slice(0, -1).map((mod) => MODIFIER_LABEL[mod] ?? mod))
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    event.ctrlKey === mods.has("Ctrl") &&
    event.shiftKey === mods.has("Shift") &&
    event.altKey === mods.has("Alt") &&
    event.metaKey === mods.has("Win")
  )
}

/**
 * 在绑定表里查键盘事件对应哪一项菜单。
 *
 * @param event - 键盘事件（或其结构子集）。
 * @param accelerators - 绑定表，通常是 {@link MENU_ACCELERATORS}。
 * @returns 命中项的菜单 id；没有命中返回 `undefined`（未带修饰键的 Delete 等不在这张表里，
 * 由 `shortcuts.ts` 另行处理）。
 */
export function findAccelerator(
  event: KeyEventLike,
  accelerators: readonly Accelerator[],
): string | undefined {
  return accelerators.find((a) => matchesAccelerator(event, a.accelerator))?.id
}
