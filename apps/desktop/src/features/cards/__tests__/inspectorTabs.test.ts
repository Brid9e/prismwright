/**
 * 检查器页签的契约。
 *
 * 顺序是写给用户的阅读顺序：先看「这张卡是什么」（设计），再改「由什么组成」（属性/图层），
 * 然后调「效果」。导出已移到顶栏，不再占页签。顺序若在 UI 与快捷键/菜单里各写一套，两边就会漂移，
 * 故收在一个常量里。
 */
import { describe, it, expect } from "vitest"
import { INSPECTOR_TABS, isInspectorTab, resolveInspectorTab } from "../inspectorTabs"

describe("inspectorTabs", () => {
  it("页签顺序固定为 设计 / 属性 / 效果", () => {
    expect([...INSPECTOR_TABS]).toEqual(["design", "layers", "effects"])
  })

  it("isInspectorTab 只接受三个合法值", () => {
    expect(isInspectorTab("layers")).toBe(true)
    expect(isInspectorTab("inspector")).toBe(false)
  })

  it("没有可编辑卡面时回落到设计页，而不是停在空页签", () => {
    expect(resolveInspectorTab("effects", true)).toBe("effects")
    expect(resolveInspectorTab("effects", false)).toBe("design")
  })
})
