import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ColorPicker } from "../ColorPicker"
import { ColorField } from "../ColorField"
import { initI18n } from "../../i18n/init"

initI18n("zh-CN")

const noop = () => {}

describe("ColorPicker 触发器", () => {
  it("是可访问的按钮，不再使用原生颜色输入", () => {
    const html = renderToStaticMarkup(
      createElement(ColorPicker, { value: "#ff000080", onChange: noop, ariaLabel: "颜色" }),
    )
    expect(html).toContain("<button")
    expect(html).toContain('aria-label="颜色"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('type="color"')
  })

  it("showHex 时显示 8 位色值，隐藏时只留色块", () => {
    const withHex = renderToStaticMarkup(
      createElement(ColorPicker, {
        value: "#ff000080",
        onChange: noop,
        ariaLabel: "颜色",
        showHex: true,
      }),
    )
    expect(withHex).toContain("#ff000080")

    const swatchOnly = renderToStaticMarkup(
      createElement(ColorPicker, {
        value: "#ff000080",
        onChange: noop,
        ariaLabel: "颜色",
        showHex: false,
      }),
    )
    expect(swatchOnly).not.toContain(">#ff000080<")
  })
})

describe("ColorField", () => {
  it("复用取色器触发器并显示色值", () => {
    const html = renderToStaticMarkup(
      createElement(ColorField, {
        value: "#112233",
        onChange: noop,
        ariaLabel: "底色",
      }),
    )
    expect(html).toContain('aria-label="底色"')
    expect(html).toContain("#112233")
    expect(html).not.toContain('type="color"')
  })
})
