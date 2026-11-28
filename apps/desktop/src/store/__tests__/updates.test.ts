/**
 * packStore 参数与属性更新的行为测试。
 *
 * 重点在 mergeKey 的粒度——它决定撤销栈里的一步到底是「一次拖拽」还是「每一帧」，
 * 写错不会报错，只会让撤销体验崩坏。
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

import { findLayerById, type ColorStop } from "@prismwright/schema"
import { usePackStore } from "../packStore"

const stop = (color: string, at: number): ColorStop => ({ color, at })

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
  return { cardId, layerId: card.layers[0].id, ref: { kind: "card" as const, cardId } }
}

describe("packStore 参数与属性更新", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("updateCard 写入名称/备注/稀有度", async () => {
    const { cardId } = await setup()
    usePackStore.getState().updateCard(cardId, { name: "星辰", notes: "n", rarity: "epic" })
    const card = usePackStore.getState().pack!.cards[0]
    expect(card.name).toBe("星辰")
    expect(card.notes).toBe("n")
    expect(card.rarity).toBe("epic")
  })

  it("同一字段的连续更新合并为一步历史", async () => {
    const { cardId } = await setup()
    const before = usePackStore.getState().past.length
    usePackStore.getState().updateCard(cardId, { name: "a" })
    usePackStore.getState().updateCard(cardId, { name: "ab" })
    usePackStore.getState().updateCard(cardId, { name: "abc" })
    expect(usePackStore.getState().past.length).toBe(before + 1)
  })

  it("不同字段之间不合并", async () => {
    const { cardId } = await setup()
    const before = usePackStore.getState().past.length
    usePackStore.getState().updateCard(cardId, { name: "a" })
    usePackStore.getState().updateCard(cardId, { notes: "b" })
    expect(usePackStore.getState().past.length).toBe(before + 2)
  })

  it("超出合并窗口后不再合并（注入时间验证）", async () => {
    const { cardId } = await setup()
    const t0 = 1_000_000
    usePackStore.getState().updateCard(cardId, { name: "a" }, { now: t0 })
    const after1 = usePackStore.getState().past.length
    usePackStore.getState().updateCard(cardId, { name: "ab" }, { now: t0 + 5000 })
    expect(usePackStore.getState().past.length).toBe(after1 + 1)
  })

  it("updateLayer 改单个参数，不同图层互不合并", async () => {
    const { ref, layerId } = await setup()
    const second = usePackStore.getState().addLayer(ref)!
    usePackStore.getState().updateLayer(ref, layerId, { holoMix: 0.5 })
    const after1 = usePackStore.getState().past.length
    usePackStore.getState().updateLayer(ref, second, { holoMix: 0.5 })
    expect(usePackStore.getState().past.length).toBe(after1 + 1)
  })

  it("updateFace 写底色", async () => {
    const { cardId } = await setup()
    usePackStore.getState().updateFace({ kind: "card", cardId }, { baseColor: "#123456" })
    expect(usePackStore.getState().pack!.cards[0].baseColor).toBe("#123456")
  })

  it("不把调用方的数组与色标对象存进 state（updateEffect 的 palette 路径）", async () => {
    const { ref, layerId } = await setup()
    // 先给图层挂一条 palette 效果，拿到它的 id——色标要落到这条效果的 params.colors 上。
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "palette")
    const effectId = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      layerId,
    )!.effects.find((e) => e.kind === "palette")!.id

    // 调用方原地改自己持有的数组与元素：不应影响 state（否则会绕过 commit 静默改数据）。
    const colors = [stop("#111111", 0)]
    usePackStore.getState().updateEffect(ref, { scope: "layer", layerId }, effectId, { colors })
    colors.push(stop("#222222", 1))
    colors[0].at = 0.9
    const effect = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      layerId,
    )!.effects.find((e) => e.id === effectId)!
    if (effect.kind !== "palette") throw new Error("期望 palette 效果")
    expect(effect.params.colors).toEqual([stop("#111111", 0)])
  })

  it("目标不存在时安静空操作且不留历史点", async () => {
    const { cardId } = await setup()
    const past = usePackStore.getState().past.length
    usePackStore.getState().updateCard("missing", { name: "x" })
    usePackStore.getState().updateLayer({ kind: "card", cardId }, "missing", { holoMix: 1 })
    usePackStore.getState().updateFace({ kind: "card", cardId: "missing" }, { baseColor: "x" })
    expect(usePackStore.getState().past).toHaveLength(past)
  })

  it("未打开系列时安静空操作", () => {
    expect(() => {
      usePackStore.getState().updateCard("c", { name: "x" })
      usePackStore.getState().updateLayer({ kind: "back" }, "l", { holoMix: 1 })
      usePackStore.getState().updateFace({ kind: "back" }, { baseColor: "#fff" })
      usePackStore
        .getState()
        .updateEffect({ kind: "back" }, { scope: "layer", layerId: "l" }, "e", { enabled: false })
    }).not.toThrow()
    expect(usePackStore.getState().pack).toBeNull()
  })
})

describe("setSeriesAspect", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("写入系列宽高比", async () => {
    await setup()
    usePackStore.getState().setSeriesAspect(1.5)
    expect(usePackStore.getState().pack!.aspect).toBe(1.5)
  })

  it("值没变时不入历史", async () => {
    await setup()
    const before = usePackStore.getState().pack!.aspect
    const past = usePackStore.getState().past.length
    usePackStore.getState().setSeriesAspect(before)
    expect(usePackStore.getState().past).toHaveLength(past)
  })

  it("连续微调合并为一步历史", async () => {
    await setup()
    const past = usePackStore.getState().past.length
    usePackStore.getState().setSeriesAspect(1.1)
    usePackStore.getState().setSeriesAspect(1.2)
    usePackStore.getState().setSeriesAspect(1.3)
    expect(usePackStore.getState().past.length).toBe(past + 1)
  })

  it("撤销回到改之前的比例", async () => {
    await setup()
    const before = usePackStore.getState().pack!.aspect
    usePackStore.getState().setSeriesAspect(2)
    usePackStore.getState().undo()
    expect(usePackStore.getState().pack!.aspect).toBe(before)
  })

  it("未打开系列时安静空操作", () => {
    expect(() => usePackStore.getState().setSeriesAspect(2)).not.toThrow()
    expect(usePackStore.getState().pack).toBeNull()
  })
})

describe("updatePackArtStyle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("只写传入的字段，其余保持默认", async () => {
    await setup()
    usePackStore.getState().updatePackArtStyle({ blend: "multiply", opacity: 0.6 })
    const style = usePackStore.getState().pack!.packArtStyle
    expect(style.blend).toBe("multiply")
    expect(style.opacity).toBe(0.6)
    expect(style.fit).toBe("cover")
    expect(style.packInvert).toBe(false)
  })

  it("值没变时不入历史", async () => {
    await setup()
    const past = usePackStore.getState().past.length
    usePackStore.getState().updatePackArtStyle({ blend: "screen" })
    expect(usePackStore.getState().past).toHaveLength(past)
  })

  it("同一字段连续拖动合并为一步历史", async () => {
    await setup()
    const past = usePackStore.getState().past.length
    usePackStore.getState().updatePackArtStyle({ opacity: 0.9 }, { now: 1000 })
    usePackStore.getState().updatePackArtStyle({ opacity: 0.8 }, { now: 1100 })
    usePackStore.getState().updatePackArtStyle({ opacity: 0.7 }, { now: 1200 })
    expect(usePackStore.getState().pack!.packArtStyle.opacity).toBe(0.7)
    expect(usePackStore.getState().past.length).toBe(past + 1)
  })

  it("不同字段各自成一步，不误合并", async () => {
    await setup()
    const past = usePackStore.getState().past.length
    usePackStore.getState().updatePackArtStyle({ opacity: 0.9 }, { now: 1000 })
    usePackStore.getState().updatePackArtStyle({ packBrightness: 1.2 }, { now: 1100 })
    expect(usePackStore.getState().past.length).toBe(past + 2)
  })

  it("撤销回到改之前的样式", async () => {
    await setup()
    usePackStore.getState().updatePackArtStyle({ blend: "overlay" })
    usePackStore.getState().undo()
    expect(usePackStore.getState().pack!.packArtStyle.blend).toBe("screen")
  })

  it("未打开系列时安静空操作", () => {
    expect(() => usePackStore.getState().updatePackArtStyle({ opacity: 0.5 })).not.toThrow()
    expect(usePackStore.getState().pack).toBeNull()
  })
})
