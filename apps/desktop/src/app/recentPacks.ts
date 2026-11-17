/**
 * 「最近打开」列表的持久化。
 *
 * 与 `language.ts` 同款：走 `tauri-plugin-store` 的 `preferences.json`（同一文件、
 * 另起键名）。读写失败一律静默回退——首选项读不出来不该拦住应用启动。
 */
import { load } from "@tauri-apps/plugin-store"

/** 存储文件与键名（与语言共用同一份 preferences.json）。 */
const STORE_PATH = "preferences.json"
const RECENT_KEY = "recentPacks"

/** 「最近打开」列表的上限；超出即丢弃最旧的。 */
export const RECENT_LIMIT = 10

/** 一条最近打开记录。 */
export interface RecentPack {
  /** 系列名（取自 pack.json 的 `name`）。 */
  name: string
  /** 系列根目录绝对路径，兼作去重键。 */
  rootDir: string
  /** 打开时间（epoch ms）。 */
  openedAt: number
}

/** 校验磁盘上的一条记录形状；旧版或手改过的坏数据据此过滤。 */
function isRecentPack(value: unknown): value is RecentPack {
  if (typeof value !== "object" || value === null) return false
  const o = value as Record<string, unknown>
  return (
    typeof o.name === "string" && typeof o.rootDir === "string" && typeof o.openedAt === "number"
  )
}

/**
 * 读取最近打开列表。
 *
 * @returns 已保存且形状合法的记录；未保存或读取失败时回退空数组。
 */
export async function loadRecentPacks(): Promise<RecentPack[]> {
  try {
    const store = await load(STORE_PATH)
    const saved = await store.get<RecentPack[]>(RECENT_KEY)
    return Array.isArray(saved) ? saved.filter(isRecentPack) : []
  } catch {
    return []
  }
}

/**
 * 持久化最近打开列表。
 *
 * @param list - 要写入的完整列表。
 */
export async function saveRecentPacks(list: RecentPack[]): Promise<void> {
  try {
    const store = await load(STORE_PATH)
    await store.set(RECENT_KEY, list)
    await store.save()
  } catch {
    // 写失败只影响下次启动的列表，不打断用户。
  }
}
