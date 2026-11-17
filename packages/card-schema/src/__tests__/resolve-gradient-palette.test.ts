import { describe, it, expect } from "vitest"
import { EffectSchema } from "../schema.js"
import { resolveGradient, resolvePalette } from "../effects.js"
import type { Effect } from "../types.js"

const gradient = (enabled: boolean, distortionStrength = 5): Effect =>
  EffectSchema.parse({
    kind: "gradient",
    id: "g",
    enabled,
    params: { distortionStrength },
  }) as Effect

const palette = (enabled: boolean, colors: string[] = ["#111111"]): Effect =>
  EffectSchema.parse({ kind: "palette", id: "p", enabled, params: { colors } }) as Effect

describe("resolveGradient", () => {
  it("无渐变效果 → null", () => {
    expect(resolveGradient([])).toBeNull()
  })

  it("有渐变但 enabled=false 时**仍返回其 params**（相位参数不随开关失效）", () => {
    const g = resolveGradient([gradient(false, 42)])
    expect(g).not.toBeNull()
    expect(g?.distortionStrength).toBe(42)
  })

  it("多条时取第一条", () => {
    expect(resolveGradient([gradient(true, 11), gradient(true, 22)])?.distortionStrength).toBe(11)
  })
})

describe("resolvePalette", () => {
  it("无调色板 → null", () => {
    expect(resolvePalette([])).toBeNull()
  })

  it("有但 enabled=false → null", () => {
    expect(resolvePalette([palette(false)])).toBeNull()
  })

  it("启用 → 返回 params（即便 colors 为空也返回，空与否由调用方判）", () => {
    expect(resolvePalette([palette(true, ["#111111"])])?.colors).toEqual([
      { color: "#111111", at: 0.5 },
    ])
    expect(resolvePalette([palette(true, [])])?.colors).toEqual([])
  })
})
