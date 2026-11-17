/**
 * 预览资产在系列内的相对路径（单一来源）。
 *
 * 产物落在系列内的 `.previews/` 隐藏子目录：与系列同生命周期（拷走系列即带走预览），又不与
 * `assets/` 里的用户素材混在一起。`.frames/` 是编码 WebM 的**临时**帧目录，由 Rust 侧
 * `encode_webm` 在编码后清理，故正常不会长期存在。
 *
 * 全部是纯字符串拼接（不触盘），便于单测，也便于各处引用同一套命名而不写散落的魔法串。
 */
import { join } from "../../app/path"

/** 预览资产所在的系列内子目录。 */
export const PREVIEW_DIR = ".previews"

/** 记录「每张卡上次生成时的内容哈希」的清单文件（系列内相对路径）。 */
export const MANIFEST_REL = join(PREVIEW_DIR, "manifest.json")

/** 静态正视角 PNG 的系列内相对路径。 */
export function previewPngRel(cardId: string): string {
  return join(PREVIEW_DIR, `${cardId}.png`)
}

/** 透明 WebM 的系列内相对路径。 */
export function previewWebmRel(cardId: string): string {
  return join(PREVIEW_DIR, `${cardId}.webm`)
}

/** 某张卡的临时帧目录（系列内相对路径；编码后由 Rust 侧清理）。 */
export function framesDirRel(cardId: string): string {
  return join(PREVIEW_DIR, ".frames", cardId)
}

/**
 * 单帧 PNG 的系列内相对路径。
 *
 * `frame_0001.png`… 的**从 1 起数、4 位零填充**命名必须与 Rust 侧 `encode_webm` 拼出的
 * `frame_%04d.png` 严格对应，否则 ffmpeg 读不到帧序列（见 `src-tauri/src/commands.rs`）。
 *
 * @param cardId - 卡片 ID。
 * @param index - 帧序号（从 0 起）。
 */
export function frameRel(cardId: string, index: number): string {
  return join(framesDirRel(cardId), `frame_${String(index + 1).padStart(4, "0")}.png`)
}

/**
 * 导出用的临时帧目录（系列内相对路径；编码后由 Rust 侧清理）。
 *
 * 与后台预览流水线的 {@link framesDirRel}（按卡 id 派生）**刻意分开**：后者可能正为同一张卡
 * 生成预览帧，两条流程若共用目录会互相踩掉对方的帧。导出是串行的（对话框模态、一次导一份），
 * 故用一个固定目录即可，无需按卡派生，也省去对卡 id 做路径净化的必要。
 */
export const EXPORT_FRAMES_DIR = join(PREVIEW_DIR, ".frames", "export")

/**
 * 导出帧序列中第 `index` 帧（从 0 起）的系列内相对路径。
 *
 * 命名（`frame_0001.png`… 从 1 起、4 位零填充）与 {@link frameRel} 一致——Rust 侧
 * `encode_export` 同样按 `frame_%04d.png` 读取，两者必须严格对应。
 *
 * @param index - 帧序号（从 0 起）。
 */
export function exportFrameRel(index: number): string {
  return join(EXPORT_FRAMES_DIR, `frame_${String(index + 1).padStart(4, "0")}.png`)
}
