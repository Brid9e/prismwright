import { describe, it, expect } from "vitest"
import { createCard, createEmptyPack, type Pack } from "@prismwright/schema"
import {
  buildCardEntries,
  buildCardManifest,
  buildSeriesEntries,
  buildSeriesManifest,
  bundleFileName,
  formatBytes,
} from "../model"

function fixture(): { pack: Pack; card: ReturnType<typeof createCard> } {
  const pack = createEmptyPack("示例系列")
  const card = createCard(1, "图层 1")
  card.name = "星辰"
  card.front = "assets/front.png"
  pack.cards.push(card)
  return { pack, card }
}

const CREATED = "2026-11-06T00:00:00.000Z"

describe("bundle model", () => {
  it("系列清单记录卡数与创建时间", () => {
    const { pack } = fixture()
    expect(buildSeriesManifest(pack, "0.1.0", CREATED)).toEqual({
      format: "prismwright-bundle",
      version: 1,
      kind: "series",
      includesHistory: false,
      createdAt: CREATED,
      appVersion: "0.1.0",
      series: { id: pack.id, name: "示例系列", cardCount: 1 },
      card: null,
    })
  })

  it("单卡清单记录来源系列与所在列表", () => {
    const { pack, card } = fixture()
    const manifest = buildCardManifest(pack, card, "0.1.0", CREATED)
    expect(manifest.kind).toBe("card")
    expect(manifest.card).toEqual({ id: card.id, name: "星辰", list: "cards" })
    expect(manifest.series?.name).toBe("示例系列")
  })

  it("系列条目 = manifest + pack.json + 去重后的素材", () => {
    const { pack } = fixture()
    const manifest = buildSeriesManifest(pack, "0.1.0", CREATED)
    const entries = buildSeriesEntries(pack, manifest)
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "pack.json", "assets/front.png"])
    expect(entries[1]).toEqual({ name: "pack.json", source: "pack.json" })
    expect(entries[2]).toEqual({ name: "assets/front.png", source: "assets/front.png" })
  })

  it("单卡条目只含这张卡的素材", () => {
    const { pack, card } = fixture()
    const extra = createCard(2, "图层 1")
    extra.front = "assets/other.png"
    pack.cards.push(extra)
    const manifest = buildCardManifest(pack, card, "0.1.0", CREATED)
    const entries = buildCardEntries(card, manifest)
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "card.json", "assets/front.png"])
  })

  it("文件名去掉非法字符并使用对应后缀", () => {
    expect(bundleFileName("星辰/卡", "card")).toBe("星辰-卡.card")
    expect(bundleFileName("  ", "series")).toBe("series.cards")
  })

  it("体积按二进制单位格式化", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
  })

  it("系列包带上大 / 小封面文件", () => {
    const pack = createEmptyPack("P")
    pack.coverLarge = "covers/a.png"
    pack.coverSmall = "covers/b.gif"
    const names = buildSeriesEntries(pack, buildSeriesManifest(pack, "1.0.0", "t")).map(
      (e) => e.name,
    )
    expect(names).toContain("covers/a.png")
    expect(names).toContain("covers/b.gif")
  })

  it("单卡包不带封面", () => {
    const pack = createEmptyPack("P")
    pack.coverLarge = "covers/a.png"
    const card = createCard(1, "图层 1")
    const names = buildCardEntries(card, buildCardManifest(pack, card, "1.0.0", "t")).map(
      (e) => e.name,
    )
    expect(names.some((n) => n.startsWith("covers/"))).toBe(false)
  })
})
