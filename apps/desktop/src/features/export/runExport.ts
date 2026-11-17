/**
 * 导出编排：把「渲染器 + 参数」跑成落盘的产物。
 *
 * 两条分支：
 * - **PNG**：渲一张正面平视静帧，直接写用户自选路径（不经 ffmpeg）。
 * - **GIF / WebM**：逐帧渲（倾角 = `exportSway(i / fps)`，全息相位恒 0），帧落进系列内临时目录，
 *   再交 Rust 侧 `encode_export` 编码到用户自选路径（编码后由 Rust 清理帧目录）。
 *
 * 全息相位（`renderPng` 第一参）恒置 0 是为**对齐交互预览**：预览把 `uTime` 恒置 0（见 card-view 与
 * 着色器注释），图案是冻结的，只有卡片在摆动。照搬还能保住 `exportSway` 的 6s 无缝循环——若把 `i / fps`
 * 喂给相位，色带流速与摆动周期不对齐，GIF / WebM 首尾会跳一道色带。
 *
 * 与后台预览流水线共用同一个 WebGL 来源，故两条分支开跑前都先 `waitForPreviewIdle()` 等它跑空，免得
 * 两条流程抢 GPU（帧目录已按路径与预览隔离，见 paths.ts，不存在写到同一处的问题）。
 */
import type { Card } from "@cardbara/schema"
import {
  EXPORT_CAMERA_MARGIN,
  createCardFrameRenderer,
  exportSway,
  type ResolveAsset,
} from "@cardbara/renderer/v1"
import { exportFs } from "../../tauri/export-fs"
import { packFs } from "../../tauri/pack-fs"
import { EXPORT_FRAMES_DIR, exportFrameRel } from "../preview-assets/paths"
import { exportFrameCount, type ExportOptions } from "./exportOptions"

/** 导出进度：`total` 为本次要渲的总帧数，`done` 为已渲完帧数。 */
export interface ExportProgress {
  /** 已渲完的帧数。 */
  done: number
  /** 总帧数（PNG 为 1）。 */
  total: number
}

/** {@link runExport} 的入参。 */
export interface RunExportParams {
  /** 要导出的卡面（含身份字段，用于帧渲染器与文件名）。 */
  card: Card
  /** 系列统一的卡面宽高比（宽/高）；比例在系列上，不在卡片上。 */
  aspect: number
  /** 系列根目录绝对路径（帧的落盘基准）。 */
  rootDir: string
  /** 资源解析器（与预览同一份语义）。 */
  resolveAsset: ResolveAsset
  /** 导出参数。 */
  options: ExportOptions
  /** 产物绝对路径（来自「另存为」）。 */
  outPath: string
  /** 进度回调：每渲完一帧回一次。 */
  onProgress: (progress: ExportProgress) => void
  /** 等后台预览流水线跑空（拿不到句柄的调用方传 `() => Promise.resolve()`）。 */
  waitForPreviewIdle: () => Promise<void>
}

/**
 * 执行一次导出。
 *
 * @param params - 见 {@link RunExportParams}。
 * @throws 渲染 / 写盘 / 编码失败时抛出（由调用方捕获展示）。
 */
export async function runExport(params: RunExportParams): Promise<void> {
  const { card, aspect, rootDir, resolveAsset, options, outPath, onProgress, waitForPreviewIdle } =
    params
  // 透明背景映射为 `null`（帧渲染器的既有语义），纯色直接透传 hex。
  const background = options.background === "transparent" ? null : options.background

  if (options.format === "png") {
    // 单帧也要等：与动图共用同一个 WebGL 来源，避免与后台预览抢 GPU。
    await waitForPreviewIdle()
    const renderer = await createCardFrameRenderer({
      card,
      resolveAsset,
      width: options.width,
      aspect,
      cornerRadius: card.cornerRadius,
      background,
    })
    try {
      const blob = await renderer.renderPng(0)
      await exportFs.writeFileAt(outPath, new Uint8Array(await blob.arrayBuffer()))
      onProgress({ done: 1, total: 1 })
    } finally {
      // 无论成功与否都释放 GPU 资源，避免多次导出累积显存。
      renderer.dispose()
    }
    return
  }

  // GIF / WebM：等后台预览跑空再逐帧渲染，避免两条流程抢 GPU。
  await waitForPreviewIdle()
  const total = exportFrameCount(options)
  // 带倾角的导出留取景余量（近侧边缘在透视下可能略溢出，见 EXPORT_CAMERA_MARGIN）。
  const renderer = await createCardFrameRenderer({
    card,
    resolveAsset,
    width: options.width,
    aspect,
    cornerRadius: card.cornerRadius,
    background,
    cameraMargin: EXPORT_CAMERA_MARGIN,
  })
  try {
    for (let i = 0; i < total; i++) {
      // 相位恒 0：图案冻结（同交互预览），只有倾角随 `exportSway` 摆动，故 6s 循环首尾无缝。
      const t = i / options.fps
      const blob = await renderer.renderPng(0, exportSway(t))
      await packFs.writeBytesAtomic(
        rootDir,
        exportFrameRel(i),
        new Uint8Array(await blob.arrayBuffer()),
      )
      onProgress({ done: i + 1, total })
    }
    await exportFs.encode({
      packRoot: rootDir,
      framesRel: EXPORT_FRAMES_DIR,
      outPath,
      format: options.format,
      framerate: options.fps,
      quality: options.format === "gif" ? options.gifColors : options.webmCrf,
      dither: options.gifDither,
      transparent: options.background === "transparent",
    })
  } finally {
    renderer.dispose()
  }
}
