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
  bundleFs: {
    extract: vi.fn(),
    cleanup: vi.fn(async () => {}),
  },
  BundleInvalidError: class extends Error {},
}))

import { createCard } from "@prismwright/schema"
import { usePackStore } from "../../../store/packStore"
import { packFs } from "../../../tauri/pack-fs"
import { bundleFs } from "../../../tauri/bundle"
import { importCardBundle, remapAssetPaths } from "../importCard"
import type { BundleManifest } from "../model"

const manifest: BundleManifest = {
  format: "prismwright-bundle",
  version: 1,
  kind: "card",
  includesHistory: false,
  createdAt: "2026-11-06T00:00:00.000Z",
  appVersion: "0.1.0",
  series: { id: "s1", name: "源系列", cardCount: 1 },
  card: { id: "c1", name: "星辰", list: "cards" },
}

const sourceCard = { ...createCard(1, "图层 1"), name: "星辰" }
sourceCard.layers[0].effects = [{ id: "img", enabled: true, kind: "image", params: { path: "assets/a.png", x: 0, y: 0, rotation: 0, scale: 1, fit: "contain", bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false } }]

describe("remapAssetPaths", () => {
  it("递归替换字符串，未命中的保持原样", () => {
    const input = { front: "assets/a.png", other: "assets/b.png", list: ["assets/a.png"] }
    const out = remapAssetPaths(input, new Map([["assets/a.png", "assets/imported/x-a.png"]]))
    expect(out).toEqual({
      front: "assets/imported/x-a.png",
      other: "assets/b.png",
      list: ["assets/imported/x-a.png"],
    })
  })
})

describe("importCardBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("同名素材字节不同时改写到 assets/imported 并重写卡内路径", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(bundleFs.extract).mockResolvedValue({
      dir: "/tmp/bundle-1",
      manifest,
      entries: ["manifest.json", "card.json", "assets/a.png"],
    })
    vi.mocked(packFs.readText).mockResolvedValue(JSON.stringify(sourceCard))
    vi.mocked(packFs.pathExists).mockResolvedValue(true)
    vi.mocked(packFs.readFileBytes).mockImplementation(async (p) =>
      p.startsWith("/tmp/bundle-1") ? new Uint8Array([1]).buffer : new Uint8Array([2]).buffer,
    )

    await importCardBundle("/f.card", manifest)

    const cards = usePackStore.getState().pack!.cards
    const copy = cards[cards.length - 1]
    const image = copy.layers[0].effects.find((e) => e.kind === "image")
    const path = image?.kind === "image" ? image.params.path : ""
    expect(path).toMatch(/^assets\/imported\/[0-9a-f-]{36}-a\.png$/)
    expect(vi.mocked(packFs.copyAsset)).toHaveBeenCalledWith(
      "/tmp/bundle-1/assets/a.png",
      "/tmp/p",
      path,
    )
    expect(vi.mocked(bundleFs.cleanup)).toHaveBeenCalledWith("/tmp/bundle-1")
  })

  it("素材路径越界时拒绝导入，不读也不拷", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(bundleFs.extract).mockResolvedValue({
      dir: "/tmp/bundle-1",
      manifest,
      entries: [],
    })
    vi.mocked(packFs.readText).mockResolvedValue(
      JSON.stringify({ ...sourceCard, layers: [{ ...sourceCard.layers[0], effects: [{ ...sourceCard.layers[0].effects[0], params: { ...sourceCard.layers[0].effects[0].params, path: "../secret.png" } }] }] }),
    )

    await expect(importCardBundle("/f.card", manifest)).rejects.toThrow()
    expect(vi.mocked(packFs.readFileBytes)).not.toHaveBeenCalled()
    expect(vi.mocked(packFs.copyAsset)).not.toHaveBeenCalled()
    expect(vi.mocked(bundleFs.cleanup)).toHaveBeenCalledWith("/tmp/bundle-1")
  })

  it("预检发现工程内缺素材时，不往系列里拷任何文件", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(bundleFs.extract).mockResolvedValue({
      dir: "/tmp/bundle-1",
      manifest,
      entries: [],
    })
    vi.mocked(packFs.readText).mockResolvedValue(JSON.stringify(sourceCard))
    vi.mocked(packFs.pathExists).mockResolvedValue(false)

    await expect(importCardBundle("/f.card", manifest)).rejects.toThrow()
    expect(vi.mocked(packFs.copyAsset)).not.toHaveBeenCalled()
  })

  it("拷贝中断时把已拷进系列的文件移入回收站", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(bundleFs.extract).mockResolvedValue({
      dir: "/tmp/bundle-1",
      manifest,
      entries: [],
    })
    vi.mocked(packFs.readText).mockResolvedValue(
      JSON.stringify({
        ...sourceCard,
        layers: [{ ...sourceCard.layers[0], effects: [...sourceCard.layers[0].effects, { id: "e1", kind: "imageMask", params: { path: "assets/m.png" } }] as any }],
      }),
    )
    // 工程里的源文件都在，目标系列里都没有。
    vi.mocked(packFs.pathExists).mockImplementation(async (p) => p.startsWith("/tmp/bundle-1"))
    vi.mocked(packFs.copyAsset)
      .mockResolvedValueOnce("/tmp/p/assets/a.png")
      .mockRejectedValueOnce(new Error("disk full"))

    await expect(importCardBundle("/f.card", manifest)).rejects.toThrow()
    expect(vi.mocked(packFs.moveToTrash)).toHaveBeenCalledWith("/tmp/p", "assets/m.png")
  })
})
