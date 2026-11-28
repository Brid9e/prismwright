import { describe, it, expect } from "vitest"
import { EffectSchema, LayerSchema } from "../schema.js"
import { createAdjustmentLayer } from "../defaults.js"
import { resolveEffectiveEffects } from "../effects.js"
import type { Effect, Layer } from "../types.js"

const fx = (kind: Effect["kind"], id: string, enabled = true): Effect =>
  EffectSchema.parse({ kind, id, enabled, params: {} }) as Effect

const adjustment = (id: string, effects: Effect[], enabled = true): Layer =>
  LayerSchema.parse({ id, name: id, kind: "adjustment", enabled, effects })

const normal = (id: string, effects: Effect[], children: Layer[] = []): Layer =>
  LayerSchema.parse({ id, name: id, effects, children })

const kinds = (effects: readonly Effect[]) => effects.map((e) => `${e.kind}:${e.id}`)

describe("调整层数据", () => {
  it("LayerSchema 接受 adjustment；工厂产出 adjustment 且没有文字参数", () => {
    const layer = createAdjustmentLayer("调整层 1")
    expect(layer.kind).toBe("adjustment")
    expect(layer.text).toBeNull()
    expect(LayerSchema.parse({ id: "a", kind: "adjustment" }).kind).toBe("adjustment")
  })
})

describe("resolveEffectiveEffects", () => {
  it("同组上方的调整层作用于下方兄弟，且排在自有之前", () => {
    // 数组是绘制顺序：末位在上。image 在最下，gradient 居中，adjustment 在最上。
    const image = normal("image", [fx("image", "own-image")])
    const gradient = normal("gradient", [fx("gradient", "own-gradient")])
    const top = adjustment("top", [fx("moire", "adj-moire")])
    const map = resolveEffectiveEffects([image, gradient, top])

    expect(kinds(map.get("gradient")!)).toEqual(["moire:adj-moire", "gradient:own-gradient"])
    expect(kinds(map.get("image")!)).toEqual(["moire:adj-moire", "image:own-image"])
    // 调整层自身不需要被渲染，但列表也返回（自有）。
    expect(kinds(map.get("top")!)).toEqual(["moire:adj-moire"])
  })

  it("组内调整层不外泄到组外", () => {
    const outside = normal("outside", [])
    const inside = normal("inside", [])
    // 组内数组：inside 在下、adj 在上 → adj 影响 inside，但不影响组外的 outside。
    const group = normal("group", [], [inside, adjustment("adj", [fx("gradient", "adj-g")])])
    const map = resolveEffectiveEffects([outside, group])

    expect(kinds(map.get("inside")!)).toEqual(["gradient:adj-g"])
    expect(kinds(map.get("outside")!)).toEqual([])
  })

  it("组上方的调整层传进整个子树", () => {
    const inside = normal("inside", [])
    const group = normal("group", [], [inside])
    const top = adjustment("top", [fx("gradient", "adj-g")])
    const map = resolveEffectiveEffects([group, top])
    expect(kinds(map.get("inside")!)).toEqual(["gradient:adj-g"])
  })

  it("禁用的调整层不传播；内容 / alpha 类效果也不传播", () => {
    const content = normal("content", [])
    const disabled = adjustment("off", [fx("gradient", "off-g")], false)
    const contentKinds = adjustment("only-content", [
      fx("image", "adj-image"),
      fx("maskErase", "adj-mask"),
    ])
    const map = resolveEffectiveEffects([content, disabled, contentKinds])
    expect(kinds(map.get("content")!)).toEqual([])
  })

  it("多层调整层按「上层优先」排列，自有条目补齐", () => {
    const content = normal("content", [fx("gradient", "own-g")])
    const lowerAdj = adjustment("lower", [fx("gradient", "lower-g")])
    const upperAdj = adjustment("upper", [fx("gradient", "upper-g")])
    // 数组顺序：content 最下、lowerAdj、upperAdj 最上。
    const map = resolveEffectiveEffects([content, lowerAdj, upperAdj])
    expect(kinds(map.get("content")!)).toEqual(["gradient:upper-g", "gradient:lower-g", "gradient:own-g"])
  })
})
