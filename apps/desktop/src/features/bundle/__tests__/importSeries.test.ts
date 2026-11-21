import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    pathExists: vi.fn(async () => false),
    isPackDir: vi.fn(async () => true),
    purgeTrash: vi.fn(async () => {}),
  },
}))

vi.mock("../../../tauri/bundle", () => ({
  bundleFs: { install: vi.fn(), discardInstall: vi.fn(async () => {}) },
  BundleInvalidError: class extends Error {},
}))

import { createEmptyPack } from "@prismwright/schema"
import { usePackStore } from "../../../store/packStore"
import { packFs } from "../../../tauri/pack-fs"
import { bundleFs } from "../../../tauri/bundle"
import { importSeriesBundle, nextAvailableDir } from "../importSeries"
import type { BundleManifest } from "../model"

const manifest: BundleManifest = {
  format: "prismwright-bundle",
  version: 1,
  kind: "series",
  includesHistory: false,
  createdAt: "2026-11-06T00:00:00.000Z",
  appVersion: "0.1.0",
  series: { id: "s1", name: "系列", cardCount: 0 },
  card: null,
}

describe("nextAvailableDir", () => {
  it("同名目录已存在时追加序号", async () => {
    const taken = new Set(["/base/系列", "/base/系列 (2)"])
    await expect(
      nextAvailableDir("/base", "系列", async (p) => taken.has(p)),
    ).resolves.toBe("/base/系列 (3)")
  })
})

describe("importSeriesBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("安装到不重名的目录并重铸 pack.id", async () => {
    const original = createEmptyPack("系列")
    let onDisk = JSON.stringify(original)
    vi.mocked(packFs.readText).mockImplementation(async () => onDisk)
    vi.mocked(packFs.writeTextAtomic).mockImplementation(async (_p, contents) => {
      onDisk = contents
    })
    vi.mocked(packFs.pathExists).mockResolvedValue(false)
    vi.mocked(bundleFs.install).mockResolvedValue({
      dir: "/base/系列",
      manifest,
      entries: [],
    })

    const result = await importSeriesBundle("/f.cards", manifest, "/base")
    expect(result.rootDir).toBe("/base/系列")
    const written = JSON.parse(vi.mocked(packFs.writeTextAtomic).mock.calls[0][1])
    expect(written.id).not.toBe(original.id)
    expect(usePackStore.getState().pack?.id).toBe(written.id)
  })

  it("导入前先落盘当前系列，避免切换时丢掉未保存的改动", async () => {
    await usePackStore.getState().newPack("当前", "/tmp/cur")
    vi.clearAllMocks()
    vi.mocked(packFs.readText).mockResolvedValue(JSON.stringify(createEmptyPack("系列")))
    vi.mocked(bundleFs.install).mockResolvedValue({
      dir: "/base/系列",
      manifest,
      entries: [],
    })

    await importSeriesBundle("/f.cards", manifest, "/base")

    const write = vi.mocked(packFs.writeTextAtomic)
    const install = vi.mocked(bundleFs.install)
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(install.mock.invocationCallOrder[0])
  })

  it("保存失败时中止导入，不切换工作区", async () => {
    await usePackStore.getState().newPack("当前", "/tmp/cur")
    vi.clearAllMocks()
    vi.mocked(packFs.writeTextAtomic).mockRejectedValueOnce(new Error("disk full"))

    await expect(importSeriesBundle("/f.cards", manifest, "/base")).rejects.toThrow()
    expect(vi.mocked(bundleFs.install)).not.toHaveBeenCalled()
    expect(usePackStore.getState().rootDir).toBe("/tmp/cur")
  })

  it("安装后读取/解析失败时删掉已装目录", async () => {
    vi.mocked(packFs.readText).mockResolvedValue("{ not json")
    vi.mocked(bundleFs.install).mockResolvedValue({
      dir: "/base/系列",
      manifest,
      entries: [],
    })

    await expect(importSeriesBundle("/f.cards", manifest, "/base")).rejects.toThrow()
    expect(vi.mocked(bundleFs.discardInstall)).toHaveBeenCalledWith("/base/系列")
  })
})
