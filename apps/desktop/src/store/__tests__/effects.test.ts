/**
 * packStore 效果栈原语（add / remove / update / move）的行为测试。
 *
 * 重点有两处，写错都不会报错、只会在使用中暴露：
 * - **槽位与命中判定必须在 commit 之前**：`commit` 无条件记一个历史点，留到 recipe 里
 *   提前 return 会留下一个「按了没反应」的空撤销步——本文件对每个落空分支都钉住 `past` 不变；
 * - **合并键的粒度**：`effect.<id>.<field>` 决定一次拖拽是「一步」还是「每一帧一步」。
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

import type { Effect } from "@prismwright/schema"
import { EFFECT_REGISTRY, MASK_PRESET_MAX } from "@prismwright/renderer/v1"
import { usePackStore } from "../packStore"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  const card = usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
  return { cardId, layerId: card.layers[0].id, ref: { kind: "card" as const, cardId } }
}

/** 断言并收窄某条效果到具体 kind，从而以强类型访问其 `params`（避免测试里散落的 any）。 */
function narrow<K extends Effect["kind"]>(
  effect: Effect | undefined,
  kind: K,
): Extract<Effect, { kind: K }> {
  if (!effect || effect.kind !== kind) throw new Error(`期望 ${kind}，实际 ${effect?.kind}`)
  return effect as Extract<Effect, { kind: K }>
}

/** 当前卡面的效果列表（测试里反复取，收成一个短 helper）。 */
const faceEffects = () => usePackStore.getState().pack!.cards[0].effects
/** 第一张图层的效果列表。 */
const layerEffects = () => usePackStore.getState().pack!.cards[0].layers[0].effects

describe("packStore 效果栈原语", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("addEffect 落在卡面：kind / enabled / 稳定 id / 默认参数", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    const effects = faceEffects()
    expect(effects).toHaveLength(1)
    const e = effects[0]
    expect(e.kind).toBe("gradient")
    expect(e.enabled).toBe(true)
    expect(e.id).not.toBe("")
    // 深比较默认参数：注册表的 defaultParams() 是唯一真源，新建条目必须与之一致。
    expect(e.params).toEqual(EFFECT_REGISTRY.gradient.defaultParams())
    // 只落在卡面，不应泄漏进图层。
    expect(layerEffects()).toHaveLength(0)
  })

  it("addEffect 落在图层：只增长该图层，卡面不受影响", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "holoGrid")
    expect(layerEffects()).toHaveLength(1)
    expect(narrow(layerEffects()[0], "holoGrid").enabled).toBe(true)
    expect(faceEffects()).toHaveLength(0)
  })

  // 背面与图层「懒创建」是同一套语义（见 addLayer / withFace）：背面尚不存在时，其余写入都能
  // 把它建出来。若这里的落空判定不把「缺席的背面」当空列表，首次给背面加效果会被静默吞掉。
  it("addEffect 可写背面：背面尚不存在时懒创建，效果落在卡面级列表", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    expect(usePackStore.getState().pack!.back).toBeNull()
    usePackStore.getState().addEffect({ kind: "back" }, { scope: "face" }, "gradient")
    expect(usePackStore.getState().pack!.back!.effects).toHaveLength(1)
  })

  it("槽位满时静默拒绝：列表不增，且不留历史点", async () => {
    const { ref } = await setup()
    for (let i = 0; i < MASK_PRESET_MAX; i++) {
      usePackStore.getState().addEffect(ref, { scope: "face" }, "maskPreset")
    }
    expect(faceEffects().filter((e) => e.kind === "maskPreset")).toHaveLength(MASK_PRESET_MAX)

    // 第 3 次：槽位已满，必须在 commit 之前拦下——否则 `past` 会平白长一格。
    const past = usePackStore.getState().past.length
    usePackStore.getState().addEffect(ref, { scope: "face" }, "maskPreset")
    expect(faceEffects().filter((e) => e.kind === "maskPreset")).toHaveLength(MASK_PRESET_MAX)
    expect(usePackStore.getState().past.length).toBe(past)
  })

  // 用 gloss 而非 gradient：gradient 槽位已收敛为 1，同目标加两条会被静默拒绝，取不到 `b`；
  // 且 gloss 的 scope 为 both，落在卡面目标上不越 scope 不变式（holoGrid 是 layer 专属）。
  it("defaultParams 每次返回新对象：两条条目不共享引用", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gloss")
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gloss")
    const [a, b] = faceEffects().map((e) => narrow(e, "gloss"))
    expect(a.params).not.toBe(b.params)
    // 原地改一条不应波及另一条——若注册表返回共享对象即会在此暴露。
    const original = b.params.count
    a.params.count = original + 7
    expect(b.params.count).toBe(original)
  })

  it("updateEffect 合并键为 effect.<id>.<field>：同字段合并、换字段新点", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    const id = faceEffects()[0].id

    const before = usePackStore.getState().past.length
    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { count: 3 })
    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { count: 4 })
    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { count: 5 })
    // 同一字段的三次连续拖动合并为一步。
    expect(usePackStore.getState().past.length).toBe(before + 1)

    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { twist: 0.5 })
    // 换字段即换合并键，产生新的一步。
    expect(usePackStore.getState().past.length).toBe(before + 2)
  })

  it("updateEffect 写值且是局部合并（其它参数保留）", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    const id = faceEffects()[0].id
    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { count: 40 })
    const params = narrow(faceEffects()[0], "gradient").params
    expect(params.count).toBe(40)
    // 未触及的字段保持默认，证明是 `{ ...old, ...patch }` 而非整体替换。
    expect(params.mode).toBe(EFFECT_REGISTRY.gradient.defaultParams().mode)
    expect(params.twist).toBe(EFFECT_REGISTRY.gradient.defaultParams().twist)
  })

  // `enabled` 上提在 EffectBase（不在 params 内），面板的开关靠它翻转。写错只会在界面上表现为
  // 「开关点了没反应」或「一开一关把参数也改了」，故两个方向都钉住。
  it("updateEffect 可切换 enabled，且不波及参数", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    const id = faceEffects()[0].id
    const before = narrow(faceEffects()[0], "gradient").params

    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { enabled: false })
    const e = narrow(faceEffects()[0], "gradient")
    expect(e.enabled).toBe(false)
    // 参数原样保留——证明确实把 `enabled` 摘出去单独写，而非混进 `{ ...params, ...patch }`。
    expect(e.params).toEqual(before)
  })

  it("updateEffect 可在同一步里同时写 enabled 与参数", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    const id = faceEffects()[0].id

    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { enabled: false, count: 9 })
    const e = narrow(faceEffects()[0], "gradient")
    expect(e.enabled).toBe(false)
    expect(e.params.count).toBe(9)
  })

  // `colors`（palette）是效果参数里唯一的数组字段：入 state 前须逐项深拷贝，否则调用方原地改
  // 色标会绕过 commit 静默改写 state（无历史点、无 dirty、无重渲染）。
  it("updateEffect 写 colors 时逐项深拷贝：调用方原地改数组/元素不影响 state", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "palette")
    const id = layerEffects()[0].id

    const stops = [
      { color: "#FFD700", at: 0 },
      { color: "#0099FF", at: 1 },
    ]
    usePackStore.getState().updateEffect(ref, { scope: "layer", layerId }, id, { colors: stops })
    expect(narrow(layerEffects()[0], "palette").params.colors).toEqual(stops)

    // 原地改调用方持有的数组与元素：state 快照不应被波及（含元素对象层面的隔断）。
    stops.push({ color: "#B266FF", at: 0.5 })
    stops[0].at = 0.9
    const stored = narrow(layerEffects()[0], "palette").params.colors
    expect(stored).toHaveLength(2)
    expect(stored[0].at).toBe(0)
    expect(stored[0]).not.toBe(stops[0])
  })

  it("removeEffect 按 id 删除；重复删同一已消失的 id 不再留历史点", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    const id = faceEffects()[0].id
    usePackStore.getState().removeEffect(ref, { scope: "face" }, id)
    expect(faceEffects()).toHaveLength(0)

    const past = usePackStore.getState().past.length
    usePackStore.getState().removeEffect(ref, { scope: "face" }, id)
    expect(faceEffects()).toHaveLength(0)
    expect(usePackStore.getState().past.length).toBe(past)
  })

  it("moveEffect 重排同列表；越界 toIndex 夹取；不存在的 id 不留历史点", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    usePackStore.getState().addEffect(ref, { scope: "face" }, "moire")
    const [g, l] = faceEffects()
    expect(faceEffects().map((e) => e.kind)).toEqual(["gradient", "moire"])

    // 把首位移到末尾。
    usePackStore.getState().moveEffect(ref, { scope: "face" }, g.id, 2)
    expect(faceEffects().map((e) => e.id)).toEqual([l.id, g.id])

    // 越界 toIndex 夹到列表长度，不抛错、元素仍在。
    usePackStore.getState().moveEffect(ref, { scope: "face" }, g.id, 999)
    expect(faceEffects().map((e) => e.id)).toEqual([l.id, g.id])
    expect(faceEffects()).toHaveLength(2)

    // 不存在的 id：落空，须在 commit 之前拦下。
    const past = usePackStore.getState().past.length
    usePackStore.getState().moveEffect(ref, { scope: "face" }, "missing", 0)
    expect(usePackStore.getState().past.length).toBe(past)
  })

  // 移到与现状相同的位置净结果不变：须在 commit 之前拦下，否则会留下一个「拖了没动」的空撤销步。
  it("moveEffect 落回原位是无变化，不入历史点", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    usePackStore.getState().addEffect(ref, { scope: "face" }, "moire")
    const [g, l] = faceEffects()

    const past = usePackStore.getState().past.length
    usePackStore.getState().moveEffect(ref, { scope: "face" }, l.id, 1)
    usePackStore.getState().moveEffect(ref, { scope: "face" }, g.id, 0)
    expect(faceEffects().map((e) => e.id)).toEqual([g.id, l.id])
    expect(usePackStore.getState().past.length).toBe(past)
  })

  it("目标隔离：卡面的效果 id 对图层目标不解析（反之亦然），且不留历史点", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "gradient")
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "holoGrid")
    const faceId = faceEffects()[0].id
    const layerIdEffect = layerEffects()[0].id

    const past = usePackStore.getState().past.length
    // 拿卡面的 id 去图层目标上删：图层里没有它，静默落空。
    usePackStore.getState().removeEffect(ref, { scope: "layer", layerId }, faceId)
    // 反向：拿图层的 id 去卡面目标上删，同样落空。
    usePackStore.getState().removeEffect(ref, { scope: "face" }, layerIdEffect)

    expect(faceEffects()).toHaveLength(1)
    expect(layerEffects()).toHaveLength(1)
    expect(usePackStore.getState().past.length).toBe(past)
  })
})

describe("图片跟随卡面", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  /** 取列表里唯一那条图片效果（收窄后可直接读参数）。 */
  const imageOf = (list: Effect[]) => narrow(list.find((e) => e.kind === "image"), "image")

  it("打开开关的一刻把卡面当前变换抄进来（含填充方式）", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().updateFace(ref, {
      frontFit: "cover",
      frontOffsetX: 0.2,
      frontOffsetY: -0.3,
      frontScale: 1.5,
      frontRotation: 12,
    })
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const id = layerEffects()[0].id

    usePackStore.getState().updateEffect(ref, { scope: "layer", layerId }, id, { followFront: true })

    expect(imageOf(layerEffects()).params).toMatchObject({
      followFront: true,
      fit: "cover",
      x: 0.2,
      y: -0.3,
      scale: 1.5,
      rotation: 12,
    })
  })

  it("卡面变换改变时，跟随的图片一起对齐，没跟随的不动", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const followId = layerEffects()[0].id
    usePackStore
      .getState()
      .updateEffect(ref, { scope: "layer", layerId }, followId, { followFront: true })
    // 新图层的图片不跟随，先给一个与默认值不同的位置，用来证明它没被顺手改掉。
    const other = usePackStore.getState().addImageLayer(ref)!
    usePackStore
      .getState()
      .updateEffect(ref, { scope: "layer", layerId: other.layerId }, other.effectId, { x: 0.9 })

    usePackStore.getState().updateFace(ref, { frontOffsetX: 0.5, frontScale: 2, frontFit: "stretch" })

    expect(imageOf(layerEffects()).params).toMatchObject({ x: 0.5, scale: 2, fit: "stretch" })
    const otherLayer = usePackStore.getState().pack!.cards[0].layers.find((l) => l.id === other.layerId)!
    expect(imageOf(otherLayer.effects).params.x).toBe(0.9)
  })

  it("一次卡面拖动只留一步历史，撤销把卡面与图片一起还原", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "image")
    const id = layerEffects()[0].id
    usePackStore.getState().updateEffect(ref, { scope: "layer", layerId }, id, { followFront: true })

    const past = usePackStore.getState().past.length
    usePackStore.getState().updateFace(ref, { frontOffsetX: 0.3 })
    expect(imageOf(layerEffects()).params.x).toBe(0.3)
    expect(usePackStore.getState().past.length).toBe(past + 1)

    usePackStore.getState().undo()
    expect(usePackStore.getState().pack!.cards[0].frontOffsetX).toBe(0)
    expect(imageOf(layerEffects()).params.x).toBe(0)
  })
})

describe("图蒙版跟随卡面", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  /** 取列表里唯一那条图蒙版（收窄后可直接读参数）。 */
  const maskOf = (list: Effect[]) =>
    narrow(list.find((e) => e.kind === "imageMask"), "imageMask")

  it("打开开关的一刻把卡面当前变换抄进来", async () => {
    const { ref } = await setup()
    usePackStore.getState().updateFace(ref, {
      frontFit: "contain",
      frontOffsetX: 0.2,
      frontOffsetY: -0.3,
      frontScale: 1.5,
      frontRotation: 12,
    })
    usePackStore.getState().addEffect(ref, { scope: "face" }, "imageMask")
    const id = faceEffects()[0].id

    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { followFront: true })

    expect(maskOf(faceEffects()).params).toMatchObject({
      followFront: true,
      fit: "contain",
      x: 0.2,
      y: -0.3,
      scale: 1.5,
      rotation: 12,
    })
  })

  it("卡面变换改变时，卡面级与图层级的跟随时蒙版一起对齐，没跟随的不动", async () => {
    const { ref, layerId } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "imageMask")
    usePackStore.getState().addEffect(ref, { scope: "layer", layerId }, "imageMask")
    const faceMaskId = faceEffects()[0].id
    const layerMaskId = layerEffects()[0].id

    usePackStore.getState().updateEffect(ref, { scope: "face" }, faceMaskId, { followFront: true })
    // 图层那条不跟随，先给一个与默认值不同的位置，用来证明它没被顺手改掉。
    usePackStore.getState().updateEffect(ref, { scope: "layer", layerId }, layerMaskId, { x: 0.9 })

    usePackStore.getState().updateFace(ref, { frontOffsetX: 0.5, frontScale: 2 })

    expect(maskOf(faceEffects()).params).toMatchObject({ x: 0.5, scale: 2 })
    expect(maskOf(layerEffects()).params.x).toBe(0.9)
  })

  it("一次卡面拖动只留一步历史，撤销把卡面与蒙版一起还原", async () => {
    const { ref } = await setup()
    usePackStore.getState().addEffect(ref, { scope: "face" }, "imageMask")
    const id = faceEffects()[0].id
    usePackStore.getState().updateEffect(ref, { scope: "face" }, id, { followFront: true })

    const past = usePackStore.getState().past.length
    usePackStore.getState().updateFace(ref, { frontOffsetX: 0.3 })
    expect(maskOf(faceEffects()).params.x).toBe(0.3)
    expect(usePackStore.getState().past.length).toBe(past + 1)

    usePackStore.getState().undo()
    expect(usePackStore.getState().pack!.cards[0].frontOffsetX).toBe(0)
    expect(maskOf(faceEffects()).params.x).toBe(0)
  })
})
