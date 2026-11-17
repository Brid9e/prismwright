import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../../tauri/pack-fs", () => ({
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

vi.mock("../../../tauri/bundle", () => ({
  bundleFs: { export: vi.fn(async () => ({ bytes: 42, entryCount: 2 })) },
  BundleInvalidError: class extends Error {},
}))

import { usePackStore } from "../../../store/packStore"
import { packFs } from "../../../tauri/pack-fs"
import { bundleFs } from "../../../tauri/bundle"
import { runBundleExport } from "../runBundleExport"

describe("runBundleExport", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("导出前先落盘，再把清单交给 Rust", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    usePackStore.getState().addCard(false)
    vi.clearAllMocks()

    const result = await runBundleExport("series", null, "/out/p.cards")

    expect(result).toEqual({ bytes: 42, entryCount: 2 })
    expect(usePackStore.getState().saveStatus).toBe("saved")
    const write = vi.mocked(packFs.writeTextAtomic)
    const call = vi.mocked(bundleFs.export)
    expect(write).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledTimes(1)
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[0])

    const [kind, rootDir, outPath, entries] = call.mock.calls[0]
    expect(kind).toBe(2)
    expect(rootDir).toBe("/tmp/p")
    expect(outPath).toBe("/out/p.cards")
    expect(entries[0].name).toBe("manifest.json")
    expect(entries.some((e) => e.name === "pack.json")).toBe(true)
  })

  it("保存失败时中止导出，不把旧内容打进包", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.clearAllMocks()
    vi.mocked(packFs.writeTextAtomic).mockRejectedValueOnce(new Error("disk full"))

    await expect(runBundleExport("series", null, "/out/p.cards")).rejects.toThrow()
    expect(vi.mocked(bundleFs.export)).not.toHaveBeenCalled()
  })
})
