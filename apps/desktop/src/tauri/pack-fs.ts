/**
 * 前端 ↔ Rust 宿主的文件系统桥。
 *
 * 本文件是 `apps/desktop/src-tauri/src/commands.rs` 的薄封装：每个方法与一个
 * `#[tauri::command]` 一一对应，负责参数序列化并调用 Tauri 的 `invoke`。
 * 上层业务（store / 组件）只依赖这里的 `packFs`，不直接接触 `invoke`，
 * 从而把「命令名 + 参数形态」的细节收敛到单点。
 *
 * 命名约定（Tauri v2）：`invoke` 会把 JS 侧的 **camelCase 参数名**自动映射为 Rust 侧
 * 的 **snake_case 形参名**（如 `packRoot` → `pack_root`）。因此这里统一使用 camelCase
 * 书写参数键，无需手写 snake_case。
 */
import { invoke } from "@tauri-apps/api/core"

/** 原生文件选择框的过滤器，与 Rust 侧 `commands::FileFilter` 对应。 */
export interface FileFilter {
  /** 过滤器在对话框中显示的名称。 */
  name: string
  /** 允许的扩展名列表，不含前导点（如 `["json", "zip"]`）。 */
  extensions: string[]
}

/** 与 `src-tauri/src/commands.rs` 一一对应的前端封装。 */
export const packFs = {
  /** 弹出目录选择框，返回选中目录的绝对路径；取消返回 `null`。 */
  pickDirectory: (): Promise<string | null> => invoke("pick_directory"),
  /** 弹出文件选择框，返回选中文件的绝对路径；取消返回 `null`。 */
  pickFile: (filters?: FileFilter[]): Promise<string | null> => invoke("pick_file", { filters }),
  /** 以 UTF-8 读取文本文件内容。 */
  readText: (path: string): Promise<string> => invoke("read_text_file", { path }),
  /** 原子写入文本文件（temp + rename），避免中途失败损坏原文件。 */
  writeTextAtomic: (path: string, contents: string): Promise<void> =>
    invoke("write_text_file_atomic", { path, contents }),
  /**
   * 原子写入系列内的二进制文件（temp + rename），供预览资产（PNG / WebM 帧）落盘。
   *
   * 走 Tauri 的**原始请求体**通道：把整段字节直接作为 `invoke` 的载荷（`args` 传 `Uint8Array`
   * 而非对象），避免大二进制被序列化成 JSON 数字数组而膨胀数倍。原始体通道下没有具名参数，
   * 故 `packRoot` / `rel` 经请求头传递——两者都先 `encodeURIComponent`，以承载可能含非 ASCII
   * （如中文目录名）的绝对路径；Rust 侧解码后仍会经 `safe_join` 做越界校验。
   */
  writeBytesAtomic: (packRoot: string, rel: string, bytes: Uint8Array): Promise<void> =>
    invoke("write_bytes_atomic", bytes, {
      headers: {
        "x-pack-root": encodeURIComponent(packRoot),
        "x-rel": encodeURIComponent(rel),
      },
    }),
  /** 递归确保目录存在。 */
  ensureDir: (path: string): Promise<void> => invoke("ensure_dir", { path }),
  /** 把外部资源拷贝进系列，返回落盘后的绝对路径。 */
  copyAsset: (src: string, packRoot: string, rel: string): Promise<string> =>
    invoke("copy_asset", { src, packRoot, rel }),
  /** 把系列内文件移入回收站，返回用于撤销的 token。 */
  moveToTrash: (packRoot: string, rel: string): Promise<string> =>
    invoke("move_to_trash", { packRoot, rel }),
  /** 依据 token 把文件从回收站还原到系列内的 `rel` 位置。 */
  restoreFromTrash: (packRoot: string, token: string, rel: string): Promise<void> =>
    invoke("restore_from_trash", { packRoot, token, rel }),
  /** 清理回收站，仅保留最近的 `keep` 项。 */
  purgeTrash: (packRoot: string, keep: number): Promise<void> =>
    invoke("purge_trash", { packRoot, keep }),
  /** 判断路径（文件或目录）是否存在。 */
  pathExists: (path: string): Promise<boolean> => invoke("path_exists", { path }),
  /** 判断路径是否为系列目录（含 `pack.json`）。 */
  isPackDir: (path: string): Promise<boolean> => invoke("is_pack_dir", { path }),
  /**
   * 读取系列内资源文件的原始字节，供渲染器构造纹理。
   *
   * 返回裸字节（不经 JSON 数字数组），避免大图在 IPC 上膨胀数倍。
   */
  readAssetBytes: (packRoot: string, rel: string): Promise<ArrayBuffer> =>
    invoke("read_asset_bytes", { packRoot, rel }),
  /**
   * 读取**任意绝对路径**文件的原始字节（导入源图在系列之外，无法走 `readAssetBytes`）。
   *
   * 与 `writeFileAt` 对称的开放读入口；信任边界同样落在前端（只传系统文件框的返回值）。
   */
  readFileBytes: (path: string): Promise<ArrayBuffer> => invoke("read_file_bytes", { path }),
}
