/**
 * 取纹理的宽高比（宽 / 高）。
 *
 * 纹理来自不同运行时（HTMLImageElement / ImageBitmap / DataTexture），`image` 的形状不一，
 * 但都带 `width` / `height`。拿不到（1×1 占位或尚未解码）时按调用方给的比例兜底——
 * 底图此时采样跨度恒为 1（等价于拉伸），蒙版的覆盖 / 适应也退化为正好铺满卡面，都不会因为缺信息把画面裁掉。
 */
import type { Texture } from "three"

/**
 * @param texture - 纹理；缺省按兜底比例返回。
 * @param fallback - 拿不到尺寸时的宽高比（通常传卡面比例）。
 */
export function textureAspect(
  texture: Texture | null | undefined,
  fallback: number,
): number {
  const image = texture?.image as { width?: number; height?: number } | null | undefined
  const w = Number(image?.width)
  const h = Number(image?.height)
  return w > 0 && h > 0 ? w / h : fallback
}
