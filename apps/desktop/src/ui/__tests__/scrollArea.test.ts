import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ScrollArea } from "../ScrollArea"

describe("ScrollArea", () => {
  it("保留滚动视口与内容，SSR 不崩溃", () => {
    const html = renderToStaticMarkup(
      createElement(ScrollArea, { viewportClassName: "px-3", children: "内容" }),
    )
    expect(html).toContain("scroll-area")
    expect(html).toContain("overflow-y-auto")
    expect(html).toContain("px-3")
    expect(html).toContain("内容")
  })

  it("内容不滚动时不渲染滑块", () => {
    const html = renderToStaticMarkup(createElement(ScrollArea, { children: "内容" }))
    expect(html).not.toContain("right-1")
  })
})
