/**
 * 图层复制 / 粘贴快捷键的判定。
 *
 * 键位本身没有菜单项（见 `shortcuts.ts` 的说明），因此这里是它唯一的测试入口：
 * 多按一个修饰键就不能算命中，否则 Ctrl+Shift+V 之类会被意外吞掉。
 */
import { describe, it, expect } from "vitest"
import { matchLayerClipboardKey } from "../clipboardKeys"

function key(
  value: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {},
) {
  return {
    key: value,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  }
}

describe("matchLayerClipboardKey", () => {
  it("Ctrl+C / Ctrl+V 分别命中复制与粘贴", () => {
    expect(matchLayerClipboardKey(key("c", { ctrl: true }))).toBe("copy")
    expect(matchLayerClipboardKey(key("v", { ctrl: true }))).toBe("paste")
  })

  it("macOS 的 ⌘ 同样可用（原生菜单不管这两个键）", () => {
    expect(matchLayerClipboardKey(key("c", { meta: true }))).toBe("copy")
    expect(matchLayerClipboardKey(key("v", { meta: true }))).toBe("paste")
  })

  it("多按 Alt / Shift 不算命中，免得吞掉别的组合键", () => {
    expect(matchLayerClipboardKey(key("c", { ctrl: true, shift: true }))).toBeNull()
    expect(matchLayerClipboardKey(key("v", { ctrl: true, alt: true }))).toBeNull()
  })

  it("不带修饰键的 c / v 不是快捷键", () => {
    expect(matchLayerClipboardKey(key("c"))).toBeNull()
    expect(matchLayerClipboardKey(key("v"))).toBeNull()
  })

  it("别的键不命中", () => {
    expect(matchLayerClipboardKey(key("x", { ctrl: true }))).toBeNull()
    expect(matchLayerClipboardKey(key("Enter", { ctrl: true }))).toBeNull()
  })
})
