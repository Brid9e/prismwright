/**
 * 外观面板的渲染冒烟测试。
 *
 * 交互（切换 / 导入）需在真机验，这里钉「主题下拉（统一的 Select）渲染出当前项、导入按钮在」。
 * 与其它 SSR 冒烟一致：`environment: "node"` 下用 `createElement`（非 JSX），
 * 且 mock 掉 Tauri 触碰（store 间接 import 了 pack-fs / theme-fs / plugin-store）。
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
import { useThemeStore } from "../../../store/themeStore"
import type { Theme } from "../../../themes/types"
import { AppearancePanel } from "../AppearancePanel"

initI18n("zh-CN")

/** 两个样例主题：「默认」走 i18n 名（nameKey），另一个用字面名——覆盖两条取名路径。 */
const THEMES: Theme[] = [
  {
    meta: { id: "default", name: "", source: "builtin", nameKey: "settings:appearance.default" },
    tokens: {},
  },
  {
    meta: { id: "github-dark", name: "GitHub Dark", source: "builtin" },
    tokens: { "--color-accent": "88 166 255" },
  },
]

/**
 * 让 SSR 渲染到「有主题」的那一态。
 *
 * zustand v5 的 SSR 快照取自 `getInitialState()` 返回的那个**对象本身**（见 titleBar 测试
 * 的说明），`setState` 出来的主题渲染不进 `renderToStaticMarkup`。初始态与 `getState()`
 * 本就是同一对象（见 zustand vanilla 的 `initialState = state = createState(...)`），
 * 就地补上样例主题，组件经 SSR 快照读到的就是这份数据。
 */
const snapshot = useThemeStore.getInitialState()
snapshot.themes = THEMES
snapshot.selectedId = "default"
snapshot.importError = null

describe("AppearancePanel", () => {
  it("以下拉框列出主题并给出导入按钮", () => {
    const html = renderToStaticMarkup(createElement(AppearancePanel))
    // 主题下拉是编辑器统一的 Select（Radix：触发器是 button），当前选中项展示在触发器上；
    // 选项只在展开时渲染，故 SSR 里只钉触发器与导入按钮。
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain("Cardbara 深色")
    expect(html).toContain("导入主题…")
  })
})
