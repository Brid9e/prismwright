import { describe, expect, it } from "vitest"
import { ALBUM_PAGE_SIZE, PackSchema } from "../schema"
import { createEmptyPack } from "../defaults"

const minimal = {
  schemaVersion: 8 as const,
  id: "p1",
  name: "水豚大明星",
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
}

/** 生成一页 9 格，前 n 格填卡片 id，其余为空格。 */
const page = (...ids: string[]): (string | null)[] => {
  const slots: (string | null)[] = new Array(ALBUM_PAGE_SIZE).fill(null)
  ids.forEach((id, i) => {
    slots[i] = id
  })
  return slots
}

describe("PackSchema.album", () => {
  it("缺省时为空卡册（不升 schemaVersion）", () => {
    const pack = PackSchema.parse(minimal)
    expect(pack.schemaVersion).toBe(8)
    expect(pack.album).toEqual({ pages: [] })
  })

  it("接受固定 9 格的分页，空格用 null 表示", () => {
    const pack = PackSchema.parse({
      ...minimal,
      album: { pages: [page("c1", "c2"), page("c3")] },
    })
    expect(pack.album.pages).toHaveLength(2)
    expect(pack.album.pages[0]).toEqual(page("c1", "c2"))
    expect(pack.album.pages[1][0]).toBe("c3")
    expect(pack.album.pages[1][8]).toBeNull()
  })

  it("拒绝不是恰好 9 格的一页", () => {
    expect(() =>
      PackSchema.parse({ ...minimal, album: { pages: [["c1", "c2"]] } }),
    ).toThrow()
    expect(() =>
      PackSchema.parse({
        ...minimal,
        album: { pages: [new Array(ALBUM_PAGE_SIZE + 1).fill(null)] },
      }),
    ).toThrow()
  })

  it("拒绝空串卡片 id", () => {
    expect(() =>
      PackSchema.parse({ ...minimal, album: { pages: [page("")] } }),
    ).toThrow()
  })

  it("默认空卡册的 pages 是空数组，可继续追加页", () => {
    expect(ALBUM_PAGE_SIZE).toBe(9)
    const pack = createEmptyPack("水豚大明星")
    expect(pack.album).toEqual({ pages: [] })
  })
})
