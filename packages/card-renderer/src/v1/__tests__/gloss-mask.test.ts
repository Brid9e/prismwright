/**
 * glossMaskParams：从效果列表里挑出「作为蒙版」的启用光泽条目，供祖先蒙版通路使用。
 *
 * 只挑 asMask 的条目：普通光泽若也被当成蒙版，子图层会在光带里凭空多出一次裁切，
 * 「换颜色」与「当蒙版」也就无法各用各的。
 */
import { describe, it, expect } from "vitest"
import { EffectSchema, type Effect } from "@cardbara/schema"
import { glossMaskParams } from "../effects/gloss-mask"
import { GLOSS_MAX } from "../effects/registry"

const effect = (params: Record<string, unknown>, enabled = true): Effect =>
  EffectSchema.parse({ kind: "gloss", id: "g", enabled, params }) as Effect

describe("glossMaskParams", () => {
  it("只取 asMask 的启用条目，保持列表序", () => {
    const list = [
      effect({ asMask: true, angle: 10 }),
      effect({ asMask: false, angle: 20 }),
      effect({ asMask: true, angle: 30 }, false),
      effect({ asMask: true, angle: 40 }),
    ].map((e, i) => ({ ...e, id: `g${i}` })) as Effect[]
    const masks = glossMaskParams(list)
    expect(masks.map((p) => p.angle)).toEqual([10, 40])
  })

  it("按 GLOSS_MAX 截断", () => {
    const list = Array.from({ length: GLOSS_MAX + 1 }, (_, i) =>
      effect({ asMask: true, angle: i + 1 }),
    )
    expect(glossMaskParams(list)).toHaveLength(GLOSS_MAX)
  })

  it("非光泽条目被忽略", () => {
    const mixed = EffectSchema.parse({
      kind: "moire",
      id: "m",
      params: {},
    }) as Effect
    expect(glossMaskParams([mixed])).toEqual([])
  })
})
