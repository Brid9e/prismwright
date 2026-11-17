/**
 * 设置图标按钮的渲染冒烟测试。
 *
 * 交互（点开 / 再点关闭）只能在真机上验，这里钉「渲染得出来、无障碍名为『设置』」。
 * 断言的是 `aria-label`——Radix 的 tooltip 走 Portal，SSR 下不产出内容，故 tooltip 文案
 * 查不到，能查到的只是按钮的 `aria-label`（与 tooltip 同源）。
 *
 * 必须套 `TooltipProvider`：按钮的提示走 Radix Tooltip，缺 Provider 会直接抛错；
 * 真机上这层由 `app/App.tsx` 包在整棵树上，测试里补一层以还原真实挂载环境。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { initI18n } from "../../../i18n/init"
import { TooltipProvider } from "../../../ui/Tooltip"
import { SettingsButton } from "../SettingsButton"

initI18n("zh-CN")

describe("SettingsButton", () => {
  it("渲染设置按钮，无障碍名为「设置」", () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(SettingsButton)),
    )
    expect(html).toContain('aria-label="设置"')
  })
})
