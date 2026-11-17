/**
 * 相对时间描述子的行为测试。
 *
 * 只看「分类对不对」，不测具体文案——文案是 i18n 的事，这里只保证归类正确。
 */
import { describe, it, expect } from "vitest"
import { formatRelativeTime } from "../relativeTime"

/** 构造某天当地正午的时间戳，避开夏令时与跨日边界。 */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

describe("formatRelativeTime", () => {
  it("同一天 → today", () => {
    expect(formatRelativeTime(at(2026, 10, 12, 9), at(2026, 10, 12, 20))).toEqual({ kind: "today" })
  })

  it("前一天 → yesterday（按自然日，而非 24 小时）", () => {
    // 23:00 → 次日 01:00 只差 2 小时，但跨了自然日，应算昨天。
    expect(formatRelativeTime(at(2026, 10, 11, 23), at(2026, 10, 12, 1))).toEqual({
      kind: "yesterday",
    })
  })

  it("2–6 天前 → daysAgo", () => {
    expect(formatRelativeTime(at(2026, 10, 9), at(2026, 10, 12))).toEqual({
      kind: "daysAgo",
      days: 3,
    })
  })

  it("满 7 天 → 具体日期", () => {
    expect(formatRelativeTime(at(2026, 10, 5), at(2026, 10, 12))).toEqual({
      kind: "date",
      text: "2026/10/05",
    })
  })

  it("未来时间（时钟回拨）不炸，按 today 处理", () => {
    expect(formatRelativeTime(at(2026, 10, 13), at(2026, 10, 12))).toEqual({ kind: "today" })
  })
})
