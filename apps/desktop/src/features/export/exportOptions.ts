/**
 * 导出参数模型（纯逻辑：无 three、无 React）。
 *
 * 一份不可变的 {@link ExportOptions} 描述「导出什么、多大、多清晰、什么底」，由导出对话框编辑、
 * 由 {@link ./runExport} 消费。帧数、默认文件名、保存过滤器这类派生量都收在这里，UI 与编排只读不算，
 * 免得两处各推一份、越推越偏。
 */
import { EXPORT_SWAY_PERIOD } from "@cardbara/renderer/v1"
import type { FileFilter } from "../../tauri/pack-fs"

/** 导出格式。 */
export type ExportFormat = "gif" | "png" | "webm"

/** 背景：`transparent` = 透明；其余为纯色 hex（写进导出的像素，非主题色）。 */
export type ExportBackground = "transparent" | string

/** 一次导出的完整参数。 */
export interface ExportOptions {
  /** 输出格式。 */
  format: ExportFormat
  /** 输出宽度（像素）；高度按卡面比例推得。 */
  width: number
  /** 帧率；PNG 忽略。 */
  fps: number
  /** 背景（透明或纯色）。 */
  background: ExportBackground
  /** GIF 调色板色数（2–256）。 */
  gifColors: number
  /** GIF 是否启用抖动。 */
  gifDither: boolean
  /** WebM 的 CRF（0–63，越小画质越好、体积越大）。 */
  webmCrf: number
}

/** 尺寸下拉的预设宽度；不在此列的宽度走「自定义」。 */
export const EXPORT_SIZE_PRESETS = [512, 720, 1080] as const

/** 可选帧率。 */
export const EXPORT_FPS_OPTIONS = [12, 24, 30] as const

/** 默认导出参数：720 / 24fps / 透明 / GIF 256 色 + 抖动 / WebM CRF 30。 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "gif",
  width: 720,
  fps: 24,
  background: "transparent",
  gifColors: 256,
  gifDither: true,
  webmCrf: 30,
}

/**
 * 一次导出要渲多少帧。
 *
 * PNG 恒为 1（正面平视静帧）；GIF / WebM 覆盖一整个摆动循环：帧率 × {@link EXPORT_SWAY_PERIOD}。
 *
 * @param options - 导出参数。
 * @returns 帧数。
 */
export function exportFrameCount(options: ExportOptions): number {
  return options.format === "png" ? 1 : options.fps * EXPORT_SWAY_PERIOD
}

/** 文件名里不允许出现的字符（与 `app/path.ts` 的系列名规则同源，跨平台按最严处理）。 */
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g

/**
 * 由卡名与格式拼出「另存为」对话框的默认文件名。
 *
 * 卡名是用户数据，可能含路径分隔符或 Windows 保留字符——直接塞进默认文件名会让保存对话框
 * 收到非法建议。故把非法字符统一换成连字符，空名退化为 `card`。
 *
 * @param cardName - 卡片名。
 * @param format - 导出格式。
 * @returns 形如 `card-<卡名>.<ext>` 的默认文件名。
 */
export function exportFileName(cardName: string, format: ExportFormat): string {
  const safe = cardName.trim().replace(ILLEGAL_FILE_CHARS, "-")
  const base = safe ? `card-${safe}` : "card"
  return `${base}.${format}`
}

/**
 * 「另存为」对话框的文件类型过滤器。
 *
 * @param format - 导出格式。
 * @returns 单一扩展名的过滤器数组（与 Rust `pick_save_file` 的 `filters` 对应）。
 */
export function saveFilters(format: ExportFormat): FileFilter[] {
  switch (format) {
    case "gif":
      return [{ name: "GIF", extensions: ["gif"] }]
    case "png":
      return [{ name: "PNG", extensions: ["png"] }]
    case "webm":
      return [{ name: "WebM", extensions: ["webm"] }]
  }
}
