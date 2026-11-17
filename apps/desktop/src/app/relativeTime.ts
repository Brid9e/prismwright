/**
 * 相对时间的**描述子**。
 *
 * 故意不返回成品文案，而是返回「是哪一类」——文案要过 i18n（中/英两套），
 * 把翻译留给组件，纯函数只负责分类，两者职责不混。
 */

/** 相对时间的分类结果。 */
export type RelativeTime =
  /** 同一自然日。 */
  | { kind: "today" }
  /** 前一个自然日。 */
  | { kind: "yesterday" }
  /** 2–6 个自然日之前。 */
  | { kind: "daysAgo"; days: number }
  /** 一周及以上，退化为具体日期 `YYYY/MM/DD`。 */
  | { kind: "date"; text: string }

/** 一天毫秒数。 */
const DAY_MS = 86_400_000

/** 取某时间戳所在**自然日**的本地零点。 */
function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 把时间戳归类成相对时间描述子。
 *
 * 用**自然日之差**而非 24 小时整除：否则「昨天 23:00」在今天 01:00 会被算成「今天」，
 * 与用户看日历的直觉不符。
 *
 * @param ms - 目标时间戳（epoch ms）。
 * @param now - 当前时间戳（epoch ms）；由调用方注入以便测试。
 * @returns 相对时间描述子。
 */
export function formatRelativeTime(ms: number, now: number): RelativeTime {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS)
  if (days <= 0) return { kind: "today" }
  if (days === 1) return { kind: "yesterday" }
  if (days < 7) return { kind: "daysAgo", days }
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return { kind: "date", text: `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}` }
}
