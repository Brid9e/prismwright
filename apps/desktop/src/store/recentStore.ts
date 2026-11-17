/**
 * recentStore —— 「最近打开」列表与其失效标记。
 *
 * 单独成 store 而非并入 `uiStore`：`uiStore` 的定位是「非数据态、不落盘」，
 * 而最近列表是**持久化的应用级数据**——分开让两者的定位都保持干净。
 *
 * `missing` 只活在当前会话（不落盘）：它描述的是「此刻磁盘上找不找得到」，
 * 下次启动重新探测即可，存下来反而会过期。
 */
import { create } from "zustand"
import { packFs } from "../tauri/pack-fs"
import { RECENT_LIMIT, loadRecentPacks, saveRecentPacks, type RecentPack } from "../app/recentPacks"

/** `useRecentStore` 的完整状态形状。 */
export interface RecentStoreState {
  /** 最近打开的系列，索引 0 最新。 */
  recent: RecentPack[]
  /** 根目录 → 已失效标记；不落盘。 */
  missing: Record<string, true>

  /** 从磁盘读入最近列表。 */
  load: () => Promise<void>
  /** 记录一次成功打开：置顶 + 去重 + 截断，并落盘。 */
  push: (entry: { name: string; rootDir: string }) => Promise<void>
  /** 从列表移除一条（用户手动清理失效项）。 */
  remove: (rootDir: string) => Promise<void>
  /**
   * 改某一条的显示名（系列改名后同步）。
   *
   * 与 `push` 的区别：不置顶、不刷新 `openedAt`——改名不是「打开」。找不到该条时原样返回。
   */
  rename: (rootDir: string, name: string) => Promise<void>
  /** 清空整个列表。 */
  clear: () => Promise<void>
  /** 批量探测各条是否仍是有效系列目录，写 `missing`。 */
  probeMissing: () => Promise<void>
}

/**
 * 把一条记录并入列表：置顶、按 `rootDir` 去重、截断到上限。
 *
 * 抽成纯函数——去重/截断是这份数据唯一「有算法」的地方，值得单测钉住。
 *
 * @param list - 现有列表。
 * @param entry - 新记录（不含时间）。
 * @param now - 当前时间戳，由调用方注入以便测试。
 * @returns 新列表。
 */
export function upsertRecent(
  list: RecentPack[],
  entry: { name: string; rootDir: string },
  now: number,
): RecentPack[] {
  const rest = list.filter((r) => r.rootDir !== entry.rootDir)
  return [{ name: entry.name, rootDir: entry.rootDir, openedAt: now }, ...rest].slice(
    0,
    RECENT_LIMIT,
  )
}

/** 从 `missing` 里摘掉一个键；不存在则原样返回，避免无谓的引用变化。 */
function omitMissing(missing: Record<string, true>, key: string): Record<string, true> {
  if (!missing[key]) return missing
  const next = { ...missing }
  delete next[key]
  return next
}

export const useRecentStore = create<RecentStoreState>()((set, get) => ({
  recent: [],
  missing: {},

  load: async () => {
    set({ recent: await loadRecentPacks() })
  },

  push: async (entry) => {
    const next = upsertRecent(get().recent, entry, Date.now())
    set({ recent: next, missing: omitMissing(get().missing, entry.rootDir) })
    await saveRecentPacks(next)
  },

  remove: async (rootDir) => {
    const next = get().recent.filter((r) => r.rootDir !== rootDir)
    set({ recent: next, missing: omitMissing(get().missing, rootDir) })
    await saveRecentPacks(next)
  },

  rename: async (rootDir, name) => {
    const { recent } = get()
    if (!recent.some((r) => r.rootDir === rootDir)) return
    const next = recent.map((r) => (r.rootDir === rootDir ? { ...r, name } : r))
    set({ recent: next })
    await saveRecentPacks(next)
  },

  clear: async () => {
    set({ recent: [], missing: {} })
    await saveRecentPacks([])
  },

  probeMissing: async () => {
    const { recent } = get()
    // 并发探测后一次性写入：逐条 set 会让启动屏的灰显逐个跳出来；最多 10 条，并发无压力。
    const results = await Promise.all(
      recent.map(
        async (r) => [r.rootDir, await packFs.isPackDir(r.rootDir).catch(() => false)] as const,
      ),
    )
    const missing: Record<string, true> = {}
    for (const [rootDir, ok] of results) if (!ok) missing[rootDir] = true
    set({ missing })
  },
}))
