/**
 * 稀有度特效的纯配置：不实例化 WebGL，只钉住五档存在、时长递增与隐藏款彩虹。
 */
import { describe, expect, it } from "vitest"
import { RARITY_FX_PRESETS, rarityFxDuration } from "../rarity-fx"

const ORDER = ["common", "rare", "epic", "legendary", "hidden"] as const

describe("RARITY_FX_PRESETS", () => {
  it("五档齐全，时长逐档递增", () => {
    expect(Object.keys(RARITY_FX_PRESETS).sort()).toEqual([...ORDER].sort())
    for (let i = 1; i < ORDER.length; i++) {
      expect(rarityFxDuration(ORDER[i])).toBeGreaterThan(rarityFxDuration(ORDER[i - 1]))
    }
  })

  it("越高的档位粒子更多；只有隐藏款用彩虹色", () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(RARITY_FX_PRESETS[ORDER[i]].particles).toBeGreaterThan(
        RARITY_FX_PRESETS[ORDER[i - 1]].particles,
      )
    }
    expect(RARITY_FX_PRESETS.hidden.rainbow).toBe(true)
    expect(RARITY_FX_PRESETS.legendary.rainbow).toBeUndefined()
  })

  it("普通卡不播：粒子 0，其余档位只有粒子配置", () => {
    expect(RARITY_FX_PRESETS.common.particles).toBe(0)
    expect(RARITY_FX_PRESETS.common.duration).toBe(0)
    expect("rune" in RARITY_FX_PRESETS.epic).toBe(false)
    expect("beam" in RARITY_FX_PRESETS.legendary).toBe(false)
  })
})
