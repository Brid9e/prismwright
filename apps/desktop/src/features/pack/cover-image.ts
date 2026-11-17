/**
 * 系列封面导入时的降采样：把大图缩到手机上看清楚的档位，再统一成 WebP。
 *
 * 档位按小程序实际显示尺寸反推（iPhone 16/17 Pro 402pt、3 倍屏）：
 * - 大封面只用在首页 banner（670rpx 宽 ≈ 1077px，5:2 高约 431px）→ 1200×480 足够；
 * - 小封面用在热门卡池图标（约 213rpx 宽 ≈ 342px）、倒计时与展柜列表 → 384×384 足够。
 *
 * 三条不动的原则：
 * - **只缩不放**：本来就小的图原样保留，免得糊上一层插值；
 * - **GIF / 动图 WebP 不碰**：`createImageBitmap` 只解首帧，重编码会把动画压成静图；
 * - **失败退回原字节**：压缩是增强，不能让「以前能导入的图现在导不进来」。
 */
import type { CoverKind } from "./cover"

/** 各档位能容纳的最大像素框：只做等比缩小（fit），不裁剪；封面比例已在导入时校验。 */
export const COVER_BOX: Record<CoverKind, { width: number; height: number }> = {
  large: { width: 1200, height: 480 },
  small: { width: 384, height: 384 },
  // 卡包图：整张铺满抽卡页袋面（3 倍屏上约 750×1125px），只缩不放；比例不限。
  pack: { width: 900, height: 1350 },
  // 头像框：1:1，最大显示约 160rpx（3 倍屏 ≈ 240px），256 足够。
  frame: { width: 256, height: 256 },
  // 系列成就图标：1:1，只在成就页与土司的小图标位显示，128 足够。
  achievement: { width: 128, height: 128 },
  // 系列头像：1:1，头像网格与预览处最大约 320rpx，128 足够。
  seriesAvatar: { width: 128, height: 128 },
}

/** WebP 质量：手机上肉眼与 q0.9 比不出差别，体积只剩四成左右。 */
export const COVER_WEBP_QUALITY = 0.82

/** 尺寸已经够小、体积也低于这个值时不再重编码，免得白掉一次画质。 */
export const COVER_KEEP_BYTES = 300 * 1024

/**
 * 等比放进 `kind` 的像素框里；本来就装得下就原样返回（绝不放大）。
 *
 * @param width - 源图宽（像素）。
 * @param height - 源图高（像素）。
 * @param kind - 封面类型。
 */
export function coverTargetSize(
  width: number,
  height: number,
  kind: CoverKind,
): { width: number; height: number } {
  const box = COVER_BOX[kind]
  const scale = Math.min(box.width / width, box.height / height, 1)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 在字节里找一段 ASCII；找不到返回 -1。 */
function indexOfAscii(bytes: Uint8Array, text: string): number {
  const needle = Array.from(text, (c) => c.charCodeAt(0))
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * WebP 是否是动图：RIFF 容器里带 `ANIM` 块。
 *
 * 只扫开头 4KB——`ANIM` 块在 VP8X 之后紧跟着，图片数据在更后面，不会误判。
 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 4096))
  return indexOfAscii(head, "ANIM") !== -1
}

/** 解码结果；`source` 是不透明的底层位图，交给 `encodeWebp` 用。 */
export interface CoverDecoded {
  width: number
  height: number
  source: unknown
  close(): void
}

/** 解码 / 编码的可替换实现；测试注入假实现。 */
export interface CoverImageDeps {
  decode(bytes: Uint8Array, type: string): Promise<CoverDecoded>
  /** 把源图画进目标尺寸并编码成 WebP；返回 null 表示编码失败。 */
  encodeWebp(source: unknown, width: number, height: number): Promise<Uint8Array | null>
}

/** 按扩展名给 Blob 标 MIME；标错会让解码拿到错误的解码器。 */
function mimeOf(ext: string): string {
  return ext === "png"
    ? "image/png"
    : ext === "webp"
      ? "image/webp"
      : ext === "gif"
        ? "image/gif"
        : "image/jpeg"
}

const defaultDeps: CoverImageDeps = {
  async decode(bytes, type) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), {
      // 手机照片带 EXIF 朝向；不声明的话画布拿到的是未旋转的像素。
      imageOrientation: "from-image",
    })
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    }
  },
  async encodeWebp(source, width, height) {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", COVER_WEBP_QUALITY),
    )
    // 浏览器不支持 WebP 编码时会静默回退成 PNG：那时宁可保留原图，也别写一个名不副实的扩展名。
    if (!blob || blob.type !== "image/webp") return null
    return new Uint8Array(await blob.arrayBuffer())
  },
}

/**
 * 按档位降采样并转成 WebP；不需要或做不到时原样返回。
 *
 * @param bytes - 源文件字节。
 * @param ext - 源扩展名（小写、不含点）。
 * @param kind - 封面类型。
 * @param deps - 解码 / 编码实现，测试可注入。
 * @returns 落地用的字节与扩展名。
 */
export async function prepareCoverImage(
  bytes: Uint8Array,
  ext: string,
  kind: CoverKind,
  deps: CoverImageDeps = defaultDeps,
): Promise<{ ext: string; bytes: Uint8Array }> {
  if (ext === "gif" || (ext === "webp" && isAnimatedWebp(bytes))) return { ext, bytes }

  let decoded: CoverDecoded
  try {
    decoded = await deps.decode(bytes, mimeOf(ext))
  } catch {
    return { ext, bytes }
  }

  try {
    const target = coverTargetSize(decoded.width, decoded.height, kind)
    const unchanged = target.width === decoded.width && target.height === decoded.height
    if (unchanged && bytes.byteLength <= COVER_KEEP_BYTES) return { ext, bytes }

    const encoded = await deps.encodeWebp(decoded.source, target.width, target.height)
    if (!encoded) return { ext, bytes }
    return { ext: "webp", bytes: encoded }
  } catch {
    return { ext, bytes }
  } finally {
    decoded.close()
  }
}
