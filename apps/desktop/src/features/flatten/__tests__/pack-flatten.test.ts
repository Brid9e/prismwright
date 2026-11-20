/**
 * 「把多个图片图层合并成一张」的系列级编排。
 *
 * 分两步、且两步之间隔着一个 `await`（合成要读图、要落 PNG），所以「先算计划、再套用」
 * 必须拆开：计划描述「哪个卡面的哪几个图层换成哪个新图层」，套用在一个草稿上就地改写。
 * 像素合成由 `compose` 注入，本文件用假实现，只验编排。
 */
import { describe, it, expect, vi } from "vitest"
import { createCard, createEmptyPack, createLayer, PaletteParamsSchema, type Effect, type Layer, type Pack } from "@cardbara/schema"
import { applyFlatten, planFlatten } from "../pack-flatten"
import { groupFingerprint } from "../flatten"

function imageEffect(path: string): Effect {
  return {
    id: `img-${path}`,
    enabled: true,
    kind: "image",
    params: { path, x: 0, y: 0, rotation: 0, scale: 1 },
  } as Effect
}

function imageLayer(path: string, over: Partial<Layer> = {}): Layer {
  const layer = createLayer("图层")
  layer.effects = [imageEffect(path)]
  return { ...layer, ...over }
}

/** 一层挂调色板：不可合并，用来把两组图片隔开。 */
function holoLayer(): Layer {
  const layer = createLayer("全息")
  layer.effects.push({ id: "p", enabled: true, kind: "palette", params: PaletteParamsSchema.parse({ colors: [] }) } as Effect)
  return layer
}

function packWith(layers: Layer[]): Pack {
  const pack = createEmptyPack("测试")
  const card = createCard(1, "图层")
  card.layers = layers
  pack.cards = [card]
  return pack
}

/** 每次合成返回一个递增的假路径，便于断言「哪一组拿到了哪个结果」。 */
function fakeCompose(): { compose: (layers: readonly Layer[]) => Promise<string>; calls: Layer[][] } {
  const calls: Layer[][] = []
  const compose = vi.fn(async (layers: readonly Layer[]) => {
    calls.push([...layers])
    return `assets/merged-${calls.length}.png`
  })
  return { compose, calls }
}

describe("planFlatten", () => {
  it("把相邻两张纯图片排进一个计划，合成结果成为新图层的图片", async () => {
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([a, b]), compose)

    expect(plan?.ops).toHaveLength(1)
    const op = plan!.ops[0]
    expect(op.layerIds).toEqual([a.id, b.id])
    expect(op.layer.effects).toHaveLength(1)
    const effect = op.layer.effects[0]
    expect(effect.kind).toBe("image")
    if (effect.kind === "image") {
      expect(effect.params).toMatchObject({ path: "assets/merged-1.png", x: 0, y: 0, rotation: 0, scale: 1 })
    }
  })

  it("合成时按绘制顺序把整组交给 compose", async () => {
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    const { compose, calls } = fakeCompose()

    await planFlatten(packWith([a, b]), compose)

    expect(calls).toHaveLength(1)
    expect(calls[0].map((l) => (l.effects[0] as Extract<Effect, { kind: "image" }>).params.path)).toEqual([
      "assets/a.png",
      "assets/b.png",
    ])
  })

  it("新图层沿用被合并层的混合模式——否则叠到下面的样子就变了", async () => {
    const a = imageLayer("assets/a.png", { blend: "add" })
    const b = imageLayer("assets/b.png", { blend: "add" })
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([a, b]), compose)

    expect(plan!.ops[0].layer.blend).toBe("add")
  })

  it("新图层不透明——原层的 opacity 已经烤进像素，再乘一次就淡了", async () => {
    const a = imageLayer("assets/a.png", { opacity: 0.4 })
    const b = imageLayer("assets/b.png", { opacity: 0.4 })
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([a, b]), compose)

    expect(plan!.ops[0].layer.opacity).toBe(1)
  })

  it("计划只描述、不改原系列——中间隔着异步合成，改到了就是改了别人的内存", async () => {
    const layers = [imageLayer("assets/a.png"), imageLayer("assets/b.png")]
    const pack = packWith(layers)
    const { compose } = fakeCompose()

    await planFlatten(pack, compose)

    expect(pack.cards[0].layers).toHaveLength(2)
  })

  it("没有可合并的组时返回 null，也不去合成", async () => {
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([holoLayer()]), compose)

    expect(plan).toBeNull()
    expect(compose).not.toHaveBeenCalled()
  })

  it("全息层把两侧隔成两组，各用各的合成结果", async () => {
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    const c = imageLayer("assets/c.png")
    const d = imageLayer("assets/d.png")
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([a, b, holoLayer(), c, d]), compose)

    expect(plan!.ops.map((op) => op.layerIds)).toEqual([
      [a.id, b.id],
      [c.id, d.id],
    ])
  })

  it("隐藏款与背面同样处理", async () => {
    const hidden = createCard(2, "图层")
    hidden.layers = [imageLayer("assets/h1.png"), imageLayer("assets/h2.png")]
    const back = createCard(0, "图层")
    back.layers = [imageLayer("assets/k1.png"), imageLayer("assets/k2.png")]
    const pack = createEmptyPack("测试")
    pack.hiddenCards = [hidden]
    pack.back = back
    const { compose } = fakeCompose()

    const plan = await planFlatten(pack, compose)

    expect(plan!.ops.map((op) => op.face)).toEqual([
      { kind: "card", cardId: hidden.id },
      { kind: "back" },
    ])
  })

  it("背面为空时直接跳过，不报错", async () => {
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([imageLayer("assets/a.png"), imageLayer("assets/b.png")]), compose)

    expect(plan!.ops).toHaveLength(1)
    expect(plan!.ops.every((op) => op.face.kind === "card")).toBe(true)
  })

  it("每条计划带着被合并那组的指纹", async () => {
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([a, b]), compose)

    expect(plan!.ops[0].fingerprint).toBe(groupFingerprint([a, b]))
  })

  it("skip 里记下的组不再参与合并——用户撤销回来就是为了让它分开", async () => {
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    const { compose } = fakeCompose()

    const plan = await planFlatten(packWith([a, b]), compose, new Set([groupFingerprint([a, b])]))

    expect(plan).toBeNull()
    expect(compose).not.toHaveBeenCalled()
  })

  it("收齐被替换掉的原图路径，同一张图被多处引用时只列一次", async () => {
    const shared = "assets/shared.png"
    const pack = packWith([imageLayer(shared), imageLayer(shared)])
    const { compose } = fakeCompose()

    const plan = await planFlatten(pack, compose)

    expect(plan!.superseded).toEqual([shared])
  })
})

describe("applyFlatten", () => {
  it("新图层落在组里第一层的原位置，其余层保持原有顺序", async () => {
    const a = imageLayer("assets/a.png")
    const b = imageLayer("assets/b.png")
    const top = holoLayer()
    const pack = packWith([a, b, top])
    const { compose } = fakeCompose()
    const plan = await planFlatten(pack, compose)

    applyFlatten(pack, plan!)

    expect(pack.cards[0].layers.map((l) => l.id)).toEqual([plan!.ops[0].layer.id, top.id])
  })

  it("只动这一组：别的卡面原样不动", async () => {
    const card2 = createCard(2, "图层")
    const keeper = imageLayer("assets/k.png")
    card2.layers = [keeper]
    const pack = packWith([imageLayer("assets/a.png"), imageLayer("assets/b.png")])
    pack.cards.push(card2)
    const { compose } = fakeCompose()
    const plan = await planFlatten(pack, compose)

    applyFlatten(pack, plan!)

    expect(pack.cards[1].layers).toEqual([keeper])
  })

  it("计划里的卡面已被删掉时安全跳过——计划算完之后用户可能删了卡", async () => {
    const pack = packWith([imageLayer("assets/a.png"), imageLayer("assets/b.png")])
    const { compose } = fakeCompose()
    const plan = await planFlatten(pack, compose)
    pack.cards = []

    expect(() => applyFlatten(pack, plan!)).not.toThrow()
  })

  it("计划里的图层已被删掉时安全跳过，不会凭空多塞一层", async () => {
    const pack = packWith([imageLayer("assets/a.png"), imageLayer("assets/b.png")])
    const { compose } = fakeCompose()
    const plan = await planFlatten(pack, compose)
    pack.cards[0].layers = []

    applyFlatten(pack, plan!)

    expect(pack.cards[0].layers).toEqual([])
  })

  it("背面首次出现在计划里时能被套用", async () => {
    const back = createCard(0, "图层")
    back.layers = [imageLayer("assets/k1.png"), imageLayer("assets/k2.png")]
    const pack = createEmptyPack("测试")
    pack.back = back
    const { compose } = fakeCompose()
    const plan = await planFlatten(pack, compose)

    applyFlatten(pack, plan!)

    expect(pack.back!.layers.map((l) => l.id)).toEqual([plan!.ops[0].layer.id])
  })
})
