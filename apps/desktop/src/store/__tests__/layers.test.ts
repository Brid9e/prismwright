/**
 * packStore 图层结构操作（增 / 删 / 复制 / 排序 / 启用开关）的行为测试。
 *
 * 覆盖背面路径与「目标不存在时安静空操作」两类边界——后者是 Review Focus 第 1 条。
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
    readAssetBytes: vi.fn(async () => new ArrayBuffer(0)),
  },
}))

import { usePackStore } from "../packStore"
import { defaultLayerName } from "../layer-naming"
import { findLayerById, MAX_NEST_DEPTH } from "@cardbara/schema"
import { toDisplayOrder } from "../../features/layers/order"
import { resolveDrop } from "../../features/layers/drop"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

/** 建一个含单张卡片（预置 1 个图层）的系列，返回卡片 id 与首个图层 id。 */
async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
  return { cardId, layerId: card.layers[0].id }
}

describe("packStore 图层结构操作", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("addLayer 追加图层并选中它", async () => {
    const { cardId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const newId = usePackStore.getState().addLayer(ref)
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(card.layers).toHaveLength(2)
    expect(newId).toBe(card.layers[1].id)
    expect(usePackStore.getState().selectedLayerId).toBe(newId)
  })

  it("addImageLayer 一次提交建层 + 图片效果，并选中新层", async () => {
    const { cardId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const pastBefore = usePackStore.getState().past.length

    const created = usePackStore.getState().addImageLayer(ref)
    expect(created).not.toBeNull()
    if (!created) return

    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(card.layers).toHaveLength(2)
    const layer = card.layers[1]
    expect(layer.id).toBe(created.layerId)
    expect(layer.effects).toHaveLength(1)
    expect(layer.effects[0].id).toBe(created.effectId)
    expect(layer.effects[0].kind).toBe("image")
    expect(usePackStore.getState().selectedLayerId).toBe(created.layerId)
    // 建层与加效果同一个历史点：一次撤销即可完整消失。
    expect(usePackStore.getState().past.length).toBe(pastBefore + 1)
  })

  it("addLayer 到背面时懒创建 pack.back", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    expect(usePackStore.getState().pack!.back).toBeNull()
    const id = usePackStore.getState().addLayer({ kind: "back" })
    const back = usePackStore.getState().pack!.back
    expect(back).not.toBeNull()
    expect(back!.layers).toHaveLength(1)
    expect(back!.layers[0].id).toBe(id)
  })

  it("deleteLayer 移除图层；删掉选中层时清空图层选择", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    usePackStore.getState().selectLayer(layerId)
    usePackStore.getState().deleteLayer(ref, layerId)
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(card.layers).toHaveLength(0)
    expect(usePackStore.getState().selectedLayerId).toBeNull()
  })

  it("duplicateLayer 插在原层之后、id 不同、字段独立", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    // 本例不需要 updateLayer（属 Task 8）：直接经 commit 给源层预置一个非默认字段值，
    // 目的仍是验证复制体确实带着源层的字段值，而不只是新建了一个默认层。
    usePackStore.getState().commit((d) => {
      d.cards.find((c) => c.id === cardId)!.layers[0].holoMix = 0.42
    })
    const copyId = usePackStore.getState().duplicateLayer(ref, layerId)
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(card.layers).toHaveLength(2)
    expect(card.layers[1].id).toBe(copyId)
    expect(card.layers[1].id).not.toBe(layerId)
    expect(card.layers[1].holoMix).toBe(0.42)
    // 深拷贝：改复制体不应影响原层（children 是数组，最容易踩到共享引用）。
    // 注意：这一对图层同属「新」状态，`commit` 自身的 structuredClone 已把二者隔开，
    // 因此本断言抓不到 `duplicateLayer` 里的 shallow spread 回归——
    // 真正咬住它的是下面「与撤销快照互不影响」那条用例。
    card.layers[1].children.push(card.layers[0])
    expect(card.layers[0].children).toEqual([])
  })

  it("duplicateLayer 的复制体与撤销快照互不影响", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const copyId = usePackStore.getState().duplicateLayer(ref, layerId)!

    // 污染复制体的 children。若 `duplicateLayer` 用 shallow spread 复制，复制体将与被
    // `commit` 压入撤销栈的旧 pack 共享同一个 children 数组（commit 压栈的是引用而非快照
    // 拷贝），这次 push 就会写脏历史里的原层。
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    card.layers.find((l) => l.id === copyId)!.children.push(card.layers[0])

    // 撤销回退到复制前的快照：原层必须仍然干净，说明复制体没有把历史写穿。
    usePackStore.getState().undo()
    const restored = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(restored.layers).toHaveLength(1)
    expect(restored.layers[0].children).toEqual([])

    // 重做后复制体自身的改动仍在（上面那次 push 没有被撤销吞掉）。
    usePackStore.getState().redo()
    const again = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(again.layers.find((l) => l.id === copyId)!.children).toHaveLength(1)
  })

  it("moveLayer 在同级内重排", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const b = usePackStore.getState().addLayer(ref)!
    const c = usePackStore.getState().addLayer(ref)!
    // 顶层：把 c（下标 2）挪到下标 0。
    usePackStore.getState().moveLayer(ref, c, null, 0)
    const card = usePackStore.getState().pack!.cards.find((c2) => c2.id === cardId)!
    expect(card.layers.map((l) => l.id)).toEqual([c, layerId, b])
  })

  it("setLayerEnabled 切换启用位", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    usePackStore.getState().setLayerEnabled(ref, layerId, false)
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    expect(card.layers[0].enabled).toBe(false)
  })

  it("未打开系列时所有操作安静空操作", () => {
    const ref = { kind: "card" as const, cardId: "nope" }
    expect(() => {
      usePackStore.getState().addLayer(ref)
      usePackStore.getState().deleteLayer(ref, "x")
      usePackStore.getState().duplicateLayer(ref, "x")
      usePackStore.getState().moveLayer(ref, "x", null, 0)
      usePackStore.getState().setLayerEnabled(ref, "x", false)
    }).not.toThrow()
    expect(usePackStore.getState().pack).toBeNull()
  })

  it("目标卡片/图层不存在时安静空操作，历史栈不长高", async () => {
    const { cardId } = await setup()
    const past = usePackStore.getState().past.length
    const ref = { kind: "card" as const, cardId }
    usePackStore.getState().deleteLayer(ref, "missing")
    usePackStore.getState().moveLayer(ref, "missing", null, 0)
    usePackStore.getState().setLayerEnabled(ref, "missing", false)
    // 系列已打开、但 ref 指向的卡片不存在：canWriteFace 的卡片分支返回 false，
    // addLayer 必须返回 null 且不落历史点（背面分支的懒创建语义不应外溢到卡片）。
    const missing = { kind: "card" as const, cardId: "missing" }
    expect(usePackStore.getState().addLayer(missing)).toBeNull()
    expect(usePackStore.getState().duplicateLayer(missing, "missing")).toBeNull()
    expect(usePackStore.getState().past).toHaveLength(past)
  })
})

/**
 * 图层默认名是**数据**：创建时就写进 `layer.name`，此后拖拽重排不改它。
 *
 * 这里只验证 store 的接线——建的时候就写进去了、新建/复制不与现有层撞名、重排不漂移；
 * 「默认名长什么样」由 `layer-naming.test.ts` 单独钉住，免得两处各写死一份文案。
 */
describe("图层默认名写进数据", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  /** 取某张卡片当前各层的名字（按数组顺序，即渲染层级）。 */
  function names(cardId: string): string[] {
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    return card.layers.map((l) => l.name)
  }

  it("新建卡片预置的图层带上默认名，而不是空串", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    const cardId = usePackStore.getState().addCard(false)!
    expect(names(cardId)).toEqual([defaultLayerName(1)])
  })

  it("addLayer 追加的新层也有默认名，且与现有各层都不重名", async () => {
    const { cardId } = await setup()
    const ref = { kind: "card" as const, cardId }
    usePackStore.getState().addLayer(ref)
    usePackStore.getState().addLayer(ref)
    const got = names(cardId)
    expect(got).toHaveLength(3)
    expect(new Set(got).size).toBe(3)
  })

  it("拖拽重排之后名字仍跟着原来的图层走", async () => {
    // 被报的 bug：默认名下把一层拖到别的位置，显示名就改口叫新位置的编号。名字成了数据
    // 之后，重排只换位置、不换名字——「两层的名字交换了顺序」才是正确的观察结果。
    const { cardId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const added = usePackStore.getState().addLayer(ref)!
    const before = names(cardId)
    // 两个名字必须不同，否则上面那条断言就失去了分辨力（同名交换后看不出变化）。
    expect(new Set(before).size).toBe(before.length)
    usePackStore.getState().moveLayer(ref, added, null, 0)
    expect(names(cardId)).toEqual([before[1], before[0]])
  })

  it("删掉中间层后再新建，不与剩下的名字撞号", async () => {
    // 按「层数 + 1」取名会在这里撞车：删掉「图层 2」后还剩两层，新层又叫「图层 3」，
    // 而列表里已经有一个「图层 3」。取「第一个空号」才拿回「图层 2」，两行不同名。
    const { cardId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const second = usePackStore.getState().addLayer(ref)!
    usePackStore.getState().addLayer(ref)
    usePackStore.getState().deleteLayer(ref, second)
    usePackStore.getState().addLayer(ref)
    const got = names(cardId)
    expect(new Set(got).size).toBe(got.length)
    expect(got).toContain(defaultLayerName(2))
    expect(got).toContain(defaultLayerName(3))
  })

  it("duplicateLayer 的复制体换一个新的默认名，不与原层同名", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const copyId = usePackStore.getState().duplicateLayer(ref, layerId)!
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    const copy = card.layers.find((l) => l.id === copyId)!
    const original = card.layers.find((l) => l.id === layerId)!
    expect(copy.name).not.toBe(original.name)
    // 「图层 1」还被原层占着，复制体应取 2。
    expect(copy.name).toBe(defaultLayerName(2))
  })

  it("背面（懒创建）的新层同样带默认名", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    usePackStore.getState().addLayer({ kind: "back" })
    expect(usePackStore.getState().pack!.back!.layers.map((l) => l.name)).toEqual([
      defaultLayerName(1),
    ])
  })
})

/**
 * 嵌套移动：重挂父级、同级重排、拒绝超深、拒绝拖进自身子树。
 *
 * 这些用例直接经 `commit` 摆好树形结构，再调用 `moveLayer`，断言树的形状。
 */
describe("packStore moveLayer 嵌套", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  /** 取某卡片顶层图层 id 列表。 */
  function topIds(cardId: string): string[] {
    return usePackStore
      .getState()
      .pack!.cards.find((c) => c.id === cardId)!
      .layers.map((l) => l.id)
  }
  /** 取某层的子层 id 列表。 */
  function childIds(cardId: string, layerId: string): string[] {
    const layer = findLayerById(
      usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!.layers,
      layerId,
    )!
    return layer.children.map((l) => l.id)
  }

  it("把顶层图层挂到另一层之下成为子层", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const child = usePackStore.getState().addLayer(ref)!
    usePackStore.getState().moveLayer(ref, child, layerId, 0)
    expect(topIds(cardId)).toEqual([layerId])
    expect(childIds(cardId, layerId)).toEqual([child])
  })

  it("把子层提回顶层", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const child = usePackStore.getState().addLayer(ref)!
    usePackStore.getState().moveLayer(ref, child, layerId, 0)
    usePackStore.getState().moveLayer(ref, child, null, 0)
    expect(topIds(cardId)).toEqual([child, layerId])
    expect(childIds(cardId, layerId)).toEqual([])
  })

  it("拒绝把层拖进自己的子树", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const child = usePackStore.getState().addLayer(ref)!
    usePackStore.getState().moveLayer(ref, child, layerId, 0)
    // 把 layerId 挂到其子层 child 之下 —— 环，应被拒。
    usePackStore.getState().moveLayer(ref, layerId, child, 0)
    expect(topIds(cardId)).toEqual([layerId])
    expect(childIds(cardId, layerId)).toEqual([child])
  })

  it("拒绝造成深度超限的移动", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    // 沿 layerId 往下挂 MAX_NEST_DEPTH 层，得到一条满深链。
    let parent = layerId
    for (let i = 0; i < MAX_NEST_DEPTH; i++) {
      const n = usePackStore.getState().addLayer(ref)!
      usePackStore.getState().moveLayer(ref, n, parent, 0)
      parent = n
    }
    // 再挂一个会超过上限：应被拒，树形不变。
    const extra = usePackStore.getState().addLayer(ref)!
    const before = usePackStore.getState().pack
    usePackStore.getState().moveLayer(ref, extra, parent, 0)
    expect(usePackStore.getState().pack).toBe(before) // 未提交，引用不变
    expect(topIds(cardId)).toContain(extra)
  })
})

/**
 * 落点解析与移动执行串联：把 `resolveDrop` 的返回值直接喂给 `moveLayer`。
 *
 * `drop.test.ts` 只按固定行数组钉住映射表，这里验证它接上真实数据结构后确实「换得对」——
 * 展示顺序是数组的**倒序**，二者之间一旦方向搞反，就是此前「拖到上一行上缘却原地不动」的根因，
 * 而只测映射表的分支覆盖抓不到它。
 */
describe("resolveDrop 结果经 moveLayer 落地", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  /** 某卡片顶层图层 id 列表（即数组顺序，非展示顺序）。 */
  function topIds(cardId: string): string[] {
    return usePackStore
      .getState()
      .pack!.cards.find((c) => c.id === cardId)!
      .layers.map((l) => l.id)
  }

  /** 取某卡片当前顶层图层的展示行（展示顺序，顶行在前）。 */
  function displayRows(cardId: string) {
    const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
    return toDisplayOrder(card.layers)
  }

  it("拖到上一行上缘 = 真的换到它之前；拖到其下缘 = 原地不动", async () => {
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const b = usePackStore.getState().addLayer(ref)!
    // 数组 [layerId, b] → 展示顺序倒序 [b, layerId]：b 是顶行，layerId 紧随其下。

    // (1) layerId 拖到 b 的「上缘」（视觉更高一层）→ 应真的上移，换成数组 [b, layerId]。
    const toTop = resolveDrop(displayRows(cardId), layerId, b, "top")!
    usePackStore.getState().moveLayer(ref, layerId, toTop.parentId, toTop.index)
    expect(topIds(cardId)).toEqual([b, layerId])

    // (2) 复位成 [layerId, b] 后，再拖到 b 的「下缘」——layerId 本就紧贴 b 下方，应原地不动。
    usePackStore.getState().moveLayer(ref, layerId, null, 0)
    expect(topIds(cardId)).toEqual([layerId, b])
    const toBottom = resolveDrop(displayRows(cardId), layerId, b, "bottom")!
    usePackStore.getState().moveLayer(ref, layerId, toBottom.parentId, toBottom.index)
    expect(topIds(cardId)).toEqual([layerId, b])
  })

  it("拖到某行中段成为其子层后，展示顺序里子层排在父层之下（父在上）", async () => {
    // 被报的 bug：做成子层后，展示顺序把整棵子树翻到父行**上方**，于是子层显示在父层上面。
    const { cardId, layerId } = await setup()
    const ref = { kind: "card" as const, cardId }
    const b = usePackStore.getState().addLayer(ref)!
    const target = resolveDrop(displayRows(cardId), b, layerId, "middle")!
    usePackStore.getState().moveLayer(ref, b, target.parentId, target.index)

    const rows = displayRows(cardId)
    // 父层 layerId 必须排在子层 b 之前（展示顺序中下标更小 = 更靠上）。
    expect(rows.findIndex((r) => r.id === layerId)).toBeLessThan(rows.findIndex((r) => r.id === b))
    // 且子层缩进一层。
    expect(rows.find((r) => r.id === b)!.depth).toBe(1)
  })
})
