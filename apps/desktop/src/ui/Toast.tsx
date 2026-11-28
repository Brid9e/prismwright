/**
 * 轻量 Toast：只承载异步结果（保存失败、导出完成、资源缺失），不承载常规提示。
 *
 * 用模块级订阅表而非 Context：调用点多在 store / 流水线这类非组件代码里，
 * 它们拿不到 React 树。`ToastHost` 只负责渲染，挂一次即可。
 */
import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"

export type ToastTone = "info" | "success" | "error"

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

/** 自动消失时间（毫秒）。 */
const TOAST_MS = 2500

type Listener = (item: ToastItem) => void

const listeners = new Set<Listener>()
let seq = 0

/** 弹一条 Toast（调用方负责翻译文案）。 */
export function toast(message: string, tone: ToastTone = "info"): void {
  const item: ToastItem = { id: ++seq, message, tone }
  for (const listener of listeners) listener(item)
}

const TONE_ICON = {
  info: { Icon: Info, className: "text-muted" },
  success: { Icon: CheckCircle2, className: "text-success" },
  error: { Icon: AlertTriangle, className: "text-danger" },
} as const

/** Toast 渲染宿主；挂在应用根部即可。 */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const listener: Listener = (item) => {
      setItems((prev) => [...prev, item])
      // 单个条目的定时器独立；宿主卸载后 setState 是无害的 no-op。
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), TOAST_MS)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((item) => {
        const { Icon, className } = TONE_ICON[item.tone]
        return (
          <div
            key={item.id}
            role="status"
            className="popover-shadow flex items-center gap-2 rounded-card border border-line-soft bg-panel px-3 py-2 text-body text-foreground"
          >
            <Icon size={14} className={`shrink-0 ${className}`} />
            {item.message}
          </div>
        )
      })}
    </div>
  )
}
