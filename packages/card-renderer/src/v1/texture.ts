/**
 * 从「已经拿到手的图像」构造纹理。
 *
 * 桌面端用 `TextureLoader`，小程序端用 `canvas.createImage()`——两者都只产出一个
 * 图像对象，剩下的事（翻转、色彩空间、上传）由渲染器统一处理。`colorSpace` 不在这里
 * 设置：它由 `TextureCache` 按资源用途（color / data）决定。
 */
import { Texture } from "three"

export function textureFromImage(image: unknown): Texture {
  const tex = new Texture(image as TexImageSource)
  tex.needsUpdate = true
  return tex
}
