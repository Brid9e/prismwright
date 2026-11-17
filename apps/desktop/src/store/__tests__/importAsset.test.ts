/**
 * 资源导入与卡片排序的行为测试。
 *
 * 重点：唯一路径（不覆盖既有文件）、扩展名白名单、以及卡片序号连续性。
 *
 * 导入路径现在先经 `features/assets/compress`：小图原样写入、大图压缩后写入；读不出源文件
 * 时退回 Rust 侧的原样拷贝。压缩内部（解码 / 画布 / 选档）在 `compress.test.ts` 里单独测，
 * 这里只钉住 store 这一层的分支与失败处理。
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

import { findLayerById } from "@cardbara/schema"
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

describe("packStore importAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("导入卡面图：写入 front 并落到 assets/<uuid>.<ext>", async () => {
    const { ref } = await setup()
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "front" }, "/src/art/帆.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rel).toMatch(/^assets\/[0-9a-f-]{36}\.png$/)
    // 小图（≤ 上限）原样写入：读到的字节不重编码，扩展名沿用源文件。
    expect(packFs.readFileBytes).toHaveBeenCalledWith("/src/art/帆.png")
    expect(packFs.writeBytesAtomic).toHaveBeenCalledWith("/tmp/p", result.rel, expect.any(Uint8Array))
    expect(packFs.copyAsset).not.toHaveBeenCalled()
    expect(usePackStore.getState().pack!.cards[0].front).toBe(result.rel)
  })

  // 源文件读不出来（超大、权限、被占用）时退回 Rust 侧原样拷贝——压缩是增强，不能变成
  // 「以前能导入、现在导不进来」。
  it("读取源文件失败时退回原样拷贝", async () => {
    const { ref } = await setup()
    vi.mocked(packFs.readFileBytes).mockRejectedValueOnce(new Error("文件过大"))
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "front" }, "/src/art/帆.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(packFs.copyAsset).toHaveBeenCalledWith("/src/art/帆.png", "/tmp/p", result.rel)
  })

  it("导入图蒙版：写入目标 imageMask 效果的 params.path", async () => {
    const { ref, layerId } = await setup()
    // 先给图层挂一条 imageMask 效果，拿到它的 id——资源要落到这条效果的 path / 而非图层字段上。
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "imageMask")
    const effectId = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      layerId,
    )!.effects.find((e) => e.kind === "imageMask")!.id

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId, effectId }, "/src/mask.webp")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const effect = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      layerId,
    )!.effects.find((e) => e.id === effectId)
    expect(effect?.kind === "imageMask" && effect.params.path).toBe(result.rel)
  })

  it("导入卡面图蒙版：写入卡面 effects 里的 imageMask（layerId 为 null）", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "imageMask")
    const effectId = usePackStore
      .getState()
      .pack!.cards[0].effects.find((e) => e.kind === "imageMask")!.id

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId: null, effectId }, "/src/face-mask.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const effect = usePackStore.getState().pack!.cards[0].effects.find((e) => e.id === effectId)
    expect(effect?.kind === "imageMask" && effect.params.path).toBe(result.rel)
  })

  it("导入图片效果：写入 image 效果的 params.path", async () => {
    const { ref } = await setup()
    const created = usePackStore.getState().addImageLayer(ref)!
    const result = await usePackStore
      .getState()
      .importAsset(
        ref,
        { kind: "imageEffect", layerId: created.layerId, effectId: created.effectId },
        "/src/pic.webp",
      )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const effect = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      created.layerId,
    )!.effects.find((e) => e.id === created.effectId)
    expect(effect?.kind === "image" && effect.params.path).toBe(result.rel)
  })

  it("导入卡面法线图：写入 frontNormalPath，首次选择时把强度抬到 1", async () => {
    const { ref } = await setup()
    // 默认强度是 0：若只在选图时不抬强度，画面毫无变化，用户会以为「选了没生效」。
    expect(usePackStore.getState().pack!.cards[0].frontBumpStrength).toBe(0)

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "faceNormal" }, "/src/normal.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const card = usePackStore.getState().pack!.cards[0]
    expect(card.frontNormalPath).toBe(result.rel)
    expect(card.frontBumpStrength).toBe(1)
    // 卡面主图不受影响：法线图是独立字段，不是 front。
    expect(card.front).toBe("")
  })

  // 用户已经调过强度、或换了一张法线图时，强度是他自己的参数，不该被重置。
  it("已有法线图时再导入，不改动强度", async () => {
    const { ref } = await setup()
    usePackStore
      .getState()
      .updateFace(ref, { frontNormalPath: "assets/old-n.png", frontBumpStrength: 2.5 })

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "faceNormal" }, "/src/normal.png")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const card = usePackStore.getState().pack!.cards[0]
    expect(card.frontNormalPath).toBe(result.rel)
    expect(card.frontBumpStrength).toBe(2.5)
  })

  it("导入图片效果的法线图：写入 params.normalPath，首次选择时把强度抬到 1", async () => {
    const { ref } = await setup()
    const created = usePackStore.getState().addImageLayer(ref)!
    const result = await usePackStore
      .getState()
      .importAsset(
        ref,
        { kind: "normalEffect", layerId: created.layerId, effectId: created.effectId },
        "/src/normal.png",
      )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const effect = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      created.layerId,
    )!.effects.find((e) => e.id === created.effectId)
    expect(effect?.kind === "image" && effect.params.normalPath).toBe(result.rel)
    expect(effect?.kind === "image" && effect.params.bumpStrength).toBe(1)
    // 主图路径不被法线图覆盖。
    expect(effect?.kind === "image" && effect.params.path).toBe("")
  })

  it("normalEffect 目标指向 imageMask 效果时返回 no-target", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "imageMask")
    const effectId = findLayerById(usePackStore.getState().pack!.cards[0].layers, layerId)!
      .effects.find((e) => e.kind === "imageMask")!.id

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "normalEffect", layerId, effectId }, "/src/normal.png")
    expect(result).toEqual({ ok: false, reason: "no-target" })
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("imageEffect 目标指向非 image 效果时返回 no-target 且不拷贝", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "imageMask")
    const effectId = findLayerById(usePackStore.getState().pack!.cards[0].layers, layerId)!
      .effects[0].id

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "imageEffect", layerId, effectId }, "/src/pic.png")
    expect(result).toEqual({ ok: false, reason: "no-target" })
    expect(packFs.readFileBytes).not.toHaveBeenCalled()
    expect(packFs.copyAsset).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("同一源文件导入两次：两个不同相对路径，且各自指向自己那份", async () => {
    const { ref } = await setup()
    // 第二张卡作为第二个消费方：只有「同一个源文件、两个目标各自持有一份」才咬得住
    // 覆盖式命名——用两个**不同**源文件做对比时，按 basename 取名的实现也会通过。
    const secondCardId = usePackStore.getState().addCard(false)!
    const secondRef = { kind: "card" as const, cardId: secondCardId }

    const a = await usePackStore.getState().importAsset(ref, { kind: "front" }, "/src/art/帆.png")
    const b = await usePackStore
      .getState()
      .importAsset(secondRef, { kind: "front" }, "/src/art/帆.png")

    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    // 两次导入同一源文件必须产出两个互不覆盖的资源。
    expect(a.rel).not.toBe(b.rel)
    // 且两张卡片各自指向自己那份，而不是双双指向后写入的那个路径。
    const cards = usePackStore.getState().pack!.cards
    expect(cards[0].front).toBe(a.rel)
    expect(cards[1].front).toBe(b.rel)
    expect(cards[0].front).not.toBe(cards[1].front)
  })

  it("拒绝白名单之外的扩展名，且不拷贝", async () => {
    const { ref } = await setup()
    const result = await usePackStore.getState().importAsset(ref, { kind: "front" }, "/src/x.gif")
    expect(result).toEqual({ ok: false, reason: "unsupported-format" })
    expect(packFs.copyAsset).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("未打开系列时返回 no-pack", async () => {
    const result = await usePackStore
      .getState()
      .importAsset({ kind: "back" }, { kind: "front" }, "/src/a.png")
    expect(result).toEqual({ ok: false, reason: "no-pack" })
  })

  it("写入失败时返回 copy-failed 且状态完全不动", async () => {
    const { ref } = await setup()
    // 先给目标字段一个既有的先前值：失败后必须是它，而不是被清空或被写入新路径。
    usePackStore.getState().updateFace(ref, { front: "assets/old.png" })
    const before = usePackStore.getState()
    const pastBefore = before.past.length
    const statusBefore = before.saveStatus
    const selectedBefore = before.selectedCardId

    vi.mocked(packFs.writeBytesAtomic).mockRejectedValueOnce(new Error("磁盘已满"))
    const result = await usePackStore.getState().importAsset(ref, { kind: "front" }, "/src/a.png")

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("copy-failed")
    const after = usePackStore.getState()
    // 失败的写入不得留下任何痕迹：无半写路径、无历史点、无假 dirty、选择态不变。
    expect(after.pack!.cards[0].front).toBe("assets/old.png")
    expect(after.past).toHaveLength(pastBefore)
    expect(after.saveStatus).toBe(statusBefore)
    expect(after.selectedCardId).toBe(selectedBefore)
  })

  it("目标图层不存在时返回 no-target，且不拷贝出孤儿文件", async () => {
    const { ref } = await setup()
    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId: "missing", effectId: "e" }, "/src/a.png")
    expect(result).toEqual({ ok: false, reason: "no-target" })
    expect(packFs.readFileBytes).not.toHaveBeenCalled()
    expect(packFs.copyAsset).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("目标效果不存在、或不是 imageMask 时返回 no-target", async () => {
    const { ref, layerId } = await setup()
    // 挂一条非 imageMask 效果——它的 id 不该被 maskEffect 目标接受（kind 不符）。
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "gradient")
    const gradientId = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      layerId,
    )!.effects.find((e) => e.kind === "gradient")!.id

    const noEffect = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId, effectId: "nope" }, "/src/a.png")
    expect(noEffect).toEqual({ ok: false, reason: "no-target" })

    const wrongKind = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId, effectId: gradientId }, "/src/a.png")
    expect(wrongKind).toEqual({ ok: false, reason: "no-target" })
    expect(packFs.copyAsset).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("写入期间目标图层被删除：返回 no-target，不留历史点，也不写入悬空路径", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "imageMask")
    const effectId = findLayerById(
      usePackStore.getState().pack!.cards[0].layers,
      layerId,
    )!.effects.find((e) => e.kind === "imageMask")!.id

    // 让写入在「进行中」删掉目标图层：模拟用户在导入窗口里从图层面板删掉了它。
    // 删除本身是一次正常 commit，因此历史点的基准要在删除之后取，
    // 这样断言才能精确隔离出「本次导入有没有留下空历史点」。
    let pastAfterDelete = -1
    let statusAfterDelete: string = ""
    vi.mocked(packFs.writeBytesAtomic).mockImplementationOnce(async () => {
      usePackStore.getState().deleteLayer(ref, layerId)
      pastAfterDelete = usePackStore.getState().past.length
      statusAfterDelete = usePackStore.getState().saveStatus
    })

    const result = await usePackStore
      .getState()
      .importAsset(ref, { kind: "maskEffect", layerId, effectId }, "/src/a.png")

    expect(result).toEqual({ ok: false, reason: "no-target" })
    const after = usePackStore.getState()
    expect(after.past).toHaveLength(pastAfterDelete)
    expect(after.saveStatus).toBe(statusAfterDelete)
    // 目标已消失，卡上不得出现任何指向刚落盘那张图的悬空引用。
    const card = after.pack!.cards[0]
    expect(card.layers).toHaveLength(0)
    expect(card.front).toBe("")
  })
})

describe("packStore duplicateCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("插在原卡片之后，元数据与图层齐备", async () => {
    const { cardId } = await setup()
    usePackStore.getState().updateCard(cardId, { name: "星辰", rarity: "epic" })
    const copyId = usePackStore.getState().duplicateCard(cardId)
    const cards = usePackStore.getState().pack!.cards
    expect(cards).toHaveLength(2)
    expect(cards[1].id).toBe(copyId)
    expect(cards[1].name).toBe("星辰")
    expect(cards[1].rarity).toBe("epic")
    expect(cards[1].layers).toHaveLength(1)
    // 图层必须重编 ID：否则两张卡共享同一个图层 ID，选中态与历史都会串。
    expect(cards[1].layers[0].id).not.toBe(cards[0].layers[0].id)
  })

  it("复制体的图层与原卡片互不影响", async () => {
    const { cardId } = await setup()
    const copyId = usePackStore.getState().duplicateCard(cardId)!
    const copyRef = { kind: "card" as const, cardId: copyId }
    const copyLayerId = usePackStore.getState().pack!.cards[1].layers[0].id
    // 在复制体的图层上挂一条 palette 效果并改其色标：原卡片那一层必须不受影响（深拷贝隔离）。
    usePackStore.getState().addEffect(copyRef, { scope: "layer", layerId: copyLayerId }, "palette")
    const effectId = findLayerById(
      usePackStore.getState().pack!.cards[1].layers,
      copyLayerId,
    )!.effects.find((e) => e.kind === "palette")!.id
    usePackStore
      .getState()
      .updateEffect(copyRef, { scope: "layer", layerId: copyLayerId }, effectId, {
        colors: [{ color: "#111111", at: 0 }],
      })
    expect(usePackStore.getState().pack!.cards[0].layers[0].effects).toEqual([])
  })

  it("源卡片不存在时返回 null 且不留历史点", async () => {
    const { cardId } = await setup()
    const past = usePackStore.getState().past.length
    expect(usePackStore.getState().duplicateCard("missing")).toBeNull()
    expect(usePackStore.getState().past).toHaveLength(past)
    expect(cardId).toBeTruthy()
  })
})
