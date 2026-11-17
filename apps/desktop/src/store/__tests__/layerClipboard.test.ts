/**
 * 图层剪贴板：Ctrl+C 存快照、Ctrl+V 粘成新图层。
 *
 * 用户场景是「把 A 卡的某个效果图层复制到 B 卡」：粘出来的必须是独立的一棵子树
 * （整棵重编 id），且复制那一刻之后源层再怎么改都不影响粘出来的内容。
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

import { findLayerById } from "@cardbara/schema"
import { usePackStore } from "../packStore"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

/** 建一个含两张卡的系列；A 卡预置 1 个图层。 */
async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const firstId = usePackStore.getState().addCard(false)!
  const secondId = usePackStore.getState().addCard(false)!
  const first = usePackStore.getState().pack!.cards.find((c) => c.id === firstId)!
  return { firstId, secondId, layerId: first.layers[0].id }
}

function cardLayers(cardId: string) {
  return usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!.layers
}

describe("packStore 图层剪贴板", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("copyLayer 存快照：复制之后源层再改，粘出来的仍是复制那一刻的值", async () => {
    const { firstId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId: firstId }
    usePackStore.getState().commit((d) => {
      d.cards.find((c) => c.id === firstId)!.layers[0].holoMix = 0.42
    })
    expect(usePackStore.getState().copyLayer(ref, layerId)).toBe(true)

    usePackStore.getState().commit((d) => {
      d.cards.find((c) => c.id === firstId)!.layers[0].holoMix = 0.99
    })

    const secondId = usePackStore.getState().pack!.cards[1].id
    const pastedId = usePackStore.getState().pasteLayer({
      kind: "card",
      cardId: secondId,
    })!
    expect(findLayerById(cardLayers(secondId), pastedId)!.holoMix).toBe(0.42)
  })

  it("pasteLayer 粘到目标卡最上层，整棵子树重编 id、名字沿用源层", async () => {
    const { firstId, secondId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId: firstId }
    usePackStore.getState().commit((d) => {
      d.cards.find((c) => c.id === firstId)!.layers[0].name = "扫光"
    })
    // 造一棵子树：child 挂在 layerId 之下。
    const childId = usePackStore.getState().addLayer(ref)!
    usePackStore.getState().moveLayer(ref, childId, layerId, 0)
    usePackStore.getState().copyLayer(ref, layerId)

    const pastedId = usePackStore.getState().pasteLayer({ kind: "card", cardId: secondId })!
    const layers = cardLayers(secondId)
    const pasted = layers[layers.length - 1]
    expect(pasted.id).toBe(pastedId)
    expect(pastedId).not.toBe(layerId)
    expect(pasted.name).toBe("扫光")
    expect(pasted.children).toHaveLength(1)
    expect(pasted.children[0].id).not.toBe(childId)
    // 粘贴后选中新层，后续操作直接落在它身上。
    expect(usePackStore.getState().selectedLayerId).toBe(pastedId)
  })

  it("粘两次得到两层互不相同的图层", async () => {
    const { firstId, secondId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId: firstId }
    usePackStore.getState().copyLayer(ref, layerId)
    const target = { kind: "card" as const, cardId: secondId }
    const a = usePackStore.getState().pasteLayer(target)!
    const b = usePackStore.getState().pasteLayer(target)!
    expect(a).not.toBe(b)
    expect(cardLayers(secondId).map((l) => l.id)).toEqual([cardLayers(secondId)[0].id, a, b])
  })

  it("没复制过、或目标卡面不存在时安静返回 null，不产生历史步", async () => {
    const { firstId, secondId } = await setup()
    const before = usePackStore.getState().pack
    expect(
      usePackStore.getState().pasteLayer({ kind: "card", cardId: secondId }),
    ).toBeNull()
    expect(usePackStore.getState().pack).toBe(before)

    // 复制一个不存在的图层：失败，剪贴板仍为空。
    expect(
      usePackStore.getState().copyLayer(
        { kind: "card", cardId: firstId },
        "missing",
      ),
    ).toBe(false)
    expect(usePackStore.getState().layerClipboard).toBeNull()
  })

  it("粘贴只占一步撤销", async () => {
    const { firstId, secondId, layerId } = await setup()
    usePackStore
      .getState()
      .copyLayer({ kind: "card", cardId: firstId }, layerId)
    const target = { kind: "card" as const, cardId: secondId }
    const layerCount = cardLayers(secondId).length
    usePackStore.getState().pasteLayer(target)
    expect(cardLayers(secondId)).toHaveLength(layerCount + 1)

    usePackStore.getState().undo()
    expect(cardLayers(secondId)).toHaveLength(layerCount)

    usePackStore.getState().redo()
    expect(cardLayers(secondId)).toHaveLength(layerCount + 1)
  })

  it("可以粘到系列背面（背面尚不存在时懒创建）", async () => {
    const { firstId, layerId } = await setup()
    usePackStore
      .getState()
      .copyLayer({ kind: "card", cardId: firstId }, layerId)
    expect(usePackStore.getState().pack!.back).toBeNull()
    const pastedId = usePackStore.getState().pasteLayer({ kind: "back" })!
    const back = usePackStore.getState().pack!.back!
    expect(back.layers).toHaveLength(1)
    expect(findLayerById(back.layers, pastedId)).not.toBeNull()
  })
})
