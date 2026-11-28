/**
 * Tooltip 薄封装。
 *
 * 用 Radix 原语保证键盘可达与定位正确；样式自绘以贴合编辑器观感（深色、紧凑、小圆角）。
 */
import type { ReactNode } from "react"
import * as RadixTooltip from "@radix-ui/react-tooltip"

/** Tooltip 的延迟与样式在根部统一设置，避免每个调用点各写一套。 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={400}>{children}</RadixTooltip.Provider>
}

/**
 * 给子元素挂一个文字提示。
 *
 * @param label - 提示文本（调用方负责翻译）。
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className="popover-shadow z-50 rounded-card border border-line-soft bg-panel px-2 py-1 text-label text-foreground"
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
