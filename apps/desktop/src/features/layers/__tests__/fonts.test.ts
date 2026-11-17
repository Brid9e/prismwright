/**
 * 字体清单：通用族置顶（默认）、手填族名能作为额外选项出现在下拉里。
 *
 * 手填族名不在清单里时若直接当值喂给下拉，控件会显示为空——用户会以为字体丢了。
 */
import { describe, it, expect } from "vitest"
import { TEXT_FONTS, textFontOptions } from "../fonts"

describe("TEXT_FONTS", () => {
  it("三个通用族排在最前", () => {
    expect(TEXT_FONTS.slice(0, 3).map((f) => f.value)).toEqual(["sans-serif", "serif", "monospace"])
  })

  it("含常用中文与西文字体，value 唯一", () => {
    const values = TEXT_FONTS.map((f) => f.value)
    expect(values).toContain("Microsoft YaHei")
    expect(values).toContain("SimSun")
    expect(values).toContain("Arial")
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("textFontOptions", () => {
  it("清单内的值原样返回，不额外插入", () => {
    expect(textFontOptions("Arial")).toHaveLength(TEXT_FONTS.length)
  })

  it("手填族名（含空格）作为第一项插入，标签就是族名", () => {
    const options = textFontOptions("Some Custom Font")
    expect(options[0]).toEqual({ value: "Some Custom Font", label: "Some Custom Font" })
    expect(options).toHaveLength(TEXT_FONTS.length + 1)
  })

  it("空串不插入额外项", () => {
    expect(textFontOptions("")).toHaveLength(TEXT_FONTS.length)
  })
})
