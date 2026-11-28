/**
 * Segmented 的 SSR 冒烟。
 *
 * 分段控件同时承担「模式切换」与「布局切换」两类语义，读屏必须能从角色与
 * `aria-selected` 分辨当前项；视觉上又要求选中项与容器共用 control 圆角刻度。
 * 交互（点击、方向键）由 Radix/浏览器负责，这里只钉结构与语义。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Segmented } from "../Segmented"

const options = [
  { value: "studio", label: "工作室" },
  { value: "focus", label: "专注" },
]

describe("Segmented", () => {
  it("按 tablist/tab 语义渲染，选中项带 aria-selected", () => {
    const html = renderToStaticMarkup(
      createElement(Segmented, {
        value: "focus",
        options,
        onChange: () => {},
        ariaLabel: "布局",
      }),
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="布局"')
    // 取选中那个按钮的完整片段，再确认它承载的是「专注」，而不是碰巧任意一项被标选中。
    const selected = html.match(/<button[^>]*aria-selected="true"[^>]*>.*?<\/button>/s)?.[0] ?? ""
    expect(selected).toContain("专注")
    // 未选中项不能也标成选中——两个 true 会让读屏与视觉同时失准。
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
  })

  it("每项与容器都使用 control 圆角刻度", () => {
    const html = renderToStaticMarkup(
      createElement(Segmented, { value: "studio", options, onChange: () => {} }),
    )
    expect(html).toContain("rounded-control")
    expect(html).toContain("h-control")
  })
})
