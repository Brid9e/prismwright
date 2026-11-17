/**
 * 从效果列表里挑出「作为蒙版」的启用光泽条目，交给祖先蒙版通路（见 materials/layer-material.ts）。
 *
 * 与 `pick(effects, "gloss", ...)` 同一种筛选口径（启用 + 列表序 + 截断到 `GLOSS_MAX`），
 * 只是多了一道 `asMask`：普通光泽照常出光、不能被当成裁切源。
 */
import type { Effect, GlossParams } from "@cardbara/schema"
import { GLOSS_MAX } from "./registry"

export function glossMaskParams(effects: readonly Effect[]): GlossParams[] {
  const out: GlossParams[] = []
  for (const e of effects) {
    if (e.kind !== "gloss" || !e.enabled || !e.params.asMask || out.length >= GLOSS_MAX) continue
    out.push(e.params)
  }
  return out
}
