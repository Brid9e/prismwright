/**
 * 前端 ↔ Rust 宿主的**导出**桥。
 *
 * 与 `pack-fs.ts` / `ffmpeg.ts` 同构：每个方法与 `src-tauri/src/commands.rs` 中的一个
 * `#[tauri::command]` 一一对应。导出与预览的分野——预览产物落在**系列内**（`write_bytes_atomic`），
 * 导出产物落在**用户自选的任意路径**（`write_file_at` / `encode_export` 的输出）。
 *
 * 命名约定（Tauri v2）：`invoke` 把 JS 侧 **camelCase 参数名**映射为 Rust 侧 **snake_case 形参名**。
 */
import { invoke } from "@tauri-apps/api/core"
import type { ExportFormat } from "../features/export/exportOptions"
import type { FileFilter } from "./pack-fs"

/**
 * 与 `commands::encode_export` 一一对应的参数（格式限 GIF / WebM）。
 *
 * 用 `type` 而非 `interface`：`invoke` 的 `args` 形参是 `Record<string, unknown>`，只有对象字面量
 * **类型**（`type X = {…}`）才带隐式索引签名，`interface` 不带——直接传会被 TS 判为不可赋值。
 */
export type EncodeExportParams = {
  /** 系列根目录绝对路径。 */
  packRoot: string
  /** 帧目录在系列内的相对路径（帧按 `frame_0001.png`… 命名）。 */
  framesRel: string
  /** 产物绝对路径（来自「另存为」）。 */
  outPath: string
  /** 编码格式。 */
  format: Extract<ExportFormat, "gif" | "webm">
  /** 帧率。 */
  framerate: number
  /** GIF 为调色板色数（2–256）；WebM 为 CRF（0–63）。 */
  quality: number
  /** GIF 是否启用抖动。 */
  dither: boolean
  /** 是否保留透明通道。 */
  transparent: boolean
}

/** 与 `src-tauri/src/commands.rs` 中的导出命令一一对应的前端封装。 */
export const exportFs = {
  /** 弹出「另存为」对话框，返回用户选定的绝对路径；取消返回 `null`。 */
  pickSaveFile: (defaultName: string, filters?: FileFilter[]): Promise<string | null> =>
    invoke("pick_save_file", { defaultName, filters }),

  /**
   * 把字节原子写入**任意绝对路径**（导出 PNG 用）。
   *
   * 走原始请求体通道（同 `packFs.writeBytesAtomic`）：把字节作为 `invoke` 载荷直接发送，避免大
   * 二进制被序列化成 JSON 数字数组。路径经请求头 `x-path` 传递，先 `encodeURIComponent`——请求头
   * 值只能是 ASCII，而路径可能含非 ASCII（如中文目录名）；Rust 侧解码后按绝对路径直写。
   */
  writeFileAt: (path: string, bytes: Uint8Array): Promise<void> =>
    invoke("write_file_at", bytes, { headers: { "x-path": encodeURIComponent(path) } }),

  /**
   * 把系列内的帧序列编码成 GIF / WebM 并写到用户自选路径。
   *
   * 命令行在 Rust 侧组装（见 `encode_export`），此处只传语义参数。
   */
  encode: (params: EncodeExportParams): Promise<void> => invoke("encode_export", params),
}
