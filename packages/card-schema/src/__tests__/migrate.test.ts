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
  it("CURRENT_SCHEMA_VERSION 为 8", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(8)
  })

  it("高于当前版本 → 抛错", () => {
    expect(() => migrate({ ...base, schemaVersion: 9 })).toThrow(/版本过新/)
  })

  it("当前版本 → 原样返回同一引用", () => {
    const obj = { ...base, schemaVersion: 8 }
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

    expect(migrated.schemaVersion).toBe(8)
    expect(migrated.aspect).toBe(0.5)
    for (const c of migrated.cards) expect(c).not.toHaveProperty("aspect")
  })

  it("并列时取靠前的那张", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 7,
      cards: [card("c1", 2), card("c2", 0.5)],
    }) as Record<string, unknown>
    expect(migrated.aspect).toBe(2)
  })

  it("隐藏款也算票", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 7,
      cards: [card("c1", 0.5)],
      hiddenCards: [card("h1", 3), card("h2", 3)],
    }) as Record<string, unknown>
    expect(migrated.aspect).toBe(3)
  })

  it("没有卡时用卡背自己的比例", () => {
    const migrated = migrate({
      ...base,
      schemaVersion: 7,
      back: { front: "", aspect: 1.5 },
    }) as Record<string, unknown> & { back: Record<string, unknown> }
    expect(migrated.aspect).toBe(1.5)
    expect(migrated.back).not.toHaveProperty("aspect")
  })

  it("什么都没有时用缺省 5:7", () => {
    const migrated = migrate({ ...base, schemaVersion: 7 }) as Record<string, unknown>
    expect(migrated.aspect).toBeCloseTo(2.5 / 3.5)
  })

  it("缺 schemaVersion 的老数据也按同一规则上抬", () => {
    const migrated = migrate({ ...base, cards: [card("c1", 0.75)] }) as Record<string, unknown>
    expect(migrated.schemaVersion).toBe(8)
    expect(migrated.aspect).toBe(0.75)
  })

  it("不改动入参", () => {
    const raw = { ...base, schemaVersion: 7, cards: [card("c1", 0.5)] }
    migrate(raw)
    expect(raw.cards[0]).toHaveProperty("aspect", 0.5)
  })
})

describe("parsePack", () => {
  it("接受 v8 系列", () => {
    expect(parsePack({ ...base, schemaVersion: 8 }).schemaVersion).toBe(8)
  })

  it("拒绝 v9 系列（抛出）", () => {
    expect(() => parsePack({ ...base, schemaVersion: 9 })).toThrow(/版本过新/)
  })

  it("v7 系列解析后：比例在系列上，卡上没有", () => {
    const pack = parsePack({
      ...base,
      schemaVersion: 7,
      cards: [card("c1", 0.5), card("c2", 0.5)],
    })
    expect(pack.aspect).toBe(0.5)
    expect(pack.cards[0]).not.toHaveProperty("aspect")
  })

  it("v8 系列缺 aspect 时补 5:7", () => {
    expect(parsePack({ ...base, schemaVersion: 8 }).aspect).toBeCloseTo(2.5 / 3.5)
  })
})
