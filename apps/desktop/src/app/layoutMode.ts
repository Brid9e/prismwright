/**
 * 工作区布局模式：工作室 / 专注 / 紧凑。
 *
 * 列宽用百分比表达（`react-resizable-panels` 的单位），与设计文档的像素目标对应：
 * 1440 宽下 18% ≈ 236、26% ≈ 348、5% ≈ 72。切换模式时由 `Splitter` 命令式地
 * `resize()`/`collapse()`；用户随后拖分栏的结果由面板库自己持久化。
 */
import { load } from "@tauri-apps/plugin-store"

export const LAYOUT_MODES = ["studio", "focus", "compact"] as const

export type LayoutMode = (typeof LAYOUT_MODES)[number]

export interface LayoutSizes {
  /** 左栏宽度（百分比）；0 表示收起。 */
  left: number
  /** 右栏宽度（百分比）。 */
  right: number
}

export const LAYOUT_SIZES: Record<LayoutMode, LayoutSizes> = {
  studio: { left: 18, right: 26 },
  focus: { left: 0, right: 26 },
  // 右栏 24%：1024 宽窗口下约 242px，再窄检查器的滑轨与页签就没法用了。
  compact: { left: 5, right: 24 },
}

/** 取某个模式的列宽；未知值回落工作室。 */
export function layoutSizes(mode: LayoutMode): LayoutSizes {
  return LAYOUT_SIZES[mode] ?? LAYOUT_SIZES.studio
}

/** 校验任意字符串是否为合法模式。 */
export function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === "string" && (LAYOUT_MODES as readonly string[]).includes(value)
}

const STORE_PATH = "preferences.json"
const LAYOUT_KEY = "layout"

/** 读取持久化的布局模式；未保存或读取失败时回退工作室。 */
export async function loadLayoutMode(): Promise<LayoutMode> {
  try {
    const store = await load(STORE_PATH)
    const saved = await store.get<unknown>(LAYOUT_KEY)
    return isLayoutMode(saved) ? saved : "studio"
  } catch {
    return "studio"
  }
}

/** 持久化布局模式；写失败不影响本次会话。 */
export async function saveLayoutMode(mode: LayoutMode): Promise<void> {
  try {
    const store = await load(STORE_PATH)
    await store.set(LAYOUT_KEY, mode)
    await store.save()
  } catch {
    // 写失败只影响下次启动的默认布局，不打断用户。
  }
}
