/**
 * `.card` / `.cards` 的清单模型与条目构造。
 *
 * 纯数据层：只把 `Pack` / `Card` 翻译成 Rust 需要的条目表，不碰文件系统、不调 `invoke`。
 * 条目路径一律是**系列根目录内的相对路径**——Rust 侧用 `safe_join` 解析，导出接口因此
 * 不依赖「绝对路径」这个概念（见设计文档 §5.2）。
 */
import {
  collectCardAssets,
  collectCoverAssets,
  collectPackAssets,
  type Card,
  type Pack,
} from "@cardbara/schema"
import { sanitizeFileBase } from "../../app/path"

/** 清单里的格式标识。 */
export const BUNDLE_FORMAT = "cardbara-bundle"
/** 当前格式版本。 */
export const BUNDLE_VERSION = 1

/** 工程文件类型。 */
export type BundleKind = "card" | "series"

/** `manifest.json` 的结构。 */
export interface BundleManifest {
  format: typeof BUNDLE_FORMAT
  version: typeof BUNDLE_VERSION
  kind: BundleKind
  /** 是否带 `history.json`（撤销历史）。普通分享恒为 `false`，云端备份为 `true`。 */
  includesHistory: boolean
  createdAt: string
  appVersion: string
  /** 系列信息；单卡包记录来源系列。 */
  series: { id: string; name: string; cardCount: number } | null
  /** 单卡信息；系列包为 `null`。 */
  card: { id: string; name: string; list: "cards" | "hiddenCards" } | null
}

/**
 * 传给 Rust 的一个条目。
 *
 * `source` 是系列内的相对路径；`contents` 是直接给出的文本。二者只能出现一个。
 */
export type BundleEntry =
  | { name: string; source: string }
  | { name: string; contents: string }

/** 构造系列包的清单。 */
export function buildSeriesManifest(
  pack: Pack,
  appVersion: string,
  createdAt: string,
): BundleManifest {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: "series",
    includesHistory: false,
    createdAt,
    appVersion,
    series: { id: pack.id, name: pack.name, cardCount: pack.cards.length },
    card: null,
  }
}

/** 构造单卡包的清单。 */
export function buildCardManifest(
  pack: Pack,
  card: Card,
  appVersion: string,
  createdAt: string,
): BundleManifest {
  const hidden = pack.hiddenCards.some((c) => c.id === card.id)
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: "card",
    includesHistory: false,
    createdAt,
    appVersion,
    series: { id: pack.id, name: pack.name, cardCount: pack.cards.length },
    card: { id: card.id, name: card.name, list: hidden ? "hiddenCards" : "cards" },
  }
}

/** 系列包条目：清单 + `pack.json` + 去重后的素材。 */
export function buildSeriesEntries(pack: Pack, manifest: BundleManifest): BundleEntry[] {
  return [
    { name: "manifest.json", contents: JSON.stringify(manifest, null, 2) },
    // 由 Rust 从系列根目录读取磁盘上的 pack.json：调用方已先 save()，这里再序列化一遍
    // 反而可能与落盘内容不一致。
    { name: "pack.json", source: "pack.json" },
    ...collectPackAssets(pack).map((rel) => ({ name: rel, source: rel })),
    // 封面单独收集：它们不在 collectPackAssets 里（那条管线会重编码，封面必须原样）。
    ...collectCoverAssets(pack).map((rel) => ({ name: rel, source: rel })),
  ]
}

/** 单卡包条目：清单 + `card.json` + 这张卡的素材。 */
export function buildCardEntries(card: Card, manifest: BundleManifest): BundleEntry[] {
  return [
    { name: "manifest.json", contents: JSON.stringify(manifest, null, 2) },
    { name: "card.json", contents: JSON.stringify(card, null, 2) },
    ...collectCardAssets(card).map((rel) => ({ name: rel, source: rel })),
  ]
}

/** 由展示名生成导出文件名（含扩展名）。 */
export function bundleFileName(name: string, kind: BundleKind): string {
  const ext = kind === "card" ? "card" : "cards"
  return `${sanitizeFileBase(name, kind)}.${ext}`
}

/** 以二进制单位格式化字节数（如 `1.5 KB`）。 */
export function formatBytes(n: number): string {
  if (n === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}
