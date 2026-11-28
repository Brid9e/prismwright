/**
 * 自绘标题栏的渲染冒烟测试。
 *
 * 交互（悬停换菜单、窗口按钮、拖拽）只能在真机上验，但**「渲染得出来吗」**这件事值得
 * 钉住：标题栏挂在整窗最外层，它一抛错就是白屏——本项目的头号故障形态。这里用
 * `react-dom/server` 在 node 里直接渲染一遍，按平台钉不同形态。
 *
 * 两个限制，写测试时要知道：
 * - `vitest.config.ts` 只收 `*.test.ts`，故这里用 `createElement` 而不是 JSX；
 * - zustand v5 给 SSR 提供的是 `getInitialState()` 快照（避免水合不一致），所以
 *   `setState` 出来的系列**渲染不进**这段 HTML——涉及系列的形态只能留待真机。形态本身由
 *   `variant` 显式传入，`full` / `minimal` 两态因此都能在这里钉住（`full` 下无系列时标题位
 *   回落为品牌锁形，正好拿来占位）。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { initI18n } from "../../../i18n/init"
import type { Platform } from "../../../app/platform"
import { TooltipProvider } from "../../../ui/Tooltip"
import { TitleBar, type TitleBarVariant } from "../TitleBar"

initI18n("zh-CN")

/**
 * 按平台渲染一次标题栏，返回 HTML。
 *
 * `variant` 默认 `full`（编辑器态），起始屏形态 `minimal` 由用例显式传入——两种形态的差别
 * 就在于菜单、标题、底色画不画，故必须能分别钉住。
 *
 * 外面套一层 `TooltipProvider`：右侧的 `LayoutControls` 用 Radix Tooltip，而 Radix 的
 * `Tooltip` 必须在 `TooltipProvider` 内才不抛错；真机上这层由 `App` 提供（见 App.tsx）。
 */
function render(platform: Platform, variant: TitleBarVariant = "full"): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(TitleBar, { platform, variant })),
  )
}

/**
 * 取出 HTML 里带 `data-tauri-drag-region` 的 `<div>` 标签，供断言「哪几处是拖拽区」。
 *
 * 需要按元素断言而不是 `toContain` 一次——Tauri v2 的拖拽脚本只对**命中目标自身**
 * `hasAttribute`（不回溯祖先），故「外层栅格带了这个属性」并不能让落在子元素上的按下变成拖拽：
 * 空白处若要能拖，那块空白自己就得带。只断言「出现过属性」会让这个 bug 静默通过。
 */
function dragTargets(html: string): string[] {
  return html.match(/<div[^>]*data-tauri-drag-region[^>]*>/g) ?? []
}

describe("TitleBar（Windows）", () => {
  it("顶栏与窗口上缘齐平：46 高、通栏、不铺容器背景", () => {
    const html = render("windows")
    expect(html).toContain("h-topbar")
    // 曾经把顶栏做成与面板一样的浮层，实机观感是「在最顶端分离」，故不再有圆角/投影。
    expect(html).not.toContain("rounded-panel")
    expect(html).not.toContain("panel-shadow")
  })

  it("画出自绘菜单条：文件 / 编辑 / 视图", () => {
    const html = render("windows")
    expect(html).toContain("文件")
    expect(html).toContain("编辑")
    expect(html).toContain("视图")
  })

  it("没有「应用」菜单（顶层只剩三项，「关于」随它一起消失）", () => {
    expect(render("windows")).not.toContain("关于")
  })

  it("无系列时标题位回落为品牌锁形", () => {
    const html = render("windows")
    // 锁形 = logo + 字标：logo 以 aria-label 报出应用名（本用例固定 zh-CN），字标是固定的拉丁字。
    expect(html).toContain('aria-label="棱匠"')
    expect(html).toContain("Prismwright")
  })

  // 「只能拖着标题移动」的回归：Tauri 只看命中目标自身有没有该属性，故左右两列的**留白**
  // 也必须各自带上——只挂在外层栅格上时，落在这两列空白处的按下不会启动拖拽（中列标题之所以
  // 能拖，是因为它 pointer-events-none，事件穿透落到了外层栅格上）。
  it("拖拽区覆盖左右两列的留白，而不仅外层栅格一处", () => {
    const spans = dragTargets(render("windows"))
    expect(spans).toHaveLength(3) // 外层 + 左列 + 右列（中列 pointer-events-none，不挂属性）
    expect(spans.some((el) => el.includes("pl-1"))).toBe(true) // 左列
    expect(spans.some((el) => el.includes("justify-end"))).toBe(true) // 右列
  })

  it("按钮不带拖拽属性（可点元素照常可点，不会被拖拽吞掉）", () => {
    // 菜单项、设置 / 布局 / 窗口按钮都是 <button>。带了这个属性就会被 Tauri 当拖拽区
    // （按下即 startDragging），点不动了——修留白拖拽时别把属性顺手加到控件上。
    expect(render("windows")).not.toMatch(/<button[^>]*data-tauri-drag-region/)
  })

  it("无 Tauri 环境（dev:web）不渲染窗口按钮", () => {
    expect(render("windows")).not.toContain("最小化")
  })

  it("无系列时布局图标让位，设置图标常驻", () => {
    const html = render("windows")
    // 无系列即没有可显隐的左右栏，布局图标让位；设置图标常驻，起始屏也要能进设置。
    expect(html).not.toContain("隐藏系列栏")
    expect(html).toContain('aria-label="设置"')
  })

  // 悬停块能不能撑满整条，取决于**栅格列的高度**：栅格若 items-center，三列会各自收缩到内容
  // 高（十几个像素），列内那些 h-full 便统统解析成那个高度——窗口按钮的 hover 底色于是上下
  // 撑不满。列必须拉伸到整条 h-8，列内部再各自 items-center 居中（那三处 items-center 都在
  // 列上，不在这里）。测试环境没有布局引擎（node + renderToStaticMarkup），钉不住真实像素，
  // 只能钉住这个 class 接缝——改它就必须在真机上再看一眼。
  it("三列栅格拉伸列高，列内各自居中（悬停块才撑满 h-8）", () => {
    expect(render("windows")).toContain("items-stretch")
  })

  it("标题居中——Windows 无交通灯空槽，不跟着 macOS-dev:web 一起左移", () => {
    expect(render("windows")).toContain("text-center")
  })
})

describe("TitleBar（macOS）", () => {
  it("不再画菜单条（菜单留在屏幕顶部原生菜单栏）", () => {
    expect(render("macos")).not.toContain("文件")
  })

  it("无系列时含设置图标、不含布局图标", () => {
    const html = render("macos")
    expect(html).not.toContain("隐藏系列栏")
    expect(html).toContain('aria-label="设置"')
  })

  it("无 Tauri（dev:web）不留交通灯空槽，标题仍居中", () => {
    const html = render("macos")
    // 空槽只为真实交通灯让位；浏览器里没有，故不留那 76px 的固定占位。
    expect(html).not.toContain("76px")
    // 居中改由三列栅格保证，与有无空槽无关——不再有「无壳就左对齐」的分支。
    expect(html).toContain("text-center")
  })

  // 拖拽脚本与列结构都是跨平台共用的，Windows 上「只能拖标题」的机理在 macOS 一样成立
  // （留白要自己带属性）。这里显式钉住两态，免得日后有人给某一平台加分支时把 macOS 掉出去。
  it("左右两列留白与起始屏中列都是拖拽区（两态一致）", () => {
    for (const variant of ["full", "minimal"] as const) {
      const spans = dragTargets(render("macos", variant))
      expect(spans.some((el) => el.includes("pl-1"))).toBe(true) // 左列
      expect(spans.some((el) => el.includes("justify-end"))).toBe(true) // 右列
    }
    // 起始屏正中那块空 div 自己就是这片空白的命中目标。
    expect(dragTargets(render("macos", "minimal")).some((el) => !el.includes("class="))).toBe(true)
  })
})

describe("TitleBar（起始屏：variant=minimal）", () => {
  it("Windows：不画菜单、不画标题，只留设置图标", () => {
    const html = render("windows", "minimal")
    expect(html).not.toContain("文件")
    expect(html).not.toContain("Prismwright")
    expect(html).toContain('aria-label="设置"')
  })

  it("整条透明不显形：不铺标题栏底色", () => {
    expect(render("windows", "minimal")).not.toContain("bg-panel")
  })

  it("仍是拖拽区，且正中那个空 div 自己就是拖拽目标", () => {
    const spans = dragTargets(render("windows", "minimal"))
    // 起始屏中列是块空 div——Tauri 只认命中目标自身的属性，故它必须自带（无 class 的那一个），
    // 否则起始屏正中那片就是死区，正是「初始化页面没法拖」。
    expect(spans.some((el) => !el.includes("class="))).toBe(true)
    expect(spans.length).toBeGreaterThanOrEqual(4) // 外层 + 左列 + 空中列 + 右列
  })

  it("macOS：同样只剩设置图标，标题与交通灯让位都不画", () => {
    const html = render("macos", "minimal")
    expect(html).not.toContain("Prismwright")
    expect(html).not.toContain("76px")
    expect(html).toContain('aria-label="设置"')
  })
})
