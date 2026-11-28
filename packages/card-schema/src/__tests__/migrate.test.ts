import { describe, it, expect } from "vitest"
import { CURRENT_SCHEMA_VERSION, migrate, migrateCardFace, parsePack } from "../migrate"

const base = {
  id: "p1",
  name: "包",
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
}

/** 一张只带比例的卡（v7 及以前每张卡各持一个 aspect）。 */
const card = (id: string, aspect: number) => ({ id, num: 0, name: "", aspect })

describe("migrate 版本守卫", () => {
  it("CURRENT_SCHEMA_VERSION 为 10", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(10)
  })

  it("高于当前版本 → 抛错", () => {
    expect(() => migrate({ ...base, schemaVersion: 11 })).toThrow(/版本过新/)
  })

  it("当前版本 → 原样返回同一引用", () => {
    const obj = { ...base, schemaVersion: 10 }
    expect(migrate(obj)).toBe(obj)
  })

  it("非对象（含 null）→ 原样返回", () => {
    expect(migrate(42)).toBe(42)
    expect(migrate(null)).toBe(null)
  })
})

describe("v7 → v8：比例从每张卡收成系列一个", () => {
  it("取用得最多的比例，并把卡上的 aspect 删掉", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 7,
      cards: [card("c1", 0.5), card("c2", 0.5), card("c3", 2)],
    }) as Record<string, unknown> & { cards: Record<string, unknown>[] }

    expect(migrated.schemaVersion).toBe(10)
    expect(migrated.aspect).toBe(0.5)
    for (const c of migrated.cards) expect(c).not.toHaveProperty("aspect")
  })

  it("缺 schemaVersion 的老数据也按同一规则上抬", () => {
    const migrated = migrate({ ...base, cards: [card("c1", 0.75)] }) as Record<string, unknown>
    expect(migrated.schemaVersion).toBe(10)
    expect(migrated.aspect).toBe(0.75)
  })

  it("不改动入参", () => {
    const raw = { ...base, schemaVersion: 7, cards: [card("c1", 0.5)] }
    migrate(raw)
    expect(raw.cards[0]).toHaveProperty("aspect", 0.5)
  })
})

describe("v8 → v9：卡面降级为纯图层", () => {
  const face = (over: Record<string, unknown>) => ({
    id: "c1",
    num: 0,
    name: "",
    front: "assets/front.png",
    frontFit: "contain",
    frontOffsetX: 0.1,
    frontOffsetY: -0.2,
    frontScale: 1.2,
    frontRotation: 15,
    frontBumpStrength: 0.5,
    frontBumpDetail: 0.02,
    frontBumpFlow: 0.3,
    frontBumpLight: 0.7,
    frontBumpLightAngle: 90,
    frontBumpLightColor: "#ff0000",
    frontBumpInvert: true,
    frontNormalPath: "assets/n.png",
    frontNormalFlipY: true,
    baseColor: "#123456",
    layers: [{ id: "old", name: "", effects: [], children: [] }],
    ...over,
  })

  it("front + 旧面级效果 → 最底层的 image 图层", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 8,
      cards: [
        face({
          effects: [
            { id: "m", kind: "moire", enabled: true, params: { faceStrength: 0.4 } },
            { id: "g", kind: "gloss", enabled: true, params: {} },
          ],
        }),
      ],
    }) as { cards: Array<Record<string, any>> }

    const [imageLayer, oldLayer] = migrated.cards[0].layers
    expect(migrated.cards[0]).not.toHaveProperty("front")
    expect(migrated.cards[0]).not.toHaveProperty("effects")
    expect(imageLayer.blend).toBe("normal")
    expect(imageLayer.effects[0].kind).toBe("image")
    expect(imageLayer.effects[0].params).toMatchObject({
      path: "assets/front.png",
      fit: "contain",
      x: 0.1,
      y: -0.2,
      scale: 1.2,
      rotation: 15,
      bumpStrength: 0.5,
      bumpDetail: 0.02,
      bumpFlow: 0.3,
      bumpLight: 0.7,
      bumpLightAngle: 90,
      bumpLightColor: "#ff0000",
      bumpInvert: true,
      normalPath: "assets/n.png",
      normalFlipY: true,
    })
    expect(imageLayer.effects[1]).toMatchObject({ kind: "moire", params: { contentRelief: 0.4 } })
    expect(imageLayer.effects[1].params).not.toHaveProperty("faceStrength")
    expect(imageLayer.effects[2].kind).toBe("gloss")
    expect(oldLayer.id).toBe("old")
  })

  it("旧面级 maskErase 是整卡擦除 → 父级 group", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 8,
      cards: [
        face({
          effects: [
            { id: "erase", kind: "maskErase", enabled: true, params: { path: "assets/e.png" } },
          ],
        }),
      ],
    }) as { cards: Array<Record<string, any>> }

    const group = migrated.cards[0].layers[0]
    expect(group.effects).toEqual([
      { id: "erase", kind: "maskErase", enabled: true, params: { path: "assets/e.png" } },
    ])
    expect(group.children[0].effects[0].kind).toBe("image")
    expect(group.children[1].id).toBe("old")
  })

  it("没有 front 但有面级效果 → 内容为空的普通图层，数据不丢", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 8,
      cards: [
        face({
          front: "",
          frontNormalPath: "",
          effects: [{ id: "g", kind: "gloss", enabled: true, params: {} }],
        }),
      ],
    }) as { cards: Array<Record<string, any>> }

    const layer = migrated.cards[0].layers[0]
    expect(layer.effects).toEqual([{ id: "g", kind: "gloss", enabled: true, params: {} }])
  })

  it("没有 front 也没有面级效果 → 不新增图层", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 8,
      cards: [face({ front: "", frontNormalPath: "", effects: [], layers: [] })],
    }) as { cards: Array<Record<string, any>> }
    expect(migrated.cards[0].layers).toEqual([])
  })
})

describe("v9 → v10：调色板并入渐变", () => {
  const g = (id: string, params: Record<string, unknown> = {}, enabled = true) => ({
    kind: "gradient",
    id,
    enabled,
    params,
  })
  const p = (id: string, params: Record<string, unknown> = {}, enabled = true) => ({
    kind: "palette",
    id,
    enabled,
    params,
  })
  const layer = (effects: unknown[]) => ({ id: "l1", name: "", effects, children: [] })
  const pack = (cards: unknown[], extra: Record<string, unknown> = {}) => ({
    ...base,
    schemaVersion: 9,
    cards,
    ...extra,
  })
  const card = (layers: unknown[]) => ({ id: "c1", num: 0, name: "", layers })

  it("两条都有 → 合成一条，id 取渐变、位置取靠前、enabled 取调色板", () => {
    const migrated = migrate(
      pack([
        card([
          layer([
            p("p", { colors: ["#111111"], hue: 0.1 }, false),
            g("g", { distortionStrength: 7, count: 12 }),
          ]),
        ]),
      ]),
    ) as any
    const effects = migrated.cards[0].layers[0].effects
    expect(effects).toHaveLength(1)
    expect(effects[0].kind).toBe("gradient")
    expect(effects[0].id).toBe("g")
    expect(effects[0].enabled).toBe(false)
    expect(effects[0].params).toMatchObject({
      colors: [{ color: "#111111", at: 0.5 }],
      hue: 0.1,
      distortionStrength: 7,
      count: 12,
      straight: 1,
    })
  })

  it("仅调色板 → 补默认渐变参数，整齐 = 1", () => {
    const migrated = migrate(
      pack([card([layer([p("p", { colors: ["#111111"], composite: "tint" })])])]),
    ) as any
    const effects = migrated.cards[0].layers[0].effects
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      kind: "gradient",
      id: "p",
      params: { colors: [{ color: "#111111", at: 0.5 }], composite: "tint", straight: 1 },
    })
  })

  it("仅渐变 → 保持空色标（迁移前不出全息，迁移后也不出）", () => {
    const migrated = migrate(pack([card([layer([g("g", { distortionStrength: 9 })])])])) as any
    const effects = migrated.cards[0].layers[0].effects
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({
      kind: "gradient",
      id: "g",
      params: { colors: [], distortionStrength: 9, straight: 1 },
    })
  })

  it("递归处理子树、隐藏卡与卡背，并丢弃多余的调色板 / 渐变", () => {
    const effects = [p("p1"), p("p2"), g("g1"), g("g2")]
    const migrated = migrate(
      pack(
        [card([layer([])])],
        {
          hiddenCards: [card([layer(effects)])],
          back: {
            id: "back",
            layers: [
              {
                id: "child",
                name: "",
                effects,
                children: [{ id: "grand", name: "", effects, children: [] }],
              },
            ],
          },
        },
      ),
    ) as any
    const hidden = migrated.hiddenCards[0].layers[0].effects
    expect(hidden).toHaveLength(1)
    expect(hidden[0].id).toBe("g1")
    const backLayer = migrated.back.layers[0]
    expect(backLayer.effects).toHaveLength(1)
    expect(backLayer.children[0].effects).toHaveLength(1)
  })

  it("单卡导入入口迁移两次结果相同（幂等）", () => {
    const face = {
      id: "c1",
      num: 0,
      name: "",
      layers: [layer([p("p", { colors: ["#111111"] }), g("g", { count: 12 })])],
    }
    const once = migrateCardFace(face) as any
    const twice = migrateCardFace(once) as any
    expect(twice).toEqual(once)
    expect(once.layers[0].effects).toHaveLength(1)
  })
})

describe("parsePack", () => {
  it("接受 v10 系列", () => {
    expect(parsePack({ ...base, schemaVersion: 10 }).schemaVersion).toBe(10)
  })

  it("拒绝 v11 系列（抛出）", () => {
    expect(() => parsePack({ ...base, schemaVersion: 11 })).toThrow(/版本过新/)
  })

  it("v8 系列的 front 解析成最底层 image 图层", () => {
    const pack = parsePack({
      ...base,
      schemaVersion: 8,
      cards: [{ id: "c1", num: 0, name: "", front: "assets/front.png" }],
    })
    const layer = pack.cards[0].layers[0]
    const image = layer.effects.find((e) => e.kind === "image")
    expect(image && image.kind === "image" ? image.params.path : "").toBe("assets/front.png")
    expect(pack.cards[0]).not.toHaveProperty("front")
  })

  it("v8 系列缺 aspect 时补 5:7", () => {
    expect(parsePack({ ...base, schemaVersion: 8 }).aspect).toBeCloseTo(2.5 / 3.5)
  })
})
