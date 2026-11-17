/**
 * 右键菜单模型测试。
 *
 * 菜单**长什么样、点了做什么**全在纯函数里（组件只负责定位与绘制），所以这里能在 node
 * 环境里把条目顺序、回调参数与文本编辑命令钉住。
 */
import { describe, it, expect, vi } from "vitest"
import {
  cardContextItems,
  editorContextItems,
  isTextEntry,
  layerContextItems,
  runTextCommand,
  textContextItems,
  type ContextMenuItem,
} from "../contextMenuModel"

/** 测试里 `t` 直接回显 key，断言就是在断言语义键。 */
const t = (key: string) => key

/** 把条目压成「label 序列」，分隔符写作 `---`。 */
function labels(items: ContextMenuItem[]): string[] {
  return items.map((item) => (item.kind === "separator" ? "---" : item.label))
}

/** 点一下指定 label 的条目。 */
function click(items: ContextMenuItem[], label: string): void {
  const item = items.find((i) => i.kind === "item" && i.label === label)
  if (!item || item.kind !== "item") throw new Error(`没有这个条目：${label}`)
  item.onSelect()
}

describe("editorContextItems", () => {
  it("依次给出新建卡片 / 撤销 / 重做 / 导出系列", () => {
    const actions = {
      newCard: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      exportSeries: vi.fn(),
      covers: vi.fn(),
    }
    const items = editorContextItems({ t, ...actions })
    expect(labels(items)).toEqual([
      "common:menu.newCard",
      "---",
      "common:menu.undo",
      "common:menu.redo",
      "---",
      "common:menu.exportSeries",
      "common:menu.covers",
    ])
    // 封面项的回调原样透传：动作表由调用方（App）注入，模型不该二次包装。
    const coverItem = items.find((i) => i.kind === "item" && i.label === "common:menu.covers")
    expect(coverItem?.kind === "item" && coverItem.onSelect).toBe(actions.covers)
    for (const item of items) {
      if (item.kind === "item") click(items, item.label)
    }
    expect(actions.newCard).toHaveBeenCalledOnce()
    expect(actions.undo).toHaveBeenCalledOnce()
    expect(actions.redo).toHaveBeenCalledOnce()
    expect(actions.exportSeries).toHaveBeenCalledOnce()
    expect(actions.covers).toHaveBeenCalledOnce()
  })
})

describe("cardContextItems", () => {
  it("导出 / 复制 / 删除都带上这张卡的 id", () => {
    const actions = { exportCard: vi.fn(), duplicateCard: vi.fn(), deleteCard: vi.fn() }
    const items = cardContextItems({ cardId: "c1", t, ...actions })
    expect(labels(items)).toEqual([
      "bundle:export.titleCard",
      "---",
      "common:action.duplicate",
      "common:menu.deleteCard",
    ])
    click(items, "bundle:export.titleCard")
    click(items, "common:action.duplicate")
    click(items, "common:menu.deleteCard")
    expect(actions.exportCard).toHaveBeenCalledWith("c1")
    expect(actions.duplicateCard).toHaveBeenCalledWith("c1")
    expect(actions.deleteCard).toHaveBeenCalledWith("c1")
  })
})

describe("layerContextItems", () => {
  it("复制 / 删除都带上图层 id", () => {
    const actions = { duplicateLayer: vi.fn(), deleteLayer: vi.fn() }
    const items = layerContextItems({ layerId: "l1", t, ...actions })
    expect(labels(items)).toEqual(["layer:action.duplicate", "layer:action.delete"])
    click(items, "layer:action.duplicate")
    click(items, "layer:action.delete")
    expect(actions.duplicateLayer).toHaveBeenCalledWith("l1")
    expect(actions.deleteLayer).toHaveBeenCalledWith("l1")
  })
})

describe("textContextItems", () => {
  it("命令与快捷键按桌面惯例排列", () => {
    const run = vi.fn()
    const items = textContextItems({ t, run })
    expect(labels(items)).toEqual([
      "common:menu.undo",
      "common:menu.redo",
      "---",
      "common:context.cut",
      "common:context.copy",
      "common:context.paste",
      "---",
      "common:context.selectAll",
    ])
    click(items, "common:context.paste")
    expect(run).toHaveBeenCalledWith("paste")
  })
})

describe("isTextEntry", () => {
  it("认出文本输入框、多行文本框与 contenteditable", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true)
    expect(isTextEntry({ tagName: "INPUT", type: "search" })).toBe(true)
    expect(isTextEntry({ tagName: "input", type: "number" })).toBe(true)
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true)
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true)
  })

  it("开关 / 滑杆 / 普通元素不算", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false)
    expect(isTextEntry({ tagName: "INPUT", type: "range" })).toBe(false)
    expect(isTextEntry({ tagName: "DIV" })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe("runTextCommand", () => {
  it("先聚焦原控件再执行命令", () => {
    const el = { focus: vi.fn() }
    const doc = { execCommand: vi.fn(() => true) }
    runTextCommand("copy", el as unknown as HTMLElement, doc)
    expect(el.focus).toHaveBeenCalledOnce()
    expect(doc.execCommand).toHaveBeenCalledWith("copy")
  })

  it("全选优先用控件自己的 select()", () => {
    const el = { focus: vi.fn(), select: vi.fn() }
    const doc = { execCommand: vi.fn(() => true) }
    runTextCommand("selectAll", el as unknown as HTMLElement, doc)
    expect(el.select).toHaveBeenCalledOnce()
    expect(doc.execCommand).not.toHaveBeenCalled()
  })

  it("粘贴先走 execCommand", async () => {
    const el = { focus: vi.fn() }
    const doc = { execCommand: vi.fn(() => true) }
    await runTextCommand("paste", el as unknown as HTMLElement, doc)
    expect(doc.execCommand).toHaveBeenCalledWith("paste")
  })

  it("execCommand 不支持粘贴时退回剪贴板读取", async () => {
    const el = { focus: vi.fn() }
    const doc = { execCommand: vi.fn(() => false) }
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn(async () => "剪贴板") } })
    await runTextCommand("paste", el as unknown as HTMLElement, doc)
    expect(doc.execCommand).toHaveBeenLastCalledWith("insertText", false, "剪贴板")
    vi.unstubAllGlobals()
  })
})
