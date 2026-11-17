/**
 * 导入图片的压缩：超过体积上限的原图，解码后重新编码到上限以内。
 *
 * 只在**导入时**压一次：小图原样返回（不重编码，画质与体积都不变），大图才走画布。
 * 解码 / 编码失败一律退回原字节——压缩是增强，不能让「以前能导入的图现在导不进来」。
 *
 * 与 `features/flatten/compose.ts` 同一套手段（`createImageBitmap` + 离屏画布 + `toBlob`），
 * 两个目标 webview（WebView2 / WKWebView）都支持。
 */
import { packFs } from "../../tauri/pack-fs"

/** 单张导入图的体积上限：超过就重新编码。 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
/** 重编码时的长边上限（与小程序的纹理上限一致，见 `tools/publish-pack.mjs`）。 */
export const MAX_IMPORT_EDGE = 2048

/** 一档编码尝试：画多大、用什么格式（JPEG 另有质量）。 */
export interface EncodeAttempt {
  width: number
  height: number
  type: "image/jpeg" | "image/png"
  /** JPEG 质量；PNG 忽略。 */
  quality?: number
}

/** 等比缩放到长边以内；本来就小则原样返回（绝不放大）。 */
export function targetSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** JPEG 质量降档顺序：先保画质，不够再一路往下。 */
const JPEG_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5]
/** 尺寸收缩档位：质量降到最低还超限时，按这些倍数缩尺寸重来。 */
const SIZE_SCALES = [1, 0.75, 0.5625]

/**
 * 生成编码尝试序列（越靠前画质越好）。
 *
 * - 带透明通道：只出 PNG——JPEG 存不了透明，选了会把透明区涂黑。
 * - 不透明 PNG：先试无损 PNG（截图 / 纯色图重编码后往往仍很小），再退 JPEG。
 * - 其余不透明图：直接 JPEG 质量降档。
 *
 * @param input.ext - 源文件扩展名（小写、不含点）。
 * @param input.hasAlpha - 是否含半透明像素。
 * @param input.width - 源图自然宽度。
 * @param input.height - 源图自然高度。
 */
export function buildAttempts(input: {
  ext: string
  hasAlpha: boolean
  width: number
  height: number
}): EncodeAttempt[] {
  const base = targetSize(input.width, input.height, MAX_IMPORT_EDGE)
  const attempts: EncodeAttempt[] = []
  const preferLossless = input.ext === "png"
  for (const scale of SIZE_SCALES) {
    const width = Math.max(1, Math.round(base.width * scale))
    const height = Math.max(1, Math.round(base.height * scale))
    if (input.hasAlpha) {
      attempts.push({ width, height, type: "image/png" })
      continue
    }
    if (preferLossless && scale === 1) attempts.push({ width, height, type: "image/png" })
    for (const quality of JPEG_QUALITIES) {
      attempts.push({ width, height, type: "image/jpeg", quality })
    }
  }
  return attempts
}

/** 编码格式 → 落盘扩展名（不含点）。 */
export function extForType(type: EncodeAttempt["type"]): "jpg" | "png" {
  return type === "image/jpeg" ? "jpg" : "png"
}

/**
 * 按顺序编码，取第一档不超过上限的结果；全部超限时取体积最小的一档。
 *
 * 命中即停：后面的档位画质更低，再编也是白编。
 *
 * @param attempts - 尝试序列（顺序即优先级）。
 * @param encode - 把一档编码成字节。
 * @param maxBytes - 体积上限。
 * @returns 选中的一档与字节；序列为空时 `null`。
 */
export async function pickUnderLimit<A>(
  attempts: readonly A[],
  encode: (attempt: A) => Promise<Uint8Array>,
  maxBytes: number,
): Promise<{ attempt: A; bytes: Uint8Array } | null> {
  let best: { attempt: A; bytes: Uint8Array } | null = null
  for (const attempt of attempts) {
    const bytes = await encode(attempt)
    if (!best || bytes.byteLength < best.bytes.byteLength) best = { attempt, bytes }
    if (bytes.byteLength <= maxBytes) return best
  }
  return best
}

/** 读源文件字节；测试可替换。 */
export interface ImportDeps {
  readBytes: (path: string) => Promise<ArrayBuffer>
}

const defaultDeps: ImportDeps = { readBytes: (path) => packFs.readFileBytes(path) }

/**
 * 读出导入源并按需压缩。
 *
 * @param srcAbsPath - 源图绝对路径。
 * @param ext - 源文件扩展名（小写、不含点）。
 * @param deps - 读取依赖（测试注入）。
 * @returns 落盘用的字节与扩展名（不含点）。
 * @throws 源文件读不出来时抛出——调用方据此退回 Rust 侧的原样拷贝。
 */
export async function prepareImportImage(
  srcAbsPath: string,
  ext: string,
  deps: ImportDeps = defaultDeps,
): Promise<{ ext: string; bytes: Uint8Array }> {
  const buffer = await deps.readBytes(srcAbsPath)
  const raw = new Uint8Array(buffer)
  if (raw.byteLength <= MAX_IMPORT_BYTES) return { ext, bytes: raw }
  try {
    return await reencode(buffer, ext)
  } catch {
    // 浏览器拒解 / 画布不可用：原样返回，导入照常完成。
    return { ext, bytes: raw }
  }
}

/** 解码 → 判断透明 → 按档位重编码。 */
async function reencode(
  buffer: ArrayBuffer,
  ext: string,
): Promise<{ ext: string; bytes: Uint8Array }> {
  const bitmap = await createImageBitmap(new Blob([buffer]), {
    // 手机照片带 EXIF 朝向：不声明的话画布会拿到未旋转的像素，压缩后图就躺下了。
    imageOrientation: "from-image",
  })
  try {
    const base = targetSize(bitmap.width, bitmap.height, MAX_IMPORT_EDGE)
    const attempts = buildAttempts({
      ext,
      hasAlpha: detectAlpha(bitmap, base),
      width: bitmap.width,
      height: bitmap.height,
    })
    const picked = await pickUnderLimit(
      attempts,
      (attempt) => encodeAttempt(bitmap, attempt),
      MAX_IMPORT_BYTES,
    )
    if (!picked) return { ext, bytes: new Uint8Array(buffer) }
    return { ext: extForType(picked.attempt.type), bytes: picked.bytes }
  } finally {
    bitmap.close()
  }
}

/** 画到指定尺寸的 2D 画布，返回画布与上下文。 */
function drawToCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建 2D 画布")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(bitmap, 0, 0, width, height)
  return { canvas, ctx }
}

/** 是否存在非完全不透明的像素（决定能不能用 JPEG）。 */
function detectAlpha(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
): boolean {
  const { ctx } = drawToCanvas(bitmap, size.width, size.height)
  const { data } = ctx.getImageData(0, 0, size.width, size.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

/** 按一档参数画图并编码成字节。 */
async function encodeAttempt(bitmap: ImageBitmap, attempt: EncodeAttempt): Promise<Uint8Array> {
  const { canvas } = drawToCanvas(bitmap, attempt.width, attempt.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画布编码失败"))),
      attempt.type,
      attempt.quality,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}
