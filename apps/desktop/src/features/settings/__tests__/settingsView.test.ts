/**
 * 设置视图的渲染冒烟测试。
 *
 * 交互（返回 / 切分类 / 导入）需在真机验，这里钉「标题、返回按钮、分类，以及默认落在『通用』
 * 时该分类的内容渲染得出来」。与其它 SSR 冒烟一致：`environment: "node"` 下用 `createElement`
 * （非 JSX），且 mock 掉 Tauri 触碰（组件间接 import 了 pack-fs / packDir / theme-fs / plugin-store）。
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../../../tauri/pack-fs", () => ({ packFs: { pickFile: vi.fn(), readText: vi.fn() } }))
vi.mock("../../../tauri/theme-fs", () => ({
  themeFs: { listImported: vi.fn(), install: vi.fn() },
}))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }))

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { initI18n } from "../../../i18n/init"
import { SettingsView } from "../SettingsView"

initI18n("zh-CN")

describe("SettingsView", () => {
  it("渲染标题、返回按钮与分类，默认落在「通用」", () => {
    const html = renderToStaticMarkup(createElement(SettingsView))
    expect(html).toContain("设置")
    expect(html).toContain('aria-label="返回编辑器"')
    expect(html).toContain("通用")
    expect(html).toContain("外观")
    // 默认分类是「通用」：应出现语言（下拉，当前值「中文」）与默认新建目录两项。
    expect(html).toContain("语言")
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain("中文")
    expect(html).toContain("默认新建目录")
    // 编辑器版本：当前只有 v1，下拉显示其值。
    expect(html).toContain("版本")
    expect(html).toContain("v1")
  })
})
