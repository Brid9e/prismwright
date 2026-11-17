/**
 * 从图片字节读出像素尺寸。
 *
 * 只解码、不重编码：GIF 取首帧（`createImageBitmap` 的默认行为），
 * PNG 的透明通道与动画 GIF 的帧序列都不受影响。
 */

/**
 * 扩展名 → MIME。
 *
 * `<img>` 与 `createImageBitmap` 都靠它解码；标错会让 GIF 不动（也读不出尺寸），
 * 所以按扩展名逐个映射，而不是笼统写 `image/png`。白名单之外的文件进不来，
 * 未知扩展名退回 JPEG。
 *
 * @param ext - 扩展名（小写、不含前导点）。
 */
export function mimeOfExt(ext: string): string {
  return ext === "png"
    ? "image/png"
    : ext === "webp"
      ? "image/webp"
      : ext === "gif"
        ? "image/gif"
        : "image/jpeg"
}

/**
 * 测量封面图片的像素宽高。
 *
 * @param bytes - 图片文件的原始字节。
 * @param ext - 扩展名（小写、不含前导点），用于给 `Blob` 标注 MIME 类型。
 * @returns 像素宽高；无法解码时由 `createImageBitmap` 抛出。
 */
export async function measureCover(
  bytes: Uint8Array,
  ext: string,
): Promise<{ width: number; height: number }> {
  const type = mimeOfExt(ext)
  // `new Uint8Array(bytes)` 复制出一份 `ArrayBuffer` 背书的视图：TS 5.7 起宽泛的
  // `Uint8Array<ArrayBufferLike>` 不再能直接作为 `BlobPart`（可能挂在 SharedArrayBuffer 上）。
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }))
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}
