/**
 * `findCard` 纯选择器的行为测试。
 *
 * 覆盖用例：
 * - 命中 `cards`（普通卡）；
 * - 命中 `hiddenCards`（隐藏款）——这正是此前漏搜 `hiddenCards` 的读点所暴露的
 *   回归，必须显式钉住；
 * - 未知 id、`null` 系列、`null` cardId 一律返回 `null`。
 *
 * 依赖处理：`findCard` 是纯函数，本可零依赖，但导入 `../packStore` 会连带加载其
 * 顶部 `packFs` 依赖，故与 `trash.test.ts` 一致地整体 mock `../../tauri/pack-fs`，
 * 避免触发 `invoke`。测试用手写字面量对象，不经 store 构造。
 */
import { describe, it, expect, vi } from "vitest"
import { DEFAULT_PACK_ART_STYLE } from "@cardbara/schema"

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

import type { Card, Pack } from "@cardbara/schema"
import { findCard } from "../packStore"

/** 手写一张最小可用的卡片，仅 id 参与查找断言。 */
function card(id: string): Card {
  return {
    id,
    num: 1,
    name: "",
    notes: "",
    rarity: "common",
    front: "",
    // 底图调整字段：本测试只查 id，取 schema 默认值即可。
    frontFit: "cover",
    frontOffsetX: 0,
    frontOffsetY: 0,
    frontScale: 1,
    frontRotation: 0,
    frontBumpStrength: 0,
    frontBumpDetail: 0.01,
    frontBumpFlow: 0.5,
    frontBumpLight: 1,
    frontBumpLightAngle: 127,
    frontBumpLightColor: "#ffffff",
    frontBumpInvert: false,
    frontNormalPath: "",
    frontNormalFlipY: false,
    finish: "standard",
    glassStrength: 0.6,
    glassRoughness: 0.15,
    glassTint: "#ffffff",
    cornerRadius: 0.06,
    // 效果栈列表默认为空；本测试仅断言 id 查找，不涉及效果。
    effects: [],
    layers: [],
  }
}

/** 手写一个最小可用的系列；两份卡片列表由调用方分别注入。 */
function pack(cards: Card[], hiddenCards: Card[]): Pack {
  return {
    schemaVersion: 8,
    editorVersion: "v1",
    id: "pack-1",
    name: "P",
    notes: "",
    back: null,
    // 比例在系列上（v8 起），正反面共用。
    aspect: 2.5 / 3.5,
    cards,
    hiddenCards,
    album: { pages: [] },
    rarityGradients: {},
    rarityProbabilities: {},
    synthesisMergeRatios: {},
    // 系列封面：本测试只按 id 查找，不涉及封面资源。
    coverLarge: "",
    coverSmall: "",
    packArt: "",
    avatarFrame: "",
    achievementIcon: "",
    seriesAvatar: "",
    // 袋面合成参数：本测试不涉及，取 schema 默认值。
    packArtStyle: { ...DEFAULT_PACK_ART_STYLE },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("findCard", () => {
  it("能在 cards（普通卡）中按 id 找到卡片", () => {
    const target = card("c1")
    expect(findCard(pack([target], []), "c1")).toBe(target)
  })

  it("能在 hiddenCards（隐藏款）中按 id 找到卡片", () => {
    const target = card("h1")
    expect(findCard(pack([], [target]), "h1")).toBe(target)
  })

  it("未知 id 返回 null", () => {
    expect(findCard(pack([card("c1")], [card("h1")]), "nope")).toBeNull()
  })

  it("pack 为 null 时返回 null", () => {
    expect(findCard(null, "c1")).toBeNull()
  })

  it("cardId 为 null 时返回 null", () => {
    expect(findCard(pack([card("c1")], []), null)).toBeNull()
  })
})
