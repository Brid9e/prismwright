/**
 * 纹理缓存与色彩空间管理。
 *
 * 职责：
 * - 按 `relPath` 缓存 {@link Texture}，避免同图重复加载；`dispose()` 时统一释放。
 * - 显式设定色彩空间：卡面图是「颜色」（sRGB），蒙版图是「数据」（线性）。
 *   蒙版按线性采样，其亮度才与 buling（无色彩管理）的取值一致，保证线稿门限可对齐。
 * - `resolveAsset` 抛错时不影响其余图层，仅打印警告并回退为 null。
 * - `dispose()` 后缓存进入终态：`get()` 不再发起新加载，在途纹理在到货时即刻释放。
 */
import { SRGBColorSpace, NoColorSpace, type Texture } from "three"
import type { ResolveAsset } from "./types"

export class TextureCache {
  private readonly map = new Map<string, Promise<Texture | null>>()
  private readonly loaded = new Set<Texture>()
  private disposed = false

  constructor(private readonly resolveAsset: ResolveAsset) {}

  /**
   * 取纹理；命中缓存直接返回。
   *
   * @param rel - 系列内相对路径；空串返回 null（未设置）。
   * @param kind - `color`（卡面，sRGB）或 `data`（蒙版，线性）。
   */
  get(rel: string, kind: "color" | "data"): Promise<Texture | null> {
    if (!rel) return Promise.resolve(null)
    // dispose 后缓存为终态，不再发起新加载。
    if (this.disposed) return Promise.resolve(null)
    const key = `${kind}:${rel}`
    const cached = this.map.get(key)
    if (cached) return cached
    const p = this.resolveAsset(rel)
      .then((tex) => {
        tex.colorSpace = kind === "color" ? SRGBColorSpace : NoColorSpace
        // 加载期间已被 dispose：纹理无人接管，立即释放，避免泄漏。
        if (this.disposed) {
          tex.dispose()
          return tex
        }
        this.loaded.add(tex)
        return tex
      })
      .catch((err) => {
        console.warn(`[card-renderer] 资源加载失败，回退为 null：${rel}`, err)
        return null
      })
    this.map.set(key, p)
    return p
  }

  /** 释放所有已加载纹理；此后缓存进入终态。 */
  dispose(): void {
    this.disposed = true
    for (const tex of this.loaded) tex.dispose()
    this.loaded.clear()
    this.map.clear()
  }
}
