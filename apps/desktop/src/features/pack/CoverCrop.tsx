/**
 * 封面裁剪器：选完图先在这里定构图，再按封面比例落盘。
 *
 * 取景框本身就是输出画面：框内可见、框外被 `overflow: hidden` 裁掉，跟最终结果一一对应，
 * 用户不用想象「我框住的到底是哪一块」。拖动改位置、滑杆改缩放；真正的裁切在确认时
 * 用画布做一次，输出严格的 5:2（大封面）或 1:1（小封面）。
 *
 * 预览用 `<img>` + 位移而不是画布：WebView2 里 DOM 变换更稳，也省掉每帧重绘。
 */
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CoverKind } from "./cover"
import {
  CROP_ZOOM_MAX,
  clampView,
  cropOutputSize,
  cropSourceRect,
  frameSize,
  initialView,
  baseScale,
  type CropView,
} from "./cover-crop"
import { mimeOfExt } from "./cover-measure"

/** 导出画布的质量：封面最终只剩 1200px 宽，0.92 与无损肉眼无差。 */
const CROP_EXPORT_QUALITY = 0.92

export interface CoverCropProps {
  kind: CoverKind
  /** 源图字节（已经由调用方读好）。 */
  bytes: Uint8Array
  /** 源图扩展名（小写、不含前导点），只用来标 MIME。 */
  ext: string
  /** 源图像素宽高。 */
  width: number
  height: number
  onCancel(): void
  /** 裁剪完成：交回 WebP 字节，由调用方落盘。 */
  onConfirm(bytes: Uint8Array, ext: string): Promise<void> | void
}

export function CoverCrop({ kind, bytes, ext, width, height, onCancel, onConfirm }: CoverCropProps) {
  const { t } = useTranslation("editor")
  const frame = frameSize(kind)
  const [view, setView] = useState<CropView>(initialView)
  const [url, setUrl] = useState<string | null>(null)
  /** 正在导出：期间禁用按钮，避免重复落盘。 */
  const [applying, setApplying] = useState(false)
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: mimeOfExt(ext) }),
    )
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [bytes, ext])

  /** 拖动：把指针位移直接加到视图位移上，再交给夹取。 */
  function moveTo(clientX: number, clientY: number): void {
    const start = dragRef.current
    if (!start) return
    setView(
      clampView(width, height, frame, {
        zoom: view.zoom,
        dx: start.dx + (clientX - start.x),
        dy: start.dy + (clientY - start.y),
      }),
    )
  }

  async function apply(): Promise<void> {
    if (applying) return
    setApplying(true)
    try {
      const rect = cropSourceRect(width, height, frame, view)
      const out = cropOutputSize(rect, kind)
      const canvas = document.createElement("canvas")
      canvas.width = out.width
      canvas.height = out.height
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: mimeOfExt(ext) }),
      )
      try {
        ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height)
      } finally {
        bitmap.close()
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", CROP_EXPORT_QUALITY),
      )
      if (!blob) return
      await onConfirm(new Uint8Array(await blob.arrayBuffer()), "webp")
    } finally {
      setApplying(false)
    }
  }

  const scale = baseScale(width, height, frame) * view.zoom
  const imgWidth = width * scale
  const imgHeight = height * scale

  return (
    <div className="flex flex-col gap-2">
      <div
        style={{ width: frame.width, height: frame.height }}
        className="relative cursor-grab touch-none select-none self-center overflow-hidden rounded-control border border-line bg-sunken active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragRef.current = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy }
        }}
        onPointerMove={(e) => moveTo(e.clientX, e.clientY)}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      >
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: (frame.width - imgWidth) / 2 + view.dx,
              top: (frame.height - imgHeight) / 2 + view.dy,
              width: imgWidth,
              height: imgHeight,
              maxWidth: "none",
              maxHeight: "none",
            }}
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-label text-muted">
        <span className="shrink-0">{t("pack.cover.cropZoom")}</span>
        <input
          type="range"
          min={1}
          max={CROP_ZOOM_MAX}
          step={0.01}
          value={view.zoom}
          onChange={(e) =>
            setView(
              clampView(width, height, frame, {
                zoom: Number(e.target.value),
                dx: view.dx,
                dy: view.dy,
              }),
            )
          }
          className="min-w-0 flex-1"
        />
      </label>
      <p className="text-label leading-relaxed text-muted">{t("pack.cover.cropHint")}</p>

      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          disabled={applying}
          onClick={onCancel}
          className="h-6 rounded-control border border-line-soft px-3 text-body text-muted hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("common:action.cancel")}
        </button>
        <button
          type="button"
          disabled={applying}
          onClick={() => void apply()}
          className="h-6 rounded-control bg-accent px-3 text-body text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("pack.cover.cropApply")}
        </button>
      </div>
    </div>
  )
}
