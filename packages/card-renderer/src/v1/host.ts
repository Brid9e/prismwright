/**
 * 视图宿主：渲染器需要的全部环境能力。
 *
 * 浏览器与小程序只差这一层——canvas、尺寸、像素比、指针、帧调度。桌面端用
 * {@link createDomHost}，小程序端提供同形状的实现即可复用同一份卡面逻辑。
 */

/** three 只用到这些 canvas 成员；小程序节点由宿主补齐后满足此形状。 */
export interface CanvasLike {
  getContext(type: string, attrs?: unknown): unknown
  width: number
  height: number
  style: Record<string, unknown>
  addEventListener(type: string, cb: unknown, opts?: unknown): void
  removeEventListener(type: string, cb: unknown, opts?: unknown): void
  remove(): void
}

export interface HostPointerHandlers {
  /** 按下：坐标相对 canvas 左上角，CSS 像素。 */
  down(x: number, y: number): void
  move(x: number, y: number): void
  up(): void
}

export interface CardViewHost {
  canvas: CanvasLike
  /** 当前像素比；渲染器会再经 {@link clampPixelRatio} 夹一次。 */
  pixelRatio(): number
  /** 画布当前尺寸（CSS 像素）。 */
  size(): { width: number; height: number }
  /** 订阅尺寸变化；返回取消订阅。 */
  onResize(cb: (size: { width: number; height: number }) => void): () => void
  /** 订阅拖拽；返回取消订阅。 */
  onPointer(handlers: HostPointerHandlers): () => void
  /** three 是否同步 canvas 的 CSS 尺寸；小程序传 false（它的 style 是补出来的空对象）。 */
  updateStyle?: boolean
  /** 帧时钟；缺省 `performance.now`。 */
  now?(): number
  /** 帧调度；缺省 `requestAnimationFrame`。 */
  requestFrame?(cb: (t: number) => void): number
  /** 取消帧调度；缺省 `cancelAnimationFrame`。 */
  cancelFrame?(id: number): void
}

/**
 * 像素比上限。
 *
 * 卡面全是圆角、细线和高对比的蒙版边，采样不足就直接表现为锯齿，所以上限要够到
 * 真机像素比：夹到 2 时，3x 屏上每三个显示像素只摊到两个渲染像素，边缘发毛。
 * 再往上（4x 起）收益抵不过填充开销，故停在 3。
 */
export function clampPixelRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  return Math.min(ratio, 3)
}

/** 浏览器宿主：canvas 由宿主创建并挂进容器。 */
export function createDomHost(container: HTMLElement): CardViewHost {
  const canvas = document.createElement("canvas")
  canvas.style.display = "block"
  canvas.style.cursor = "grab"
  canvas.style.touchAction = "none"
  container.appendChild(canvas)

  // 抽成具名函数：onResize 的回调里也要用，避免依赖对象方法上的 `this`。
  const size = () => ({ width: container.clientWidth || 1, height: container.clientHeight || 1 })

  return {
    canvas: canvas as unknown as CanvasLike,
    pixelRatio: () => window.devicePixelRatio,
    size,
    onResize(cb) {
      const ro = new ResizeObserver(() => cb(size()))
      ro.observe(container)
      return () => ro.disconnect()
    },
    onPointer(handlers) {
      const down = (ev: PointerEvent) => {
        // 只接管主键（左键 / 触摸 / 笔尖）；其余按键留给别的用途。
        if (ev.button !== 0) return
        // 捕获指针：拖到容器外仍持续收到 move / up，不会中途掉链子。
        container.setPointerCapture(ev.pointerId)
        canvas.style.cursor = "grabbing"
        handlers.down(ev.clientX, ev.clientY)
      }
      const move = (ev: PointerEvent) => {
        if (!container.hasPointerCapture(ev.pointerId)) return
        handlers.move(ev.clientX, ev.clientY)
      }
      const up = (ev: PointerEvent) => {
        if (!container.hasPointerCapture(ev.pointerId)) return
        container.releasePointerCapture(ev.pointerId)
        canvas.style.cursor = "grab"
        handlers.up()
      }
      container.addEventListener("pointerdown", down)
      container.addEventListener("pointermove", move)
      container.addEventListener("pointerup", up)
      container.addEventListener("pointercancel", up)
      return () => {
        container.removeEventListener("pointerdown", down)
        container.removeEventListener("pointermove", move)
        container.removeEventListener("pointerup", up)
        container.removeEventListener("pointercancel", up)
        canvas.style.cursor = ""
        canvas.style.touchAction = ""
      }
    },
  }
}
