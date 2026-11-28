/**
 * packStore 回收站协调（trash）相关行为测试。
 *
 * 覆盖用例：
 * - `addCard` 的编号：同一列表内递增，普通与隐藏款各自独立编号；
 * - `deleteCard` 的顺序与容错：先把资源移入回收站再改数据；单个文件移动失败不影响删除，
 *   且失败的文件不产生 tombstone，成功者按「相对路径 -> token」记录；
 * - `reconcileTrash`（经 `undo` 触发）：只恢复「当前 pack 再次引用」的资源，
 *   完成后从 tombstone 表中移除对应条目。
 *
 * 依赖处理：`packFs` 整体 mock，测试只关注「何时移入回收站 / 恢复、tombstone 表如何变化」，
 * 不触碰真实文件系统与 `invoke`。
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
  },
}))

import { usePackStore } from "../packStore"
import { packFs } from "../../tauri/pack-fs"

/** 每个用例的共同起点：一个绑定到 `/tmp/p` 的空系列。 */
async function seed() {
  await usePackStore.getState().newPack("P", "/tmp/p")
}

/** 给指定卡片设置卡面图与首个图层的图蒙版，使其拥有两个可回收的资源路径。 */
function giveRels(cardId: string, front: string, mask: string) {
  usePackStore.getState().commit((d) => {
    const card = d.cards.find((c) => c.id === cardId)
    if (!card) return
    // 图片作为一条 image 效果挂在首个图层上；图蒙版作为一条 imageMask 效果，其 path 即待回收资源。
    card.layers[0].effects.push({
      kind: "image",
      id: "img",
      enabled: true,
      params: {
        path: front,
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1,
        fit: "contain",
        bumpStrength: 0,
        bumpDetail: 0.01,
        bumpFlow: 0.5,
        bumpLight: 1,
        bumpLightAngle: 127,
        bumpLightColor: "#ffffff",
        bumpInvert: false,
        normalPath: "",
        normalFlipY: false,
      },
    })
    card.layers[0].effects.push({
      kind: "imageMask",
      id: "im",
      enabled: true,
      params: {
        path: mask,
        source: "image",
        color: "#808080",
        mode: "line",
        edge0: 0,
        edge1: 0.95,
        invert: false,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        fit: "stretch",
      },
    })
  })
}

describe("packStore 回收站协调", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
    await seed()
  })

  it("addCard 在普通与隐藏款列表内各自独立编号", () => {
    const first = usePackStore.getState().addCard(false)
    const second = usePackStore.getState().addCard(false)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(usePackStore.getState().pack!.cards.map((c) => c.num)).toEqual([1, 2])
    // 隐藏款编号独立，从 1 重新开始，不受普通列表影响。
    usePackStore.getState().addCard(true)
    expect(usePackStore.getState().pack!.hiddenCards.map((c) => c.num)).toEqual([1])
  })

  it("deleteCard 先移入回收站再删除；单个文件失败不产生 tombstone", async () => {
    const front = "assets/cards/x/front.png"
    const mask = "assets/cards/x/masks/m.png"
    const id = usePackStore.getState().addCard(false)!
    giveRels(id, front, mask)

    // 卡面图移动成功、蒙版失败：验证「尽力而为、按文件粒度」的容错。
    vi.mocked(packFs.moveToTrash).mockImplementation(async (_root, rel) => {
      if (rel === front) return "tok-front"
      throw new Error("missing")
    })

    await usePackStore.getState().deleteCard(id)

    const s = usePackStore.getState()
    // 卡片已从两个列表移除。
    expect(s.pack!.cards.find((c) => c.id === id)).toBeUndefined()
    expect(s.pack!.hiddenCards.find((c) => c.id === id)).toBeUndefined()
    // 只有成功移入回收站的文件留下 tombstone，失败者不产生。
    expect(s.trashTombstones).toEqual({ [front]: "tok-front" })
  })

  it("undo 触发的 reconcileTrash 只恢复被再次引用的资源并清除对应 tombstone", async () => {
    const front = "assets/cards/x/front.png"
    const mask = "assets/cards/x/masks/m.png"
    const id = usePackStore.getState().addCard(false)!
    giveRels(id, front, mask)

    // 两个文件都成功移入回收站，token 与路径一一对应，便于断言恢复参数。
    vi.mocked(packFs.moveToTrash).mockImplementation(async (_root, rel) => `tok:${rel}`)
    await usePackStore.getState().deleteCard(id)
    expect(usePackStore.getState().trashTombstones).toEqual({
      [front]: `tok:${front}`,
      [mask]: `tok:${mask}`,
    })

    // undo 让被删卡片复活，其资源仍在回收站中；reconcileTrash 以 void 触发，
    // 故用 vi.waitFor 轮询等待其「恢复 + 回写 tombstone」落定。
    usePackStore.getState().undo()
    await vi.waitFor(() => {
      expect(usePackStore.getState().trashTombstones).toEqual({})
    })

    // 两个被再次引用的 rel 都被还原，且参数为原始 (root, token, rel)。
    expect(packFs.restoreFromTrash).toHaveBeenCalledWith("/tmp/p", `tok:${front}`, front)
    expect(packFs.restoreFromTrash).toHaveBeenCalledWith("/tmp/p", `tok:${mask}`, mask)
    expect(packFs.restoreFromTrash).toHaveBeenCalledTimes(2)
  })
})

describe("删除卡片时清理卡册排版", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
    await seed()
  })

  it("被删卡片原来的格子留空，不影响别的卡", async () => {
    const store = usePackStore.getState()
    const first = store.addCard(false)!
    const second = store.addCard(false)!
    store.commit((d) => {
      const slots = new Array<string | null>(9).fill(null)
      slots[0] = first
      slots[4] = second
      d.album = { pages: [slots] }
    })

    await usePackStore.getState().deleteCard(first)

    const pages = usePackStore.getState().pack!.album.pages
    expect(pages[0][0]).toBe(null)
    expect(pages[0][4]).toBe(second)
  })
})
