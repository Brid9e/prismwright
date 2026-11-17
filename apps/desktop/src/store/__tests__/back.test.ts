/**
 * packStore 的「删除卡背」行为测试。
 *
 * 删除只清引用、不动素材文件（与「删除卡面图」同一约定，见 `CardFaceFields`）：
 * 系列随即回落到全系列共用的默认卡背。整次删除是一步可撤销的历史。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createCardFace } from "@cardbara/schema"

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
  },
}))

import { usePackStore } from "../packStore"
import { packFs } from "../../tauri/pack-fs"

/** 建一个已带卡背的系列作为起点。 */
async function seed() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  usePackStore.getState().commit((d) => {
    d.back = createCardFace()
  })
}

describe("deleteBack", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("把卡背置回 null，可撤销恢复", async () => {
    await seed()
    expect(usePackStore.getState().pack?.back).not.toBeNull()

    usePackStore.getState().deleteBack()

    expect(usePackStore.getState().pack?.back).toBeNull()
    // 只清引用：素材文件留在系列目录里，不搬回收站。
    expect(packFs.moveToTrash).not.toHaveBeenCalled()
    usePackStore.getState().undo()
    expect(usePackStore.getState().pack?.back).not.toBeNull()
  })

  it("本来就没有卡背时为空操作，不写历史", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    const past = usePackStore.getState().past.length

    usePackStore.getState().deleteBack()

    expect(usePackStore.getState().past).toHaveLength(past)
  })

  it("选中的图层属于被删的卡背时清空选择", async () => {
    await seed()
    const layerId = usePackStore.getState().addLayer({ kind: "back" })!
    usePackStore.getState().selectLayer(layerId)

    usePackStore.getState().deleteBack()

    expect(usePackStore.getState().selectedLayerId).toBeNull()
  })

  it("选中的是正面卡片图层时不动选择", async () => {
    await seed()
    const cardId = usePackStore.getState().addCard(false)!
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    usePackStore.getState().selectLayer(card.layers[0].id)

    usePackStore.getState().deleteBack()

    expect(usePackStore.getState().selectedLayerId).toBe(card.layers[0].id)
  })
})
