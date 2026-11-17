/**
 * 菜单快捷键的摊平、展示与命中判定。
 *
 * 这些键原先由原生菜单承担，改成自绘标题栏后必须由 JS 接——接错了（多接一个修饰键、
 * 大小写不敏感、漏掉嵌套子菜单里的项）在真机上只表现为「按了没反应」或「偶尔误触」，
 * 极难归因，故逐条钉死。
 */
import { describe, it, expect } from "vitest"
import { collectAccelerators, findAccelerator, formatAccelerator, matchesAccelerator } from "../accelerators"
import { MENU_ACCELERATORS } from "../menuModel"
import type { MenuNode } from "../menuModel"

/** 与真实模型同形的小树：含嵌套子菜单、无快捷键项、分隔线、勾选项。 */
const model: MenuNode[] = [
  {
    kind: "submenu",
    id: "file",
    text: { key: "common:menu.file" },
    items: [
      { kind: "item", id: "file.new", text: { key: "common:menu.newPack" }, accelerator: "CmdOrCtrl+N" },
      { kind: "separator" },
      {
        kind: "submenu",
        id: "file.recent",
        text: { key: "common:menu.recent" },
        items: [
          // 最近列表项是系列名，没有快捷键。
          { kind: "item", id: "recent:C:\\p", text: { literal: "星辰之约" } },
        ],
      },
      {
        kind: "check",
        id: "view.left",
        text: { key: "common:menu.showLeft" },
        accelerator: "CmdOrCtrl+1",
        checked: true,
      },
      { kind: "predefined", id: "app.quit", predefined: "Quit", text: { key: "common:menu.quit" } },
    ],
  },
]

describe("collectAccelerators", () => {
  it("摊平整棵树，只留有快捷键的项（嵌套子菜单也要进）", () => {
    expect(collectAccelerators(model)).toEqual([
      { id: "file.new", accelerator: "CmdOrCtrl+N" },
      { id: "view.left", accelerator: "CmdOrCtrl+1" },
    ])
  })

  it("空模型得到空表", () => {
    expect(collectAccelerators([])).toEqual([])
  })
})

describe("formatAccelerator", () => {
  it.each([
    ["CmdOrCtrl+N", "Ctrl+N"],
    ["CmdOrCtrl+S", "Ctrl+S"],
    ["CmdOrCtrl+,", "Ctrl+,"],
    // 模型里 Shift 写在 CmdOrCtrl 前面，但 Windows 上的惯例顺序是 Ctrl 在前。
    ["Shift+CmdOrCtrl+Z", "Ctrl+Shift+Z"],
    ["CmdOrCtrl+Shift+N", "Ctrl+Shift+N"],
  ])("%j -> %j", (accelerator, expected) => {
    expect(formatAccelerator(accelerator)).toBe(expected)
  })
})

/** 构造键盘事件里本模块用到的字段。 */
function key(
  k: string,
  mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">> = {},
) {
  return { key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }
}

describe("matchesAccelerator", () => {
  it("命中：修饰键与键位都对上", () => {
    expect(matchesAccelerator(key("s", { ctrlKey: true }), "CmdOrCtrl+S")).toBe(true)
    expect(matchesAccelerator(key("Z", { ctrlKey: true, shiftKey: true }), "Shift+CmdOrCtrl+Z")).toBe(
      true,
    )
    expect(matchesAccelerator(key(",", { ctrlKey: true }), "CmdOrCtrl+,")).toBe(true)
  })

  it("键位大小写不敏感（Shift 会把它变成大写）", () => {
    // ⌘⇧Z 在浏览器里 `key` 是 "Z"；模型里写的是大写 Z，两边都要能对上。
    expect(matchesAccelerator(key("z", { ctrlKey: true, shiftKey: true }), "Shift+CmdOrCtrl+Z")).toBe(
      true,
    )
  })

  it("缺修饰键不命中", () => {
    expect(matchesAccelerator(key("s"), "CmdOrCtrl+S")).toBe(false)
  })

  it("多出修饰键也不命中（⇧⌘S 不是 ⌘S）", () => {
    expect(matchesAccelerator(key("S", { ctrlKey: true, shiftKey: true }), "CmdOrCtrl+S")).toBe(false)
    expect(matchesAccelerator(key("s", { ctrlKey: true, metaKey: true }), "CmdOrCtrl+S")).toBe(false)
    expect(matchesAccelerator(key("s", { ctrlKey: true, altKey: true }), "CmdOrCtrl+S")).toBe(false)
  })

  it("键位不同不命中", () => {
    expect(matchesAccelerator(key("o", { ctrlKey: true }), "CmdOrCtrl+S")).toBe(false)
  })
})

describe("findAccelerator", () => {
  it("按真实菜单表命中：Ctrl+Shift+Z 是重做、Ctrl+, 是设置", () => {
    // 用**真的** MENU_ACCELERATORS：这条同时钉住「标题栏里显示的键」与「按下时接的键」
    // 取自同一份数据，两边不可能各改一半。
    expect(findAccelerator(key("Z", { ctrlKey: true, shiftKey: true }), MENU_ACCELERATORS)).toBe(
      "edit.redo",
    )
    expect(findAccelerator(key(",", { ctrlKey: true }), MENU_ACCELERATORS)).toBe("app.settings")
    expect(findAccelerator(key("1", { ctrlKey: true }), MENU_ACCELERATORS)).toBe("view.left")
  })

  it("没命中返回 undefined（Delete 不在表里，仍由 shortcuts.ts 单独处理）", () => {
    expect(findAccelerator(key("s"), MENU_ACCELERATORS)).toBeUndefined()
    expect(findAccelerator(key("Delete"), MENU_ACCELERATORS)).toBeUndefined()
    expect(findAccelerator(key("Backspace"), MENU_ACCELERATORS)).toBeUndefined()
  })

  it("空表返回 undefined", () => {
    expect(findAccelerator(key("s", { ctrlKey: true }), [])).toBeUndefined()
  })
})
