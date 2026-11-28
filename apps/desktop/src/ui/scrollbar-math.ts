/**
 * 覆盖式滚动条的几何计算（纯函数，便于 node 单测）。
 *
 * 滑块高度按 `clientHeight / scrollHeight` 缩短，最小 `minThumb`；位置按滚动进度映射到
 * 轨道剩余高度。所有输入都先做有限性检查，避免 NaN 把滑块写进样式。
 */
export interface ScrollbarMetricsInput {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  /** 轨道高度（这里等于视口高度）。 */
  trackHeight: number
  /** 最小滑块高度，默认 24。 */
  minThumb?: number
}

export interface ScrollbarMetrics {
  visible: boolean
  thumbHeight: number
  thumbTop: number
}

const HIDDEN: ScrollbarMetrics = { visible: false, thumbHeight: 0, thumbTop: 0 }

export function scrollbarMetrics(input: ScrollbarMetricsInput): ScrollbarMetrics {
  const { scrollTop, scrollHeight, clientHeight, trackHeight } = input
  const minThumb = input.minThumb ?? 24
  if (
    ![scrollTop, scrollHeight, clientHeight, trackHeight].every(Number.isFinite) ||
    trackHeight <= 0 ||
    clientHeight <= 0 ||
    scrollHeight <= clientHeight
  ) {
    return HIDDEN
  }
  const thumbHeight = Math.max(
    minThumb,
    Math.min(trackHeight, (clientHeight / scrollHeight) * trackHeight),
  )
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const maxScrollTop = scrollHeight - clientHeight
  const progress = maxScrollTop > 0 ? Math.min(1, Math.max(0, scrollTop / maxScrollTop)) : 0
  return { visible: true, thumbHeight, thumbTop: progress * maxThumbTop }
}
