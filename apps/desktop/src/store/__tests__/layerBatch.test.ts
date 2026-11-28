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

import { usePackStore } from "../packStore"
import { initI18n } from "../../i18n/init"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  initI18n("zh-CN")
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const ref = { kind: "card" as const, cardId }
  // 清掉 setup 预置的图层，方便按顺序加三层 a/b/c（数组下 → 上）。
  const initial = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!.layers[0]
  usePackStore.getState().deleteLayer(ref, initial.id)
  const a = usePackStore.getState().addLayer(ref)!
  const b = usePackStore.getState().addLayer(ref)!
  const c = usePackStore.getState().addLayer(ref)!
  return { ref, cardId, ids: { a, b, c } }
}

function layersOf(cardId: string) {
  return usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!.layers
}

describe("图层多选与批量操作", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("selectLayers 同步集合与主选层", async () => {
    const { ids } = await setup()
    usePackStore.getState().selectLayers([ids.a, ids.c], ids.a)
    expect(usePackStore.getState().selectedLayerIds).toEqual([ids.a, ids.c])
    expect(usePackStore.getState().selectedLayerId).toBe(ids.a)
  })

  it("duplicateLayers 只复制选中根，副本插在原层之后并选中", async () => {
    const { ref, cardId, ids } = await setup()
    usePackStore.getState().selectLayers([ids.a, ids.b])
    const copies = usePackStore.getState().duplicateLayers(ref, [ids.a, ids.b])
    expect(copies).toHaveLength(2)
    expect(layersOf(cardId).map((l) => l.id)).toEqual([ids.a, copies[0], ids.b, copies[1], ids.c])
    expect(usePackStore.getState().selectedLayerIds).toEqual(copies)
  })

  it("deleteLayers 删除选中根并清空选择；锁定层跳过", async () => {
    const { ref, cardId, ids } = await setup()
    usePackStore.getState().setLayerLocked(ref, ids.a, true)
    usePackStore.getState().deleteLayers(ref, [ids.a, ids.b])
    expect(layersOf(cardId).map((l) => l.id)).toEqual([ids.a, ids.c])
    expect(usePackStore.getState().selectedLayerIds).toEqual([])
  })

  it("groupLayers 把选中层收进新分组，位置跟最高选中层", async () => {
    const { ref, cardId, ids } = await setup()
    usePackStore.getState().selectLayers([ids.a, ids.b])
    const groupId = usePackStore.getState().groupLayers(ref, [ids.a, ids.b])
    expect(groupId).not.toBeNull()
    const layers = layersOf(cardId)
    expect(layers.map((l) => l.id)).toEqual([groupId, ids.c])
    const group = layers[0]
    expect(group.children.map((l) => l.id)).toEqual([ids.a, ids.b])
    expect(usePackStore.getState().selectedLayerId).toBe(groupId)
  })

  it("addGroupLayer 建空分组并选中", async () => {
    const { ref, cardId } = await setup()
    const id = usePackStore.getState().addGroupLayer(ref)
    const group = layersOf(cardId).find((l) => l.id === id)!
    expect(group.children).toEqual([])
    expect(usePackStore.getState().selectedLayerId).toBe(id)
  })

  it("锁定层不能拖动，也不能作为拖入目标", async () => {
    const { ref, cardId, ids } = await setup()
    usePackStore.getState().setLayerLocked(ref, ids.a, true)
    const before = layersOf(cardId).map((l) => l.id)
    usePackStore.getState().moveLayer(ref, ids.a, null, 2)
    expect(layersOf(cardId).map((l) => l.id)).toEqual(before)
    // 把 b 拖进锁定的 a：拒绝。
    usePackStore.getState().moveLayer(ref, ids.b, ids.a, 0)
    expect(layersOf(cardId).map((l) => l.id)).toEqual(before)
  })
})
