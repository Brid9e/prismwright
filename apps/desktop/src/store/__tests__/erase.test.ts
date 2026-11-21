/**
 * 擦除图提交（`commitEraseImage`）的行为测试。
 *
 * 重点：每次提交都写到一个**全新**路径。擦除图是「内容随路径恒定」的资源——
 * 渲染器的纹理缓存以路径为键且永不过期（同 `importAsset` 文档里那条约束），
 * 历史快照也只存路径字符串。原地覆盖同一路径会同时坏掉两件事：
 *
 * - 提交后预览仍命中旧纹理 → 新笔迹不生效（用户看到「还是上次擦除的效果」）；
 * - 撤销回到同一路径，而文件已被覆盖成新像素 → 撤销等于没做（擦除没进撤销栈）。
 *
 * 依赖处理：`packFs` 整体 mock，测试只关心路径选择、历史点与失败处理。
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
import { usePackStore, type FaceRef } from "../packStore"
import { packFs } from "../../tauri/pack-fs"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

/** 建一个带图层级 `maskErase` 效果的系列；返回它的引用与效果 id。 */
async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
  const layerId = card.layers[0].id
  const ref: FaceRef = { kind: "card", cardId }
  usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "maskErase")
  const effectId = findLayerById(usePackStore.getState().pack!.cards[0].layers, layerId)!.effects.find(
    (e) => e.kind === "maskErase",
  )!.id
  return { ref, layerId, effectId }
}

const bytes = () => new Uint8Array([1, 2, 3])

/** 当前擦除图路径（效果挂在第一张卡的 `layerId` 上）。 */
function erasePath(layerId: string, effectId: string): string {
  const effect = findLayerById(usePackStore.getState().pack!.cards[0].layers, layerId)!.effects.find(
    (e) => e.id === effectId,
  )
  return effect?.kind === "maskErase" ? effect.params.path : "<missing>"
}

describe("packStore commitEraseImage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("提交擦除：写到 assets/<uuid>.png 并写回效果的 path", async () => {
    const { ref, layerId, effectId } = await setup()
    const result = await usePackStore
      .getState()
      .commitEraseImage(ref, { scope: "layer", layerId }, effectId, bytes())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.path).toMatch(/^assets\/[0-9a-f-]{36}\.png$/)
    expect(packFs.writeBytesAtomic).toHaveBeenCalledWith("/tmp/p", result.path, bytes())
    expect(erasePath(layerId, effectId)).toBe(result.path)
  })

  // 本次报障的核心：第二次擦除若复用第一次的路径，缓存与历史都会停在旧像素上。
  it("连续两次提交落在两个不同路径，旧文件不被覆盖", async () => {
    const { ref, layerId, effectId } = await setup()
    const target = { scope: "layer" as const, layerId }
    const first = await usePackStore.getState().commitEraseImage(ref, target, effectId, bytes())
    const second = await usePackStore.getState().commitEraseImage(ref, target, effectId, bytes())

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.path).not.toBe(first.path)
    // 旧路径只被写过一次（第一次提交），从不是第二次提交的落点。
    const written = vi.mocked(packFs.writeBytesAtomic).mock.calls.map((c) => c[1])
    expect(written).toEqual([first.path, second.path])
    expect(erasePath(layerId, effectId)).toBe(second.path)
  })

  it("两次提交各是一个历史点，撤销回到上一张擦除图", async () => {
    const { ref, layerId, effectId } = await setup()
    const target = { scope: "layer" as const, layerId }
    const pastBefore = usePackStore.getState().past.length
    const first = await usePackStore.getState().commitEraseImage(ref, target, effectId, bytes())
    const second = await usePackStore.getState().commitEraseImage(ref, target, effectId, bytes())
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    // 背靠背提交不能落进同一个合并窗口：每次擦除都必须是独立一步。
    expect(usePackStore.getState().past).toHaveLength(pastBefore + 2)

    usePackStore.getState().undo()
    expect(erasePath(layerId, effectId)).toBe(first.path)

    usePackStore.getState().redo()
    expect(erasePath(layerId, effectId)).toBe(second.path)
  })

  it("写入失败时返回 write-failed，path 与历史都不动", async () => {
    const { ref, layerId, effectId } = await setup()
    const pastBefore = usePackStore.getState().past.length
    const statusBefore = usePackStore.getState().saveStatus
    vi.mocked(packFs.writeBytesAtomic).mockRejectedValueOnce(new Error("磁盘已满"))

    const result = await usePackStore
      .getState()
      .commitEraseImage(ref, { scope: "layer", layerId }, effectId, bytes())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("write-failed")
    expect(erasePath(layerId, effectId)).toBe("")
    expect(usePackStore.getState().past).toHaveLength(pastBefore)
    expect(usePackStore.getState().saveStatus).toBe(statusBefore)
  })

  it("目标效果不存在或不是 maskErase 时返回 no-target，且不写文件", async () => {
    const { ref, layerId } = await setup()
    const missing = await usePackStore
      .getState()
      .commitEraseImage(ref, { scope: "layer", layerId }, "nope", bytes())
    expect(missing).toEqual({ ok: false, reason: "no-target" })

    // 挂一条非 maskErase 效果：它的 id 不该被接受。
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "gradient")
    const gradientId = findLayerById(usePackStore.getState().pack!.cards[0].layers, layerId)!.effects.find(
      (e) => e.kind === "gradient",
    )!.id
    const wrongKind = await usePackStore
      .getState()
      .commitEraseImage(ref, { scope: "layer", layerId }, gradientId, bytes())
    expect(wrongKind).toEqual({ ok: false, reason: "no-target" })
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("未打开系列时返回 no-pack", async () => {
    const result = await usePackStore
      .getState()
      .commitEraseImage({ kind: "back" }, { scope: "face" }, "e", bytes())
    expect(result).toEqual({ ok: false, reason: "no-pack" })
  })

  // 落盘是异步的：等待期间目标可能被删除。与 importAsset 同一口径——已落盘的文件刻意保留，
  // 但绝不能把路径 commit 到一个已经消失的效果上（那会留下悬空引用与一个空历史点）。
  it("写入期间目标图层被删除：返回 no-target，不留历史点", async () => {
    const { ref, layerId, effectId } = await setup()
    let pastAfterDelete = -1
    vi.mocked(packFs.writeBytesAtomic).mockImplementationOnce(async () => {
      usePackStore.getState().deleteLayer(ref, layerId)
      pastAfterDelete = usePackStore.getState().past.length
    })

    const result = await usePackStore
      .getState()
      .commitEraseImage(ref, { scope: "layer", layerId }, effectId, bytes())

    expect(result).toEqual({ ok: false, reason: "no-target" })
    expect(usePackStore.getState().past).toHaveLength(pastAfterDelete)
    expect(usePackStore.getState().pack!.cards[0].layers).toHaveLength(0)
  })
})
