/**
 * packStore 效果栈原语（add / remove / update / move）的行为测试。
 *
 * 卡面已没有面级效果列表：所有效果都挂在图层上。这里重点钉住两处——
 * - 槽位与命中判定必须在 commit 之前，落空不留空撤销步；
 * - 合并键 `effect.<id>.<field>` 的粒度。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    copyAsset: vi.fn(async () => ""),
    moveToTrash: vi.fn(async () => "token"),
    restoreFromTrash: vi.fn(async () => {}),
    purgeTrash: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
    isPackDir: vi.fn(async () => true),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    readAssetBytes: vi.fn(async () => new ArrayBuffer(0)),
  },
}))

import type { Effect } from "@prismwright/schema"
import { EFFECT_REGISTRY, MASK_PRESET_MAX } from "@prismwright/renderer/v1"
import { usePackStore } from "../packStore"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
  return { cardId, layerId: card.layers[0].id, ref: { kind: "card" as const, cardId } }
}

function narrow<K extends Effect["kind"]>(
  effect: Effect | undefined,
  kind: K,
): Extract<Effect, { kind: K }> {
  if (!effect || effect.kind !== kind) throw new Error(`期望 ${kind}，实际 ${effect?.kind}`)
  return effect as Extract<Effect, { kind: K }>
}

const layerEffects = () => usePackStore.getState().pack!.cards[0].layers[0].effects

describe("packStore 效果栈原语", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("addEffect 落在图层：kind / enabled / 稳定 id / 默认参数", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "gradient")
    const effects = layerEffects()
    expect(effects).toHaveLength(1)
    const e = effects[0]
    expect(e.kind).toBe("gradient")
    expect(e.enabled).toBe(true)
    expect(e.id).not.toBe("")
    expect(e.params).toEqual(EFFECT_REGISTRY.gradient.defaultParams())
  })

  it("槽位满时静默拒绝：列表不增，且不留历史点", async () => {
    const { ref, layerId } = await setup()
    const target = { scope: "layer" as const, layerId }
    for (let i = 0; i < MASK_PRESET_MAX; i++) {
      usePackStore.getState().addEffect(ref, target, "maskPreset")
    }
    expect(layerEffects().filter((e) => e.kind === "maskPreset")).toHaveLength(MASK_PRESET_MAX)
    const past = usePackStore.getState().past.length
    usePackStore.getState().addEffect(ref, target, "maskPreset")
    expect(layerEffects().filter((e) => e.kind === "maskPreset")).toHaveLength(MASK_PRESET_MAX)
    expect(usePackStore.getState().past.length).toBe(past)
  })

  it("defaultParams 每次返回新对象：两条条目不共享引用", async () => {
    const { ref, layerId } = await setup()
    const target = { scope: "layer" as const, layerId }
    usePackStore.getState().addEffect(ref, target, "gloss")
    usePackStore.getState().addEffect(ref, target, "gloss")
    const [a, b] = layerEffects().map((e) => narrow(e, "gloss"))
    expect(a.params).not.toBe(b.params)
    const original = b.params.count
    a.params.count = original + 7
    expect(b.params.count).toBe(original)
  })

  it("updateEffect 合并参数并保留 enabled；连续拖动同一字段只占一步历史", async () => {
    const { ref, layerId } = await setup()
    const target = { scope: "layer" as const, layerId }
    usePackStore.getState().addEffect(ref, target, "gradient")
    const id = layerEffects()[0].id
    const before = usePackStore.getState().past.length
    usePackStore.getState().updateEffect(ref, target, id, { enabled: false })
    usePackStore.getState().updateEffect(ref, target, id, { enabled: false })
    const e = narrow(layerEffects()[0], "gradient")
    expect(e.enabled).toBe(false)
    expect(usePackStore.getState().past.length).toBe(before + 1)
  })

  it("removeEffect / moveEffect：落空不留历史点，命中可重排", async () => {
    const { ref, layerId } = await setup()
    const target = { scope: "layer" as const, layerId }
    usePackStore.getState().addEffect(ref, target, "gradient")
    usePackStore.getState().addEffect(ref, target, "moire")
    const ids = layerEffects().map((e) => e.id)
    usePackStore.getState().moveEffect(ref, target, ids[0], 1)
    expect(layerEffects().map((e) => e.id)).toEqual([ids[1], ids[0]])
    const past = usePackStore.getState().past.length
    usePackStore.getState().removeEffect(ref, target, "missing")
    expect(usePackStore.getState().past.length).toBe(past)
    usePackStore.getState().removeEffect(ref, target, ids[1])
    expect(layerEffects().map((e) => e.id)).toEqual([ids[0]])
  })
})
