/**
 * 菜单结构模型的行为测试（原生菜单与自绘标题栏两个界面）。
 *
 * 菜单结构错了在真机上极难被注意到（漏项、错快捷键、勾选态反了），故把结构抽成
 * 纯函数钉住：这里断言有哪些项、id、文案 key、快捷键、勾选态。
 */
import { describe, it, expect } from "vitest"
import {
  MENU_ACCELERATORS,
  buildMenuModel,
  resolveMenuText,
  type MenuContext,
  type MenuNode,
} from "../menuModel"

const base: MenuContext = {
  showLeft: true,
  showRight: true,
  showChecker: true,
  recent: [],
  missing: {},
}

/** 取某个子菜单。 */
function submenu(model: MenuNode[], id: string): Extract<MenuNode, { kind: "submenu" }> {
  const node = model.find((n) => n.kind === "submenu" && n.id === id)
  if (!node || node.kind !== "submenu") throw new Error(`no submenu ${id}`)
  return node
}

/** 类型守卫：带 id 的节点；用于取节点的 id（滤掉没有 id 的分隔线）。 */
function hasId(n: MenuNode): n is Extract<MenuNode, { id: string }> {
  return n.kind !== "separator"
}

/** 类型守卫：普通项 / 勾选项；两者都有 id 与可选快捷键。 */
function isLeaf(n: MenuNode): n is Extract<MenuNode, { kind: "item" | "check" }> {
  return n.kind === "item" || n.kind === "check"
}

describe("buildMenuModel", () => {
  it("顶层有 应用 / 文件 / 编辑 / 视图 四个菜单", () => {
    expect(
      buildMenuModel(base)
        .filter(hasId)
        .map((n) => n.id),
    ).toEqual(["app", "file", "edit", "view"])
  })

  it("文件菜单含新建/打开/保存/导出/关闭及快捷键", () => {
    const file = submenu(buildMenuModel(base), "file")
    // 钉住整条形状（含子菜单与分隔线的位置）：`ids()` 不收子菜单，只断言 id 会漏掉「导出挂在文件下」这件事。
    expect(file.items.map((n) => (n.kind === "separator" ? "separator" : n.id))).toEqual([
      "file.new",
      "file.open",
      "file.import",
      "file.recent",
      "separator",
      "file.save",
      "file.renamePack",
      "file.probabilities",
      "file.album",
      "separator",
      "file.export",
      "file.export.series",
      "separator",
      "file.close",
    ])
    const byId = new Map(file.items.filter(isLeaf).map((n) => [n.id, n]))
    expect(byId.get("file.new")?.accelerator).toBe("CmdOrCtrl+N")
    expect(byId.get("file.open")?.accelerator).toBe("CmdOrCtrl+O")
    expect(byId.get("file.save")?.accelerator).toBe("CmdOrCtrl+S")
    expect(byId.get("file.close")?.accelerator).toBe("CmdOrCtrl+W")
  })

  // 重命名只改显示名，紧跟「保存」——同属「对当前系列整体做什么」的一组。
  it("「重命名系列」紧跟保存，文案 key 正确", () => {
    const file = submenu(buildMenuModel(base), "file")
    const rename = file.items.find((n) => n.kind === "item" && n.id === "file.renamePack")
    expect(rename).toEqual({
      kind: "item",
      id: "file.renamePack",
      text: { key: "common:menu.renamePack" },
    })
  })

  // 抽卡概率同属「对当前系列整体做什么」，紧跟在重命名后面。
  it("「抽卡概率」紧跟重命名，文案 key 正确", () => {
    const file = submenu(buildMenuModel(base), "file")
    const probabilities = file.items.find((n) => n.kind === "item" && n.id === "file.probabilities")
    expect(probabilities).toEqual({
      kind: "item",
      id: "file.probabilities",
      text: { key: "common:menu.probabilities" },
    })
  })

  it("「卡册排版」紧跟抽卡概率，文案 key 正确", () => {
    const file = submenu(buildMenuModel(base), "file")
    const album = file.items.find((n) => n.kind === "item" && n.id === "file.album")
    expect(album).toEqual({
      kind: "item",
      id: "file.album",
      text: { key: "common:menu.album" },
    })
  })

  it("无最近项时「最近打开」子菜单给一条禁用的占位", () => {
    const recent = submenu(submenu(buildMenuModel(base), "file").items, "file.recent")
    expect(recent.items).toEqual([
      {
        kind: "item",
        id: "file.recent.empty",
        text: { key: "common:menu.recentEmpty" },
        enabled: false,
      },
    ])
  })

  it("有最近项时逐条渲染、末尾附「清除菜单」；失效项禁用", () => {
    const ctx: MenuContext = {
      ...base,
      recent: [
        { name: "A", rootDir: "/a", openedAt: 1 },
        { name: "B", rootDir: "/b", openedAt: 2 },
      ],
      missing: { "/b": true },
    }
    const recent = submenu(submenu(buildMenuModel(ctx), "file").items, "file.recent")
    const items = recent.items
    // 钉住整体形状 [A、B、分隔线、清除]：只断言首尾的话，插入位置被人悄悄吞掉分隔线也测不出来。
    expect(items).toHaveLength(4)
    expect(items[2]).toEqual({ kind: "separator" })
    expect(items[0]).toEqual({
      kind: "item",
      id: "recent:/a",
      text: { literal: "A" },
      enabled: true,
    })
    expect(items[1]).toEqual({
      kind: "item",
      id: "recent:/b",
      text: { literal: "B" },
      enabled: false,
    })
    expect(items[items.length - 1]).toEqual({
      kind: "item",
      id: "file.recent.clear",
      text: { key: "common:menu.clearRecent" },
    })
  })

  it("视图勾选态跟随上下文", () => {
    const view = submenu(buildMenuModel({ ...base, showLeft: false, showChecker: false }), "view")
    const byId = new Map(view.items.filter(isLeaf).map((n) => [n.id, n]))
    expect(byId.get("view.left")).toMatchObject({ kind: "check", checked: false })
    expect(byId.get("view.right")).toMatchObject({ kind: "check", checked: true })
    expect(byId.get("view.checker")).toMatchObject({ kind: "check", checked: false })
  })

  it("应用菜单含关于/设置/退出", () => {
    const app = submenu(buildMenuModel(base), "app")
    const kinds = app.items.map((n) =>
      n.kind === "predefined" || n.kind === "item" ? n.id : n.kind,
    )
    expect(kinds).toEqual(["app.about", "separator", "app.settings", "separator", "app.quit"])
  })

  it("导出作为「文件」的子菜单，含 GIF / PNG / WebM 三项且文案 key 正确", () => {
    const exp = submenu(submenu(buildMenuModel(base), "file").items, "file.export")
    expect(exp.text).toEqual({ key: "common:menu.export" })
    expect(exp.items).toEqual([
      { kind: "item", id: "file.export.gif", text: { key: "common:menu.exportGif" } },
      { kind: "item", id: "file.export.png", text: { key: "common:menu.exportPng" } },
      { kind: "item", id: "file.export.webm", text: { key: "common:menu.exportWebm" } },
    ])
  })


})

describe("buildMenuModel（自绘标题栏）", () => {
  const model = buildMenuModel(base, "titlebar")

  it("顶层没有「应用」菜单——Windows 上没有它的位置", () => {
    expect(model.filter(hasId).map((n) => n.id)).toEqual(["file", "edit", "view"])
  })

  it("设置与退出并进「文件」末尾，原有项与顺序不变", () => {
    const file = submenu(model, "file")
    // 钉住整条形状（含分隔线的位置）：只断言有哪些 id 的话，分隔线插错位置也测不出来。
    // 注意 `app.quit` 是 predefined，`ids()` 不收它，故这里直接看节点。
    expect(file.items.map((n) => (n.kind === "separator" ? "separator" : n.id))).toEqual([
      "file.new",
      "file.open",
      "file.import",
      "file.recent",
      "separator",
      "file.save",
      "file.renamePack",
      "file.probabilities",
      "file.album",
      "separator",
      "file.export",
      "file.export.series",
      "separator",
      "file.close",
      "separator",
      "app.settings",
      "separator",
      "app.quit",
    ])
    const byId = new Map(file.items.filter(isLeaf).map((n) => [n.id, n]))
    expect(byId.get("app.settings")?.accelerator).toBe("CmdOrCtrl+,")
    // 退出沿用系统预置项：HTML 渲染层把它当普通项，动作走 menuActions 的 app.quit。
    expect(file.items[file.items.length - 1]).toEqual({
      kind: "predefined",
      id: "app.quit",
      predefined: "Quit",
      text: { key: "common:menu.quit" },
    })
  })

  it("快捷键表覆盖所有带键的项", () => {
    // 「最近打开」的项是系列名、预置项交给系统，都没有快捷键，故不进表。
    // 这条也钉住摊平只认 item/check：若哪天把快捷键写到子菜单节点上，它会被静默丢掉。
    expect(MENU_ACCELERATORS.map((a) => a.id)).toEqual([
      "file.new",
      "file.open",
      "file.save",
      "file.close",
      "app.settings",
      "edit.undo",
      "edit.redo",
      "edit.new-card",
      "view.left",
      "view.right",
    ])
  })
})

describe("resolveMenuText", () => {
  it("key 走 i18n，literal 原样返回", () => {
    const t = (key: string) => `[${key}]`
    expect(resolveMenuText({ key: "common:menu.save" }, t)).toBe("[common:menu.save]")
    expect(resolveMenuText({ literal: "星辰之约" }, t)).toBe("星辰之约")
  })
})
