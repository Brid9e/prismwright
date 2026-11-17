/**
 * 把主题应用到 DOM：把 token 内联写入目标元素的 CSS 自定义属性。
 *
 * 为何用内联变量而非 `[data-theme]` 选择器（设计 §4）：对**动态导入**的主题零适配——
 * 无需为每个主题生成一条 CSS 规则；且写入的值是受校验的 `R G B` 三元组，`setProperty`
 * 无注入面。只覆盖 `--color-*`，因此组件与 Tailwind 零改动。
 *
 * 模块内记录「上一次写入的键」，切换主题时据此**精确清除**，不留残影、也不误删他处变量。
 */
import type { ThemeTokens } from "./types"

/** 可写入 CSS 自定义属性的最小目标（默认真实 DOM；测试注入假对象）。 */
export interface ThemeTarget {
  style: {
    setProperty: (property: string, value: string) => void
    removeProperty: (property: string) => void
  }
}

/** 上一次由本模块写入的 token 名，用于下次切换时清除。 */
let appliedKeys = new Set<string>()

/**
 * 应用一个主题。
 *
 * @param tokens - 要写入的 token 映射；传 `null`（或空对象）即回到 `tokens.css` 的
 *   `:root` 默认。
 * @param root - 写入目标；默认真实 `document.documentElement`。测试可注入假对象。
 */
export function applyTheme(
  tokens: ThemeTokens | null,
  root: ThemeTarget = document.documentElement,
): void {
  for (const key of appliedKeys) root.style.removeProperty(key)
  appliedKeys = new Set()

  if (!tokens) return
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value)
    appliedKeys.add(key)
  }
}
