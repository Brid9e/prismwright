/**
 * 擦除绘画的**会话内**步进历史（与画布 / React 无关，便于单测）。
 *
 * 绘画期间按 Ctrl+Z 要撤销的是「刚画的那一笔」，而不是底层 pack 的编辑历史——后者会把
 * 卡片在画笔底下改掉（甚至删掉正在画的擦除效果），既看不懂也会让「完成」落空。
 *
 * 一次 按下→抬起 记一步：落笔前把画布快照压入 `past`，撤销时弹出并恢复。会话结束即丢弃，
 * 与 pack 的撤销栈完全隔离。
 */
export interface StrokeHistory<T> {
  /** 「这一笔覆盖之前」的画布快照，最新在末尾；长度即已生效的笔画数。 */
  past: T[]
  /** 被撤销掉的那几笔「撤销时画布的样子」，最新在末尾；新落笔会清空。 */
  future: T[]
}

/**
 * 最多记住多少笔。
 *
 * 快照是整张画布的 `ImageData`（500×700×4 ≈ 1.4 MB），20 步即约 28 MB 封顶；
 * 再往前就丢最早的快照——绘画过程中真正要撤销的通常只是刚画错的那几笔。
 */
export const STROKE_HISTORY_LIMIT = 20

export function emptyStrokeHistory<T>(): StrokeHistory<T> {
  return { past: [], future: [] }
}

/**
 * 记一步：把「落笔前」的快照压栈，并清空重做栈（新分支覆盖旧的重做路径）。
 */
export function pushStroke<T>(history: StrokeHistory<T>, before: T): void {
  history.past.push(before)
  if (history.past.length > STROKE_HISTORY_LIMIT) history.past.shift()
  history.future.length = 0
}

/**
 * 撤销一步。
 *
 * @param current - 撤销**前**画布的当前状态，转入重做栈。
 * @returns 要恢复的快照；没有可撤销的笔画时返回 `null`（历史不变）。
 */
export function undoStroke<T>(history: StrokeHistory<T>, current: T): T | null {
  const before = history.past.pop()
  if (before === undefined) return null
  history.future.push(current)
  return before
}

/**
 * 重做一步。
 *
 * @param current - 重做**前**画布的当前状态，作为这一笔的新「之前快照」重新计入 `past`。
 * @returns 要恢复的快照；没有可重做的内容时返回 `null`（历史不变）。
 */
export function redoStroke<T>(history: StrokeHistory<T>, current: T): T | null {
  const after = history.future.pop()
  if (after === undefined) return null
  history.past.push(current)
  return after
}
