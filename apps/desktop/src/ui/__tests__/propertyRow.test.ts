/**
 * PropertyRow 是检查器里出现频率最高的结构：几十个参数都靠它对齐。
 *
 * 这里钉住三件会一起漂移的事：行高、固定标签列、标签字级。任何一项被改成
 * 任意值（如 `h-[30px]`、`w-[58px]`），整块面板的纵向节奏就会开始对不齐。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PropertyRow } from "../PropertyRow"

function render(props: Partial<Parameters<typeof PropertyRow>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PropertyRow, { label: "密度", children: "x", ...props }),
  )
}

describe("PropertyRow", () => {
  it("行高与字段间距走刻度类", () => {
    const html = render()
    expect(html).toContain("min-h-row")
    expect(html).toContain("gap-2")
  })

  it("标签是固定宽度的弱化小字，并可截断", () => {
    const html = render()
    expect(html).toContain("w-label")
    expect(html).toContain("text-label")
    expect(html).toContain("text-muted")
    expect(html).toContain("truncate")
  })

  it("长标签保留 title 以便悬停看全名", () => {
    const html = render({ label: "一个很长很长的参数名" })
    expect(html).toContain('title="一个很长很长的参数名"')
  })
})
