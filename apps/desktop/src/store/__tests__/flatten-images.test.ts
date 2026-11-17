/**
 * packStore 的「保存时把图片层合并成一张」（flattenImages）行为测试。
 *
 * 覆盖用例：
 * - 保存前自动合并：相邻两张纯图片变成一层，`pack.json` 只引用合并后的新图；
 * - 被取代的原图进回收站，并记 tombstone——撤销回到合并前的快照时能把它们还原；
 * - 原图仍被别处引用时不动它；
 * - 合成失败不连累保存；
 * - 当前选中的图层被合并掉时，选中态转到合并层。
 *
 * 依赖处理：`packFs` 与像素合成 `composeGroup` 整体 mock，只验编排与落盘时机。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    writeBytesAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    copyAsset: vi.fn(async () => ""),
    moveToTrash: vi.fn(async (_root: string, rel: string) => `token:${rel}`),
    restoreFromTrash: vi.fn(async () => {}),
    purgeTrash: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
    isPackDir: vi.fn(async () => true),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    readAssetBytes: vi.fn(async () => new ArrayBuffer(0)),
  },
}))

vi.mock("../../features/flatten/compose", () => ({
  composeGroup: vi.fn(async () => "assets/merged.png"),
}))

import { createLayer, type Effect, type Layer } from "@cardbara/schema"
import { usePackStore } from "../packStore"
import { packFs } from "../../tauri/pack-fs"
import { composeGroup } from "../../features/flatten/compose"

function imageLayer(path: string): Layer {
  const layer = createLayer("图片")
  layer.effects = [
    { id: `e-${path}`, enabled: true, kind: "image", params: { path, x: 0, y: 0, rotation: 0, scale: 1 } } as Effect,
  ]
  return layer
}

/** 每个用例的共同起点：一个绑定到 `/tmp/p`、含一张卡片的空系列。 */
async function seed(): Promise<string> {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  return cardId
}

/** 把指定卡片的图层整体换成给定的这几层。 */
function setLayers(cardId: string, layers: Layer[]): void {
  usePackStore.getState().commit((d) => {
    const card = d.cards.find((c) => c.id === cardId)
    if (card) card.layers = layers
  })
}

function layersOf(cardId: string): Layer[] {
  const card = usePackStore.getState().pack?.cards.find((c) => c.id === cardId)
  return card?.layers ?? []
}

describe("packStore.flattenImages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("保存时把相邻两张图片合成一层，系列里只剩合并后的新图", async () => {
    const cardId = await seed()
    setLayers(cardId, [imageLayer("assets/a.png"), imageLayer("assets/b.png")])

    await usePackStore.getState().save()

    const layers = layersOf(cardId)
    expect(layers).toHaveLength(1)
    const effect = layers[0].effects[0]
    expect(effect.kind).toBe("image")
    if (effect.kind === "image") expect(effect.params.path).toBe("assets/merged.png")
    expect(composeGroup).toHaveBeenCalledTimes(1)
  })

  it("被取代的原图移入回收站并记 tombstone，撤销时能还原", async () => {
    const cardId = await seed()
    setLayers(cardId, [imageLayer("assets/a.png"), imageLayer("assets/b.png")])

    await usePackStore.getState().save()

    expect(vi.mocked(packFs.moveToTrash).mock.calls.map((c) => c[1])).toEqual([
      "assets/a.png",
      "assets/b.png",
    ])
    expect(Object.keys(usePackStore.getState().trashTombstones).sort()).toEqual([
      "assets/a.png",
      "assets/b.png",
    ])

    // 撤销回到合并前：快照又引用原图，reconcileTrash 把它们从回收站取回。
    usePackStore.getState().undo()
    expect(layersOf(cardId)).toHaveLength(2)
    await vi.waitFor(() => expect(packFs.restoreFromTrash).toHaveBeenCalledTimes(2))
  })

  it("撤销之后紧接着的保存不会又把同一组合回去", async () => {
    const cardId = await seed()
    setLayers(cardId, [imageLayer("assets/a.png"), imageLayer("assets/b.png")])
    await usePackStore.getState().save()

    usePackStore.getState().undo()
    // 撤销本身会标脏、触发自动保存——那一次绝不能把用户刚还原的分层又合掉。
    await usePackStore.getState().save()

    expect(layersOf(cardId)).toHaveLength(2)
    expect(vi.mocked(composeGroup).mock.calls).toHaveLength(1)
  })

  it("撤销后改动过这一组，下次保存照常合并", async () => {
    const cardId = await seed()
    setLayers(cardId, [imageLayer("assets/a.png"), imageLayer("assets/b.png")])
    await usePackStore.getState().save()

    usePackStore.getState().undo()
    usePackStore.getState().commit((d) => {
      const card = d.cards.find((c) => c.id === cardId)
      if (card) card.layers[1].opacity = 0.5
    })
    await usePackStore.getState().save()

    expect(layersOf(cardId)).toHaveLength(1)
    expect(composeGroup).toHaveBeenCalledTimes(2)
  })

  it("原图仍被别处引用时留在原地", async () => {
    const cardId = await seed()
    const otherId = usePackStore.getState().addCard(false)!
    usePackStore.getState().commit((d) => {
      const other = d.cards.find((c) => c.id === otherId)
      if (other) other.front = "assets/b.png"
    })
    setLayers(cardId, [imageLayer("assets/a.png"), imageLayer("assets/b.png")])

    await usePackStore.getState().save()

    const moved = vi.mocked(packFs.moveToTrash).mock.calls.map((c) => c[1])
    expect(moved).toEqual(["assets/a.png"])
  })

  it("合成失败不连累保存：原样落盘，图层不动", async () => {
    const cardId = await seed()
    setLayers(cardId, [imageLayer("assets/a.png"), imageLayer("assets/b.png")])
    vi.mocked(composeGroup).mockRejectedValueOnce(new Error("boom"))
    // seed 里的 newPack 已经写过一次 pack.json，这里只数本次保存的那一次。
    vi.mocked(packFs.writeTextAtomic).mockClear()

    await usePackStore.getState().save()

    expect(usePackStore.getState().saveStatus).toBe("saved")
    expect(layersOf(cardId)).toHaveLength(2)
    expect(packFs.writeTextAtomic).toHaveBeenCalledTimes(1)
    expect(packFs.moveToTrash).not.toHaveBeenCalled()
  })

  it("没有可合并的层时不去合成、也不动回收站", async () => {
    const cardId = await seed()
    setLayers(cardId, [imageLayer("assets/a.png")])

    await usePackStore.getState().save()

    expect(composeGroup).not.toHaveBeenCalled()
    expect(packFs.moveToTrash).not.toHaveBeenCalled()
    expect(layersOf(cardId)).toHaveLength(1)
  })

  it("当前选中的图层被合并掉时，选中态转到合并层", async () => {
    const cardId = await seed()
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    setLayers(cardId, [a, b])
    usePackStore.getState().selectLayer(a.id)

    await usePackStore.getState().save()

    const layers = layersOf(cardId)
    expect(usePackStore.getState().selectedLayerId).toBe(layers[0].id)
  })

  it("没选中被合并的图层时，选中态不受影响", async () => {
    const cardId = await seed()
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    setLayers(cardId, [a, b])
    usePackStore.getState().selectLayer(null)

    await usePackStore.getState().save()

    expect(usePackStore.getState().selectedLayerId).toBeNull()
  })
})
