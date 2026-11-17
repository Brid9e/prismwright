/**
 * 文字图层的 schema 约定：旧数据解析成普通层、文字参数全量补默认、越界值被拒。
 *
 * 这里钉的是「加字段不升 schemaVersion」的兼容承诺——旧 pack.json 没有 kind / text，
 * 解析后必须是一模一样的普通图层。
 */
import { describe, it, expect } from "vitest"
import { LayerSchema, TextParamsSchema } from "../schema"
import { createTextLayer } from "../defaults"

describe("Layer 的文字字段", () => {
  it("旧数据缺 kind / text：解析为 normal / null", () => {
    const layer = LayerSchema.parse({ id: "l1" })
    expect(layer.kind).toBe("normal")
    expect(layer.text).toBeNull()
  })

  it("kind: text + 最小 text：其余参数取 schema 默认值", () => {
    const layer = LayerSchema.parse({ id: "l1", kind: "text", text: { content: "Hi" } })
    expect(layer.text).toEqual({
      content: "Hi",
      fontFamily: "sans-serif",
      fontSize: 0.12,
      fontWeight: 400,
      italic: false,
      color: "#ffffff",
      letterSpacing: 0,
      lineHeight: 1.2,
      align: "center",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      stroke: null,
      shadow: null,
      asMask: false,
    })
  })

  it("越界参数被拒", () => {
    expect(() => TextParamsSchema.parse({ fontSize: 5 })).toThrow()
    expect(() => TextParamsSchema.parse({ fontWeight: 950 })).toThrow()
    expect(() => TextParamsSchema.parse({ color: "red" })).toThrow()
    expect(() => TextParamsSchema.parse({ align: "justify" })).toThrow()
  })

  it("描边 / 投影给部分字段时补默认", () => {
    const params = TextParamsSchema.parse({ stroke: { width: 0.01 }, shadow: {} })
    expect(params.stroke).toEqual({ color: "#000000", width: 0.01 })
    expect(params.shadow).toEqual({
      color: "#000000",
      opacity: 0.6,
      offsetX: 0.02,
      offsetY: -0.02,
      blur: 0.02,
    })
  })
})

describe("createTextLayer", () => {
  it("带 kind / 内容与正常混合，其余为默认值", () => {
    const layer = createTextLayer("文字 1", "你好")
    expect(layer.kind).toBe("text")
    expect(layer.blend).toBe("normal")
    expect(layer.text?.content).toBe("你好")
    expect(layer.text?.fontSize).toBe(0.12)
    expect(layer.children).toEqual([])
    expect(layer.effects).toEqual([])
  })

  it("名字写进数据、id 唯一", () => {
    const a = createTextLayer("文字 1", "A")
    const b = createTextLayer("文字 1", "A")
    expect(a.name).toBe("文字 1")
    expect(a.id).not.toBe(b.id)
  })
})
