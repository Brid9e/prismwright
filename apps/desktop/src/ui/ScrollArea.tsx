/**
 * 覆盖式滚动条：原生滚动保留，滚动条浮在内容上、不占布局宽度。
 *
 * 内层仍用 `overflow-y-auto`，键盘与触控板滚动完全走浏览器；只把原生滚动条藏掉，
 * 再画一条绝对定位的滑块。滑块高度 / 位置由 `scrollbar-math.ts` 的纯函数计算。
 *
 * 内容高度会随效果展开、换卡、窗口缩放变化，故用 `ResizeObserver` 同时观察视口与内容包装层。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { scrollbarMetrics, type ScrollbarMetrics } from "./scrollbar-math"

export interface ScrollAreaProps {
  children: ReactNode
  /** 外层（弹性 / 尺寸）类名。 */
  className?: string
  /** 滚动视口类名（内边距等）。 */
  viewportClassName?: string
  ariaLabel?: string
}

const HIDDEN: ScrollbarMetrics = { visible: false, thumbHeight: 0, thumbTop: 0 }

export function ScrollArea({
  children,
  className = "",
  viewportClassName = "",
  ariaLabel,
}: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<ScrollbarMetrics>(HIDDEN)
  const [active, setActive] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
  const dragOrigin = useRef<{ y: number; scrollTop: number } | null>(null)

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    setMetrics(
      scrollbarMetrics({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        trackHeight: el.clientHeight,
      }),
    )
  }, [])

  const showTemporarily = useCallback(() => {
    setActive(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setActive(false), 800)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    if (content) observer.observe(content)
    const onScroll = () => {
      measure()
      showTemporarily()
    }
    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      observer.disconnect()
      viewport.removeEventListener("scroll", onScroll)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [measure, showTemporarily])

  function onThumbPointerDown(event: PointerEvent<HTMLDivElement>) {
    const el = viewportRef.current
    if (!el || !metrics.visible) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    dragOrigin.current = { y: event.clientY, scrollTop: el.scrollTop }
    showTemporarily()
  }

  function onThumbPointerMove(event: PointerEvent<HTMLDivElement>) {
    const el = viewportRef.current
    const origin = dragOrigin.current
    if (!el || !origin || !dragging.current) return
    const track = el.clientHeight
    const thumb = Math.max(1, metrics.thumbHeight)
    const maxThumbTop = Math.max(1, track - thumb)
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    const delta = ((event.clientY - origin.y) / maxThumbTop) * maxScrollTop
    el.scrollTop = Math.min(maxScrollTop, Math.max(0, origin.scrollTop + delta))
    measure()
    showTemporarily()
  }

  function endThumbDrag() {
    dragging.current = false
    dragOrigin.current = null
  }

  return (
    <div
      className={`relative min-h-0 ${className}`}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => {
        if (!dragging.current) setActive(false)
      }}
    >
      <div
        ref={viewportRef}
        aria-label={ariaLabel}
        className={`scroll-area h-full overflow-y-auto overflow-x-hidden ${viewportClassName}`}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {metrics.visible && (
        <div
          aria-hidden
          className={`absolute right-1 z-10 w-2 cursor-default touch-none rounded-full bg-line transition-opacity ${
            active ? "opacity-100" : "opacity-0"
          }`}
          style={{ top: metrics.thumbTop, height: metrics.thumbHeight }}
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={endThumbDrag}
          onPointerCancel={endThumbDrag}
        />
      )}
    </div>
  )
}
