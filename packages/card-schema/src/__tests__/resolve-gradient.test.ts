import { describe, it, expect } from "vitest"
import { EffectSchema } from "../schema.js"
import { resolveGradient, resolveHoloGradient } from "../effects.js"
import type { Effect } from "../types.js"

const gradient = (enabled: boolean, distortionStrength = 5, colors: string[] = []): Effect =>
  EffectSchema.parse({
    kind: "gradient",
    id: "g",
    enabled,
    params: { distortionStrength, colors },
  }) as Effect

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

describe("resolveHoloGradient", () => {
  it("无渐变 → null", () => {
    expect(resolveHoloGradient([])).toBeNull()
  })

  it("有但 enabled=false → null", () => {
    expect(resolveHoloGradient([gradient(false)])).toBeNull()
  })

  it("启用 → 返回 params（即便 colors 为空也返回，空与否由调用方判）", () => {
    expect(resolveHoloGradient([gradient(true, 5, ["#111111"])])?.colors).toEqual([
      { color: "#111111", at: 0.5 },
    ])
    expect(resolveHoloGradient([gradient(true)])?.colors).toEqual([])
  })

  it("取第一条启用条目，跳过被关掉的那条", () => {
    expect(
      resolveHoloGradient([gradient(false, 1), gradient(true, 2)])?.distortionStrength,
    ).toBe(2)
  })
})
