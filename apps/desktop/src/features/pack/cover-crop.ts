/**
 * 封面裁剪的纯数学：取景框、铺满比例、位移夹取与输出尺寸。
 *
 * 组件只负责把 `view` 画出来、把指针位移换算成 `dx / dy`；「最后裁原图的哪一块」
 * 全在这里算，因而可以单测。坐标口径：
 *
 * - `dx / dy` 是**取景框像素**（不是原图像素），指图像相对「居中铺满」位置的位移；
 * - `zoom` 是相对铺满的倍数，1 表示刚好盖满取景框；
 * - 取景框 = 输出画面，框外一律不可见。
 */
import type { CoverKind } from "./cover"
import { COVER_BOX } from "./cover-image"

/** 取景框宽度（预览像素）；大封面按 5:2 得 144 高，小封面是正方形。 */
export const CROP_FRAME_WIDTH = 360
/** 小封面单独窄一点，正方形不至于把对话框撑满。 */
const CROP_FRAME_WIDTH_SMALL = 240
/** 最大放大倍数：再大就只剩几个像素，画质撑不住。 */
export const CROP_ZOOM_MAX = 4

/** 裁剪视图：缩放倍数 + 相对居中铺满位置的位移（取景框像素）。 */
export interface CropView {
  zoom: number
  dx: number
  dy: number
}

/** 默认视图：铺满、居中。 */
export function initialView(): CropView {
  return { zoom: 1, dx: 0, dy: 0 }
}

/** 某种封面在预览里的取景框尺寸；比例取自落盘档位，与导入校验同源。 */
export function frameSize(kind: CoverKind): { width: number; height: number } {
  const width = kind === "large" ? CROP_FRAME_WIDTH : CROP_FRAME_WIDTH_SMALL
  const box = COVER_BOX[kind]
  return { width, height: Math.round((width * box.height) / box.width) }
}

/** 把原图铺满取景框所需的缩放（取宽、高两个方向里更大的那个，不留白）。 */
export function baseScale(
  imgWidth: number,
  imgHeight: number,
  frame: { width: number; height: number },
): number {
  return Math.max(frame.width / imgWidth, frame.height / imgHeight)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 夹取缩放与位移：缩放落在 `[1, CROP_ZOOM_MAX]`，位移不让取景框露出图外。 */
export function clampView(
  imgWidth: number,
  imgHeight: number,
  frame: { width: number; height: number },
  view: CropView,
): CropView {
  const zoom = clamp(view.zoom, 1, CROP_ZOOM_MAX)
  const scale = baseScale(imgWidth, imgHeight, frame) * zoom
  const maxX = Math.max(0, (imgWidth * scale - frame.width) / 2)
  const maxY = Math.max(0, (imgHeight * scale - frame.height) / 2)
  return {
    zoom,
    dx: clamp(view.dx, -maxX, maxX),
    dy: clamp(view.dy, -maxY, maxY),
  }
}

/** 原图上被取走的一块（像素）。 */
export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

/** 当前视图下真正要裁原图的哪一块。 */
export function cropSourceRect(
  imgWidth: number,
  imgHeight: number,
  frame: { width: number; height: number },
  view: CropView,
): SourceRect {
  const clamped = clampView(imgWidth, imgHeight, frame, view)
  const scale = baseScale(imgWidth, imgHeight, frame) * clamped.zoom
  const width = frame.width / scale
  const height = frame.height / scale
  // 位移向右 = 看到原图更靠左的一块，所以要减。
  const x = (imgWidth - width) / 2 - clamped.dx / scale
  const y = (imgHeight - height) / 2 - clamped.dy / scale
  return {
    x: clamp(x, 0, Math.max(0, imgWidth - width)),
    y: clamp(y, 0, Math.max(0, imgHeight - height)),
    width,
    height,
  }
}

/**
 * 裁剪结果落盘的像素尺寸：比例与封面框一致，只缩不放。
 *
 * 高按宽反算，保证输出比例严格等于封面比例（四舍五入的偏差不累积）。
 */
export function cropOutputSize(
  rect: SourceRect,
  kind: CoverKind,
): { width: number; height: number } {
  const box = COVER_BOX[kind]
  const ratio = box.width / box.height
  const width = Math.max(1, Math.min(box.width, Math.round(rect.width)))
  const height = Math.max(1, Math.round(width / ratio))
  return { width, height }
}
