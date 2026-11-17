/**
 * 图层复制 / 粘贴快捷键的判定。
 *
 * 这两个键刻意不做成菜单项：菜单项常驻，而它们只在「选中了图层 / 剪贴板里有东西」时
 * 才有意义（见 `shortcuts.ts` 的调用处）。判定单独拎出来是为了可单测——键位一旦放宽
 * （多认一个 Shift），就会吞掉别的组合键，而在真机上极难注意到。
 */

/** 判定所需的按键字段（`KeyboardEvent` 的结构子集，便于单测构造）。 */
export interface ClipboardKeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * 按键是不是图层复制 / 粘贴快捷键。
 *
 * Ctrl 与 ⌘ 都认：Windows 上自绘标题栏由本应用接管按键，macOS 上原生菜单只管表里
 * 列出的项，这两个键在那边同样落到这里。修饰键按**完全相等**判定，多按 Alt / Shift
 * 就不算命中。
 *
 * @param event - 键盘事件（或其结构子集）。
 * @returns `"copy"` / `"paste"`；不是这两个快捷键时返回 `null`。
 */
export function matchLayerClipboardKey(
  event: ClipboardKeyEventLike,
): "copy" | "paste" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null
  const key = event.key.toLowerCase()
  if (key === "c") return "copy"
  if (key === "v") return "paste"
  return null
}
