/**
 * 图层缺失资产告警判定的钉桩。
 *
 * 这判定的要害有两点：一是 `image` 与 `imageMask` **都要**纳入（只查蒙版会让图片层
 * 缺失时静默无提示）；二是「已添加但未选图」（`path === ""`）是合法中间态，不能误报。
 */
import { describe, it, expect } from "vitest"
import type { Effect, EffectKind } from "@prismwright/schema"
import { EFFECT_REGISTRY } from "@prismwright/renderer/v1"
import { layerHasMissingAsset } from "../warn"

/** 造一个带指定图片路径的合法条目（参数形状由注册表的默认值给出）。 */
function fx(
  kind: Extract<EffectKind, "image" | "imageMask">,
  path: string,
  enabled = true,
): Effect {
  const params = { ...EFFECT_REGISTRY[kind].defaultParams(), path }
  return { id: kind, enabled, kind, params } as Effect
}

describe("layerHasMissingAsset", () => {
  it("imageMask 的路径被标记缺失时告警", () => {
    expect(layerHasMissingAsset([fx("imageMask", "assets/m.png")], { "assets/m.png": true })).toBe(
      true,
    )
  })

  it("image 的路径被标记缺失时也告警（与蒙版同口径）", () => {
    expect(layerHasMissingAsset([fx("image", "assets/p.png")], { "assets/p.png": true })).toBe(true)
  })

  it("路径未被标记缺失、或根本没标记时不告警", () => {
    expect(layerHasMissingAsset([fx("image", "assets/p.png")], {})).toBe(false)
    expect(layerHasMissingAsset([fx("image", "assets/p.png")], { "assets/other.png": true })).toBe(
      false,
    )
  })

  it("path 为空串是「已添加但未选图」的合法中间态，不告警", () => {
    expect(layerHasMissingAsset([fx("image", "")], { "": true })).toBe(false)
    expect(layerHasMissingAsset([fx("imageMask", "")], { "": true })).toBe(false)
  })

  it("禁用（enabled=false）的条目不参与解析，即便路径缺失也不告警", () => {
    expect(
      layerHasMissingAsset([fx("image", "assets/p.png", false)], { "assets/p.png": true }),
    ).toBe(false)
  })

  it("两类条目并存时任一缺失即告警", () => {
    const effects = [fx("image", "assets/p.png"), fx("imageMask", "assets/m.png")]
    expect(layerHasMissingAsset(effects, { "assets/m.png": true })).toBe(true)
    expect(layerHasMissingAsset(effects, { "assets/p.png": true })).toBe(true)
  })

  it("无相关效果时不告警", () => {
    expect(layerHasMissingAsset([], { "assets/p.png": true })).toBe(false)
  })
})
