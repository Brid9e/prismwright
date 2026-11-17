/**
 * 资源解析器：把系列内相对路径变成 three 纹理。
 *
 * 这是渲染器与运行环境解耦的那个注入点——`@cardbara/renderer` 不知道 Tauri 的
 * 存在，由这里负责「读字节 → object URL → 纹理」。用 object URL 而非直接把
 * ArrayBuffer 交给 `TextureLoader`：后者只接受可被浏览器解码的 URL/图片源，
 * object URL 是让浏览器解码字节的最短路径，且加载完成即可释放，不长期占用内存。
 */
import { TextureLoader, type Texture } from "three"
import type { ResolveAsset } from "@cardbara/renderer/v1"
import { packFs } from "../../tauri/pack-fs"

export interface ResolveAssetOptions {
  /** 系列根目录的绝对路径。 */
  rootDir: string
  /** 某个资源解析失败时的回调（用于在卡片/图层行上打警示徽标）。 */
  onMissing: (rel: string) => void
}

/**
 * 构造一个绑定到具体系列根目录的资源解析器。
 *
 * 失败时**既上报也抛出**：上报让 UI 能打徽标，抛出则交给渲染器的纹理缓存兜住
 * （它会把该层回退为占位图并继续渲染其余图层）。静默返回空纹理会让使用者看到
 * 一张没有全息的卡，却不知道是缺文件还是参数调错了。
 *
 * @param opts - 系列根目录与失败回调。
 * @returns 供 `createCardView` 使用的解析器。
 */
export function createResolveAsset({ rootDir, onMissing }: ResolveAssetOptions): ResolveAsset {
  return async (rel) => {
    try {
      const bytes = await packFs.readAssetBytes(rootDir, rel)
      const url = URL.createObjectURL(new Blob([bytes]))
      try {
        return await new Promise<Texture>((resolve, reject) => {
          new TextureLoader().load(url, resolve, undefined, reject)
        })
      } finally {
        // 纹理已从 object URL 解码完毕，URL 本身即可释放；
        // 放在 finally 保证解码失败时也不泄漏。
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      onMissing(rel)
      throw error
    }
  }
}
