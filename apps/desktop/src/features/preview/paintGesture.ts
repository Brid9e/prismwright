/**
 * 擦除画笔的手势记账（纯状态，不碰 canvas / React，便于单测）。
 *
 * 一次「按下 → 抬起」是一笔。这一笔里有两件事要记准：
 *
 * 1. **撤销快照只记一次**，且必须取在**第一次落墨之前**——否则撤销会画回「已经有一笔」
 *    的画面，等于撤销没生效。
 * 2. 快照挂在「落墨」上而不是「按下」上。按下那一点可能落在卡面之外（`point` 为
 *    `null`，见 `uvToCanvasPoint`），用户拖进卡面才真正画出东西；若只在按下时记快照，
 *    这种笔画了却进不了撤销栈，撤销按钮一直是灰的。
 */

/** 擦除画布上的像素坐标（左上原点）。 */
export interface CanvasPoint {
  x: number
  y: number
}

/** 一次拖拽手势的状态。 */
export interface PaintGesture {
  /** 是否按着：`pointermove` 据此决定要不要落墨。 */
  drawing: boolean
  /** 上一次落墨的位置；这一笔还没落过墨时为 `null`（下一段只点一个圆点）。 */
  last: CanvasPoint | null
  /** 这一笔是恢复笔（画白）还是擦除笔（画黑）。 */
  restore: boolean
  /** 是否已为这一笔记下撤销快照。 */
  snapshotted: boolean
}

/** 未按下时的空手势。 */
export const IDLE_GESTURE: PaintGesture = {
  drawing: false,
  last: null,
  restore: false,
  snapshotted: false,
}

/**
 * 按下：开始一笔。
 *
 * @param restore - 这一笔是否恢复（画白）。
 * @param point - 按下处换算出的画布坐标；落在卡面之外为 `null`（手势照常跟踪，只是还没落墨）。
 */
export function startGesture(restore: boolean, point: CanvasPoint | null): PaintGesture {
  return { drawing: true, last: point, restore, snapshotted: false }
}

/**
 * 落墨前的记账：这一笔要不要先记一份撤销快照。
 *
 * 返回 `snapshot` 为真时调用方先把当前画布存进历史，再画；`gesture` 是翻过标记后的状态。
 * 没按下（不该有笔画）或本笔已记过时原样返回，故同一笔拖多长都只有一格历史。
 */
export function takeSnapshot(gesture: PaintGesture): { snapshot: boolean; gesture: PaintGesture } {
  if (!gesture.drawing || gesture.snapshotted) return { snapshot: false, gesture }
  return { snapshot: true, gesture: { ...gesture, snapshotted: true } }
}

/**
 * 落墨到 `point`：给出这一段的起点（`null` = 只点一个圆点）与推进后的手势。
 *
 * 回调方画完这一段后应当使用返回的 `gesture` 作为新的当前手势。
 */
export function inkTo(
  gesture: PaintGesture,
  point: CanvasPoint,
): { from: CanvasPoint | null; gesture: PaintGesture } {
  return { from: gesture.last, gesture: { ...gesture, last: point } }
}
