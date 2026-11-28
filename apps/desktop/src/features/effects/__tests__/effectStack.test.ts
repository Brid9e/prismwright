/**
 * 效果栈的 SSR 冒烟测试。
 *
 * 交互（展开、拖动、上传）需在真机验；这里钉两件会静默跑偏、且纯逻辑单测覆盖不到的接缝：
 * - 滑块的复位目标来自注册表默认值（漏传 `defaultValue` 时图标直接消失，界面不报错）；
 * - 「内容」分组只在真的能添加 / 已有条目时出现（卡面不能加图层级图片，空组不该占位）。
 *
 * 与其它 SSR 冒烟一致：`environment: "node"`、`createElement`（非 JSX），并套
 * `TooltipProvider`——复位按钮是 `IconButton` → Radix Tooltip，缺 Provider 会直接抛错。
 */
import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Effect, EffectKind } from "@prismwright/schema"
import { EFFECT_REGISTRY, type FieldDescriptor } from "@prismwright/renderer/v1"
import { initI18n } from "../../../i18n/init"
import { TooltipProvider } from "../../../ui/Tooltip"
import { EffectFields, EffectStack } from "../EffectStack"

initI18n("zh-CN")

const noop = () => {}

/** 造一条合法条目；参数取注册表默认值，形状必与 kind 匹配（同 effectOps.test 的 cast 理由）。 */
function fx(kind: EffectKind, id: string): Effect {
  return { id, enabled: true, kind, params: EFFECT_REGISTRY[kind].defaultParams() } as Effect
}

/** 渲染指定作用域的空效果栈。 */
function renderEmptyStack(scope: "layer" | "face") {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EffectStack, {
        scope,
        effects: [],
        onAdd: noop,
        onRemove: noop,
        onToggle: noop,
        onMove: noop,
        onUpdate: noop,
        onPickImage: noop,
        onPaintErase: noop,
      }),
    ),
  )
}

/** 渲染单条效果的参数区。 */
function renderFields(effect: Effect, scope: "layer" | "face" = "layer") {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EffectFields, {
        effect,
        scope,
        onUpdate: noop,
        onPickImage: noop,
        onPaintErase: noop,
      }),
    ),
  )
}

/** 取所有复位按钮的标签（`<button ...>` 整段），便于断言数量与禁用态。 */
function resetButtons(html: string): string[] {
  return html.match(/<button[^>]*aria-label="重置为默认值"[^>]*>/g) ?? []
}

describe("EffectStack 展开态", () => {
  it("默认展开所有效果，参数直接可见", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(EffectStack, {
          scope: "layer",
          effects: [fx("gloss", "g")],
          onAdd: noop,
          onRemove: noop,
          onToggle: noop,
          onMove: noop,
          onUpdate: noop,
          onPickImage: noop,
          onPaintErase: noop,
        }),
      ),
    )
    // gloss 的「方向」字段在展开区里；折叠态不会渲染它。
    expect(html).toContain("方向")
  })
})

describe("EffectStack 空分组", () => {
  it("卡面作用域下隐藏「内容」分组：无可添加的 kind，空组不该占位", () => {
    const html = renderEmptyStack("face")
    expect(html).not.toContain("内容")
    // 相位组在卡面上仍可添加，照常渲染——隐藏只针对「空且无入口」的组。
    expect(html).toContain("相位")
  })

  it("图层作用域下保留「内容」分组：图片可以从这里添加", () => {
    const html = renderEmptyStack("layer")
    expect(html).toContain("内容")
  })
})

describe("EffectFields 滑块复位", () => {
  /** 默认参数下实际可见的滑块数量：叠色联动参数在 palette 合成下会被 visibleWhen 隐藏。 */
  function visibleSliderCount(params: Record<string, unknown>): number {
    const fields: readonly FieldDescriptor[] = EFFECT_REGISTRY.gradient.fields
    return fields.filter(
      (f) =>
        f.type === "slider" &&
        (f.visibleWhen === undefined || f.visibleWhen(params)),
    ).length
  }

  it("每个注册表滑块都有复位图标，参数为默认值时全部置灰", () => {
    const effect = fx("gradient", "g")
    const html = renderFields(effect)
    const buttons = resetButtons(html)

    expect(buttons).toHaveLength(
      visibleSliderCount(effect.params as unknown as Record<string, unknown>),
    )
    // 参数都等于注册表默认值时，每个复位按钮都该禁用；有任何一个可点即说明默认值没对上。
    expect(buttons.every((b) => b.includes('disabled=""'))).toBe(true)
  })

  it("改动单个参数后只有该滑块的复位图标可点（复位目标 = 注册表默认值）", () => {
    const base = EFFECT_REGISTRY.gradient.defaultParams()
    // count 的默认值是 1..64 内的整数；换成另一个合法值即只让这一项偏离默认。
    const changed = { ...base, count: base.count === 1 ? 2 : 1 }
    const buttons = resetButtons(
      renderFields({ ...fx("gradient", "g"), params: changed } as Effect),
    )
    const enabled = buttons.filter((b) => !b.includes('disabled=""'))

    expect(buttons).toHaveLength(visibleSliderCount(changed as unknown as Record<string, unknown>))
    expect(enabled).toHaveLength(1)
  })
})

describe("EffectFields 颜色字段", () => {
  it("不再渲染画布吸管按钮", () => {
    // gloss 有单色字段 `color`，之前这里会额外渲染一个 Pipette 按钮。
    const html = renderFields(fx("gloss", "g"))
    expect(html).not.toContain("从画面拾取")
  })
})

describe("EffectFields 擦除画笔", () => {
  it("maskErase 的绘画字段给出「开始绘画」入口，未绘制时没有清除按钮", () => {
    const html = renderFields(fx("maskErase", "er"), "face")
    expect(html).toContain("开始绘画")
    expect(html).toContain("未绘制")
    expect(html).not.toContain("清除擦除")
  })

  it("已绘制（path 非空）时按钮改为「继续绘画」，并出现清除按钮", () => {
    const html = renderFields(
      { ...fx("maskErase", "er"), params: { path: "assets/e.png" } } as Effect,
      "face",
    )
    expect(html).toContain("继续绘画")
    expect(html).toContain("已绘制")
    expect(html).toContain("清除擦除")
  })
})
