/**
 * 把系列内的图片读成已解码的 `HTMLImageElement`，供 CPU 上的像素级操作使用
 * （吸管取色要读像素，擦除画布要把旧图铺回去）。
 *
 * 与 `resolve-asset` 同路数（读字节 → object URL → 让浏览器解码），区别是这里要的是
 * 可画到 canvas 上的图片而不是 three 纹理。解码完成后 object URL 即可释放，图片本身仍然可用。
 */
import { packFs } from "../../tauri/pack-fs"

/** 读取并解码一张系列内图片；文件缺失 / 解码失败时返回 `null`（调用方据此静默跳过）。 */
export async function loadAssetImage(
  rootDir: string,
  rel: string,
): Promise<HTMLImageElement | null> {
  try {
    const bytes = await packFs.readAssetBytes(rootDir, rel)
    const url = URL.createObjectURL(new Blob([bytes]))
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`decode failed: ${rel}`))
        img.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}
