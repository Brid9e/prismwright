/**
 * Slider 复位按钮的 SSR 冒烟。
 *
 * 交互（点击复位是否写入、撤销粒度）需在真机验；这里钉三件会静默跑偏的事：
 * 提供 defaultValue 时必须出现带可访问名的按钮、未提供时不出现、等于默认值时应置灰。
 * 测试环境是 node，故用 `createElement`（非 JSX）+ `renderToStaticMarkup`，与其它冒烟一致。
 *
 * 必须套 `TooltipProvider`：复位按钮实际是 `IconButton` → `Tooltip`（Radix），缺 Provider 会
 * 直接抛 `Tooltip must be used within TooltipProvider`——与 `titlebar/__tests__/*.test.ts` 同一处理。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Slider } from "../Slider"
import { TooltipProvider } from "../Tooltip"

const base = { value: 0.5, onChange: () => {}, min: 0, max: 1 }

function renderSlider(props: Partial<Parameters<typeof Slider>[0]>) {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(Slider, { ...base, ...props })),
  )
}

describe("Slider 轨道", () => {
  it("扁平厚轨道：无内阴影、无边框，手柄与轨道同高且无投影", () => {
    const html = renderSlider({})
    // 轨道与数字框同用 control 圆角；填充用 track-fill 与未滑过部分区分。
    expect(html).toContain("rounded-control")
    expect(html).toContain("bg-track")
    expect(html).toContain("bg-track-fill")
    // 扁平：轨道不再有 inset-control 内阴影与描边。
    expect(html).not.toContain("inset-control")
    expect(html).toContain("overflow-hidden rounded-control bg-track")
    // 手柄与轨道同高（h-control），宽 8px；不再有 thumb-shadow。
    expect(html).toMatch(/class="[^"]*\bh-control\b[^"]*\bw-2\b[^"]*"/)
    expect(html).not.toContain("thumb-shadow")
  })
})

describe("Slider 复位按钮", () => {
  it("提供 defaultValue 时渲染带 resetLabel 的复位按钮", () => {
    const html = renderSlider({ defaultValue: 0.9, resetLabel: "重置为默认值" })
    expect(html).toContain('aria-label="重置为默认值"')
  })

  it("未提供 defaultValue 时不渲染复位按钮", () => {
    // 必须同时传 resetLabel：否则按钮即使被错误渲染，aria-label 也只是空串，
    // 断言「不含某文案」会假通过，钉不住 `defaultValue !== undefined` 这道闸。
    const html = renderSlider({ resetLabel: "R" })
    expect(html).not.toContain('aria-label="R"')
    // Slider 本身不产出任何 <button>：滑杆是 span/input，数字框是 input，
    // 唯一可能的 button 就是复位图标，故整段无 button 即无复位控件。
    expect(html).not.toContain("<button")
  })

  it("当前值等于默认值时复位按钮禁用", () => {
    const html = renderSlider({ value: 0.9, defaultValue: 0.9, resetLabel: "R" })
    expect(html).toContain('aria-label="R"')
    // 断言 disabled 长在带 aria-label="R" 的同一个按钮上，而不是页面上任意位置的
    // disabled 属性（数字框禁用时也会带 disabled，泛断言会假通过）。
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="R"/)
  })
})
