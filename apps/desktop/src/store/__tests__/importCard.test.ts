import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    writeBytesAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    readFileBytes: vi.fn(async () => new ArrayBuffer(0)),
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

import { createCard } from "@cardbara/schema"
import { usePackStore } from "../packStore"

describe("packStore.importCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("导入卡片：追加到指定列表、重编 id 与 num、并选中它", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    const existing = usePackStore.getState().addCard(false)!
    const source = createCard(99, "外来的层")
    source.name = "星辰"

    const id = usePackStore.getState().importCard(source, false)!
    const pack = usePackStore.getState().pack!
    expect(pack.cards.map((c) => c.num)).toEqual([1, 2])
    expect(pack.cards[1].id).toBe(id)
    expect(id).not.toBe(source.id)
    expect(pack.cards[1].layers[0].id).not.toBe(source.layers[0].id)
    expect(pack.cards[0].id).toBe(existing)
    expect(usePackStore.getState().selectedCardId).toBe(id)
  })
})
