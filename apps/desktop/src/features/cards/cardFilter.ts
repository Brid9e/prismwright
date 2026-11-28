/**
 * 卡片库的过滤逻辑（纯函数）。
 *
 * 两件事必须正交：**分组**（全部 / 隐藏款 / 卡背）先筛池子，**查询**再筛名字与编号。
 * 合在一起写容易出现「在隐藏款里搜到普通卡」这类串组问题。
 *
 * 编号同时接受两种写法：界面上显示的是数字（`101`），用户习惯手打 `e101`。
 */

/** 卡片库的分组。卡背是系列级对象，不属于任何卡片池。 */
export type CardSection = "all" | "hidden" | "back"

export interface CardFilterOptions {
  /** 搜索词；首尾空白忽略，空串表示不筛。 */
  query: string
  section: CardSection
}

/** 过滤所需的最小字段（测试与列表都能满足）。 */
export interface FilterableCard {
  num: number
  name: string
}

/** 按分组与查询过滤卡片；`back` 分组恒为空。 */
export function filterCards<T extends FilterableCard>(
  groups: { cards: T[]; hiddenCards: T[] },
  { query, section }: CardFilterOptions,
): T[] {
  if (section === "back") return []
  const pool = section === "hidden" ? groups.hiddenCards : [...groups.cards, ...groups.hiddenCards]
  const q = query.trim().toLowerCase()
  if (!q) return pool
  return pool.filter((card) => matches(card, q))
}

function matches(card: FilterableCard, query: string): boolean {
  if (card.name.toLowerCase().includes(query)) return true
  const num = String(card.num)
  return num.startsWith(query) || `e${num}`.startsWith(query)
}
