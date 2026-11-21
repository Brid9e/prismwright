/**
 * 前端 ↔ Rust 的工程文件桥（`src-tauri/src/bundle/mod.rs` 的薄封装）。
 *
 * 与 `pack-fs.ts` 同一模式：上层只依赖 `bundleFs`，不直接接触 `invoke`。
 * 打开失败时 Rust 统一返回哨兵字符串 `E_BUNDLE_INVALID`，这里翻译成
 * {@link BundleInvalidError}，让 UI 能显示「文件已损坏或不是 Prismwright 工程文件」，
 * 而不必解析错误文案。
 */
import { invoke } from "@tauri-apps/api/core"
import type { BundleEntry, BundleManifest } from "../features/bundle/model"

/** 文件损坏 / 不是工程文件 / 解密失败。 */
export class BundleInvalidError extends Error {
  constructor() {
    super("E_BUNDLE_INVALID")
    this.name = "BundleInvalidError"
  }
}

/** `bundleFs.inspect` 的返回值。 */
export interface BundleInfo {
  /** 1 = 单卡，2 = 系列。 */
  kind: 1 | 2
  manifest: BundleManifest
  /** 工程文件本身的字节数。 */
  size: number
  entryCount: number
}

/** `bundleFs.extract` / `bundleFs.install` 的返回值。 */
export interface BundleExtractResult {
  /** 解包目录：`extract` 是临时目录，`install` 是目标目录。 */
  dir: string
  manifest: BundleManifest
  entries: string[]
}

/** `bundleFs.export` 的返回值。 */
export interface BundleExportResult {
  bytes: number
  entryCount: number
}

/** 把哨兵错误翻译成类型化异常，其余原样抛出。 */
async function call<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error === "E_BUNDLE_INVALID") throw new BundleInvalidError()
    throw error
  }
}

/** 与 `src-tauri/src/bundle/mod.rs` 的命令一一对应。 */
export const bundleFs = {
  /** 导出工程文件。`entries[].source` 是系列根目录内的相对路径。 */
  export: (
    kind: 1 | 2,
    rootDir: string,
    outPath: string,
    entries: BundleEntry[],
  ): Promise<BundleExportResult> =>
    invoke("bundle_export", { kind, rootDir, outPath, entries }),
  /** 检查工程文件（解密 + 读清单），不落盘。 */
  inspect: (path: string): Promise<BundleInfo> => call(() => invoke("bundle_inspect", { path })),
  /** 解包到系统临时目录；调用方负责随后 `cleanup`。 */
  extract: (path: string): Promise<BundleExtractResult> =>
    call(() => invoke("bundle_extract", { path })),
  /** 原子安装到目标目录；目标已存在则失败。 */
  install: (path: string, dest: string): Promise<BundleExtractResult> =>
    call(() => invoke("bundle_install", { path, dest })),
  /** 清理 `extract` 产生的临时目录（只接受 `prismwright-bundle-` 前缀）。 */
  cleanup: (dir: string): Promise<void> => invoke("bundle_cleanup", { dir }),
  /** 删除 `install` 之后处理失败的目录（只接受带 `manifest.json` 的安装产物）。 */
  discardInstall: (dir: string): Promise<void> => invoke("bundle_discard_install", { dir }),
}
