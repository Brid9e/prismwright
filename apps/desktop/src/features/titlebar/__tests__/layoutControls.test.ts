/**
 * 布局图标的渲染冒烟测试。
 *
 * 交互（点击显隐）只能在真机上验，这里钉「两个按钮渲染得出来、栏可见时无障碍名为『隐藏…』」。
 * 断言的是 `aria-label`——Radix 的 tooltip 走 Portal，SSR 下不产出内容，故 tooltip 文案查不到，
 * 能查到的只是按钮的 `aria-label`（与 tooltip 同源，故仍能反映「隐藏 / 显示」态）。
 * zustand v5 给 SSR 的是初始快照（`collapsed` 均为 false），故断言的是「隐藏」态文案。
 *
 * 必须套 `TooltipProvider`：按钮的提示走 Radix Tooltip，缺 Provider 会直接抛错；
 * 真机上这层由 `app/App.tsx` 包在整棵树上，测试里补一层以还原真实挂载环境。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { initI18n } from "../../../i18n/init"
import { TooltipProvider } from "../../../ui/Tooltip"
import { LayoutControls } from "../LayoutControls"

initI18n("zh-CN")

describe("LayoutControls", () => {
  it("渲染左 / 右两个按钮，栏可见时无障碍名为「隐藏…」", () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(LayoutControls)),
    )
    expect(html).toContain("隐藏系列栏")
    expect(html).toContain("隐藏属性栏")
  })
})
