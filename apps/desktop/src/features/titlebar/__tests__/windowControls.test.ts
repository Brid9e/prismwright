/**
 * 窗口按钮的渲染测试。
 *
 * 交互（最小化 / 最大化 / 关闭、最大化后换图标）只能在真机上验；能在这里钉住的是**字形几何**
 * ——它照 Windows 11 的原生度量画：三个字形都落在同一个 10×10 方框里、统一 1px 描边，按钮宽 46。
 *
 * 为什么值得钉：这几个数字正是「跟原生摆在一起显得小一圈、粗细也不齐」的成因。图标库对不上
 * ——lucide 三个图标各自的留白不同（Minus 占 14/24、Square 18/24、X 只有 12/24），一个 size
 * 没法让三者都落进 10×10，描边粗细也会各不一样（实测关闭叉只有 8×8、最小化却粗到 2px）。
 * 若有人图省事换回图标库，这些断言会红。
 */
import { describe, it, expect, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { initI18n } from "../../../i18n/init"

// 组件在 effect / 点击里才拿窗口；SSR 只走 render，故这里给个不触网的替身即可
// （真实调用会 invoke 到不存在的 Tauri 内核）。
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
  }),
}))

import { WindowControls } from "../WindowControls"

initI18n("zh-CN")

function render(): string {
  return renderToStaticMarkup(createElement(WindowControls))
}

/** 数出某个正则命中的次数，供「三个字形都…」这类似断言用。 */
function count(html: string, re: RegExp): number {
  return html.match(re)?.length ?? 0
}

describe("WindowControls", () => {
  it("三个字形都画在 10×10 方框里、统一 1px 描边（原生 Fluent 度量）", () => {
    const html = render()
    expect(count(html, /viewBox="0 0 10 10"/g)).toBe(3)
    expect(count(html, /stroke-width="1"/g)).toBe(3)
  })

  it("不用图标库：svg 上不该有 lucide 的类（那套的留白对不齐原生的方框）", () => {
    expect(render()).not.toContain("lucide")
  })

  it("按钮宽 46px（原生标题栏按钮的宽），字形撑满方框", () => {
    const html = render()
    // 46px 作为语义刻度 `w-window` 定义在 tailwind.config，组件不写任意值。
    expect(html).toContain("w-window")
    // 最小化：10×1 的细横杠（半整数纵坐标，1× DPI 下才落成一整像素）。
    expect(html).toContain('d="M0 5.5h10"')
    // 关闭：对角线端点到 0.5 / 9.5，即撑满 10×10（原先用图标库只到 8×8）。
    expect(html).toContain('d="M0.5 0.5 9.5 9.5M9.5 0.5 0.5 9.5"')
  })

  it("三个按钮都带无障碍名（图标 aria-hidden，名字落在按钮上）", () => {
    const html = render()
    expect(html).toContain('aria-label="最小化"')
    expect(html).toContain('aria-label="最大化"')
    expect(html).toContain('aria-label="关闭"')
    expect(count(html, /aria-hidden="true"/g)).toBe(3)
  })
})
