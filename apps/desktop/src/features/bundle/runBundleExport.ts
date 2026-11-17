/**
 * 导出工程文件的动作层。
 *
 * 关键顺序：**先 `save()` 再收集条目**。`.cards` 里的 `pack.json` 是 Rust 从磁盘读的，
 * 若跳过这一步，导出的是上次落盘的旧内容（改了卡名没保存就导出，拿到的是旧名字）。
 */
import { findCard, usePackStore } from "../../store/packStore"
import { bundleFs, type BundleExportResult } from "../../tauri/bundle"
import {
  buildCardEntries,
  buildCardManifest,
  buildSeriesEntries,
  buildSeriesManifest,
  type BundleKind,
} from "./model"

/**
 * 导出当前系列或其中一张卡。
 *
 * @param kind - `series` 导出整个系列，`card` 导出单卡（需要 `cardId`）。
 * @param cardId - 单卡导出时的卡片 id。
 * @param outPath - 用户选定的保存路径。
 * @returns Rust 报告的字节数与条目数。
 */
export async function runBundleExport(
  kind: BundleKind,
  cardId: string | null,
  outPath: string,
): Promise<BundleExportResult> {
  if (!usePackStore.getState().pack || !usePackStore.getState().rootDir) {
    throw new Error("没有打开的系列")
  }
  await usePackStore.getState().save()

  // `save()` 自己吞掉写盘异常、只置 error 态；这里必须显式检查，否则会在「保存失败」
  // 的情况下继续导出，于是 `pack.json` 条目是从磁盘读的旧内容、清单却来自内存。
  const saved = usePackStore.getState()
  if (saved.saveStatus === "error") {
    throw new Error(saved.lastError ?? "保存当前系列失败，已取消导出")
  }

  // 保存后重新取一次：`save()` 可能烤平图层，pack 引用已变。
  const { pack, rootDir } = saved
  if (!pack || !rootDir) throw new Error("没有打开的系列")

  const createdAt = new Date().toISOString()
  if (kind === "series") {
    const manifest = buildSeriesManifest(pack, __APP_VERSION__, createdAt)
    return bundleFs.export(2, rootDir, outPath, buildSeriesEntries(pack, manifest))
  }

  const card = findCard(pack, cardId)
  if (!card) throw new Error("找不到要导出的卡片")
  const manifest = buildCardManifest(pack, card, __APP_VERSION__, createdAt)
  return bundleFs.export(1, rootDir, outPath, buildCardEntries(card, manifest))
}
