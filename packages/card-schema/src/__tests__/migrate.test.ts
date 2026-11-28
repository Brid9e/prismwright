import { describe, it, expect } from "vitest"
import { CURRENT_SCHEMA_VERSION, migrate, parsePack } from "../migrate"

const base = {
  id: "p1",
  name: "包",
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
}

/** 一张只带比例的卡（v7 及以前每张卡各持一个 aspect）。 */
const card = (id: string, aspect: number) => ({ id, num: 0, name: "", aspect })

describe("migrate 版本守卫", () => {
  it("CURRENT_SCHEMA_VERSION 为 9", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(9)
  })

  it("高于当前版本 → 抛错", () => {
    expect(() => migrate({ ...base, schemaVersion: 10 })).toThrow(/版本过新/)
  })

  it("当前版本 → 原样返回同一引用", () => {
    const obj = { ...base, schemaVersion: 9 }
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

    expect(migrated.schemaVersion).toBe(9)
    expect(migrated.aspect).toBe(0.5)
    for (const c of migrated.cards) expect(c).not.toHaveProperty("aspect")
  })

  it("缺 schemaVersion 的老数据也按同一规则上抬", () => {
    const migrated = migrate({ ...base, cards: [card("c1", 0.75)] }) as Record<string, unknown>
    expect(migrated.schemaVersion).toBe(9)
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

describe("parsePack", () => {
  it("接受 v9 系列", () => {
    expect(parsePack({ ...base, schemaVersion: 9 }).schemaVersion).toBe(9)
  })

  it("拒绝 v10 系列（抛出）", () => {
    expect(() => parsePack({ ...base, schemaVersion: 10 })).toThrow(/版本过新/)
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
