/**
 * 前端 ↔ Rust 宿主的主题文件桥。
 *
 * 与 `pack-fs.ts` 同构：每个方法与 `src-tauri/src/commands.rs` 中的一个
 * `#[tauri::command]` 一一对应，负责参数序列化并调用 Tauri 的 `invoke`。
 * 上层业务（主题注册表 / store）只依赖这里的 `themeFs`，不直接接触 `invoke`，
 * 从而把「命令名 + 参数形态」的细节收敛到单点。
 *
 * 与 pack-fs 的区别在落盘位置：主题文件位于**应用数据目录**的 `themes/` 下
 * （跨系列共享），而非系列内部，故不复用 pack-fs 的路径语义（无需 `packRoot`）。
 */
import { invoke } from "@tauri-apps/api/core"
import type { RawThemeFile } from "../themes/types"

/** 与 `src-tauri/src/commands.rs` 中的主题命令一一对应的前端封装。 */
export const themeFs = {
  /** 列出应用数据目录 `themes/` 下的主题文件（文件名 + 原始 JSON 文本）。 */
  listImported: (): Promise<RawThemeFile[]> => invoke("list_imported_themes"),
  /** 把一个主题装入 `themes/<id>.json`（覆盖同名）。 */
  install: (id: string, contents: string): Promise<void> => invoke("install_theme", { id, contents }),
}
