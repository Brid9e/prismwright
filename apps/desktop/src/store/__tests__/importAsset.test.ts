/**
 * 资源导入：图层 image / imageMask 的路径写入与失败处理。
 *
 * 卡面已没有独立前景图；所有图片都通过图层效果导入。
 */
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

import { findLayerById } from "@prismwright/schema"
import { usePackStore } from "../packStore"
import { packFs } from "../../tauri/pack-fs"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
  return { cardId, layerId: card.layers[0].id, ref: { kind: "card" as const, cardId } }
}

const layerEffects = (layerId: string) =>
  findLayerById(usePackStore.getState().pack!.cards[0].layers, layerId)!.effects

describe("packStore importAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("导入图片：写到目标 image 效果的 params.path", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const effectId = layerEffects(layerId).find((e) => e.kind === "image")!.id
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "imageEffect", layerId, effectId }, "/src/art/帆.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rel).toMatch(/^assets\/[0-9a-f-]{36}\.png$/)
    expect(packFs.readFileBytes).toHaveBeenCalledWith("/src/art/帆.png")
    expect(packFs.writeBytesAtomic).toHaveBeenCalledWith("/tmp/p", result.rel, expect.any(Uint8Array))
    const image = layerEffects(layerId).find((e) => e.id === effectId)
    expect(image?.kind === "image" ? image.params.path : "").toBe(result.rel)
  })

  it("读取源文件失败时退回原样拷贝", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const effectId = layerEffects(layerId).find((e) => e.kind === "image")!.id
    vi.mocked(packFs.readFileBytes).mockRejectedValueOnce(new Error("文件过大"))
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "imageEffect", layerId, effectId }, "/src/art/帆.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(packFs.copyAsset).toHaveBeenCalledWith("/src/art/帆.png", "/tmp/p", result.rel)
  })

  it("导入法线图：写 normalPath，并把强度从 0 抬到 1", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const effectId = layerEffects(layerId).find((e) => e.kind === "image")!.id
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "normalEffect", layerId, effectId }, "/src/art/n.png")
    expect(result.ok).toBe(true)
    const image = layerEffects(layerId).find((e) => e.id === effectId)
    if (!image || image.kind !== "image") throw new Error("image missing")
    expect(result.ok && image.params.normalPath).toBe(result.ok ? result.rel : "")
    expect(image.params.bumpStrength).toBe(1)
  })

  it("导入图蒙版：写入目标 imageMask 效果的 params.path", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "imageMask")
    const effectId = layerEffects(layerId).find((e) => e.kind === "imageMask")!.id
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId, effectId }, "/src/art/m.png")
    expect(result.ok).toBe(true)
    const mask = layerEffects(layerId).find((e) => e.id === effectId)
    expect(result.ok && mask?.kind === "imageMask" ? mask.params.path : "").toBe(
      result.ok ? result.rel : "",
    )
  })

  it("目标图层 / 效果已不存在：不拷贝文件，返回 no-target", async () => {
    const { ref, layerId } = await setup()
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "imageEffect", layerId, effectId: "missing" }, "/src/art/帆.png")
    expect(result).toEqual({ ok: false, reason: "no-target" })
    expect(packFs.copyAsset).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("不支持的扩展名：拒绝且不写盘", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const effectId = layerEffects(layerId).find((e) => e.kind === "image")!.id
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "imageEffect", layerId, effectId }, "/src/art/帆.svg")
    expect(result).toEqual({ ok: false, reason: "unsupported-format" })
    expect(packFs.copyAsset).not.toHaveBeenCalled()
  })
})
