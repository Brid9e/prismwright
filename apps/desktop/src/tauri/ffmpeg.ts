/**
 * 前端 ↔ Rust 宿主的媒体编码桥。
 *
 * 与 `pack-fs.ts` / `theme-fs.ts` 同构：每个方法与 `src-tauri/src/commands.rs` 中的一个
 * `#[tauri::command]` 一一对应。ffmpeg 的命令行在 Rust 侧组装（见 `encode_webm`），前端只给
 * 「帧目录 / 输出路径 / 帧率」这类语义参数——这里不做任何命令行拼接。
 */
import { invoke } from "@tauri-apps/api/core"

/** 与 `commands::encode_webm` 一一对应的前端封装。 */
export const ffmpeg = {
  /**
   * 把系列内的一串 PNG 帧编码成透明 WebM（VP9 / yuva420p）。
   *
   * @param packRoot - 系列根目录绝对路径。
   * @param framesRel - 帧目录在系列内的相对路径（帧按 `frame_0001.png`… 递增命名）。
   * @param outputRel - 产物 WebM 在系列内的相对路径。
   * @param framerate - 帧率。
   */
  encodeWebm: (
    packRoot: string,
    framesRel: string,
    outputRel: string,
    framerate: number,
  ): Promise<void> => invoke("encode_webm", { packRoot, framesRel, outputRel, framerate }),
}
