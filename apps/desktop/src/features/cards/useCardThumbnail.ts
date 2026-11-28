/**
 * 卡片缩略图：读后台预览流水线生成的 `.previews/<id>.png`，转成 object URL。
 *
 * 为什么不用 `<img src="file://…">`：Tauri 的 asset 协议没有为本项目开启，直接引用本地
 * 路径会被 WebView 拦掉。走 `packFs` 读字节再 `createObjectURL` 是已经验证过的路径
 * （与渲染器的 `resolve-asset` 同源）。
 *
 * 缓存键带 `cardRenderHash`：卡片内容一变，键就变，于是缩略图自然重取。但光有键还不够——
 * 预览是**异步**生成的（落盘防抖 + 多秒渲染），生成时刻卡片数据没再变，effect 不会重跑。
 * 因此流水线每写出一张 PNG 就调 {@link invalidateCardThumbnails}，用一个版本号把已挂载的
 * 缩略图重新读一遍；否则新卡永远显示编号块、改过的卡永远落后一版。
 *
 * 读不到（预览还没生成 / 文件损坏 / 无 Tauri 环境）就返回 null，列表回落稀有度色块，
 * **不阻塞**卡片库渲染。
 */
import { useEffect, useState, useSyncExternalStore } from "react"
import type { Card } from "@prismwright/schema"
import { usePackStore } from "../../store/packStore"
import { packFs } from "../../tauri/pack-fs"
import { cardRenderHash } from "../preview-assets/card-hash"
import { previewPngRel } from "../preview-assets/paths"

/** object URL 缓存上限；超出后按插入顺序淘汰并释放。 */
const MAX_CACHE = 64

interface CacheEntry {
  url: string
  /** 写入时的全局版本；与当前版本不符即视为过期，需要重读。 */
  version: number
}

const cache = new Map<string, CacheEntry>()

let version = 0
const versionListeners = new Set<() => void>()

/**
 * 预览流水线写出新 PNG 后调用：让所有在用的缩略图重读一次。
 */
export function invalidateCardThumbnails(): void {
  version += 1
  for (const listener of versionListeners) listener()
}

function subscribe(listener: () => void): () => void {
  versionListeners.add(listener)
  return () => {
    versionListeners.delete(listener)
  }
}

function remember(key: string, url: string, entryVersion: number): void {
  // 同一键换新图时不立刻 revoke 旧 URL：旧 URL 可能还被上一帧的 <img> 显示着，
  // 提前释放会让那一行闪一下破图。淘汰时才释放。
  cache.set(key, { url, version: entryVersion })
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const stale = cache.get(oldest)
    cache.delete(oldest)
    if (stale) URL.revokeObjectURL(stale.url)
  }
}

/** 某张卡的缩略图 URL；不可用时为 null。 */
export function useCardThumbnail(card: Card): string | null {
  const rootDir = usePackStore((s) => s.rootDir)
  const aspect = usePackStore((s) => s.pack?.aspect ?? 1)
  const key = rootDir ? `${rootDir}|${card.id}|${cardRenderHash(card, aspect)}` : ""

  const currentVersion = useSyncExternalStore(subscribe, () => version)
  const fresh = key ? cache.get(key) : undefined
  const [url, setUrl] = useState<string | null>(() =>
    fresh && fresh.version === currentVersion ? fresh.url : null,
  )

  useEffect(() => {
    if (!rootDir || !key) {
      setUrl(null)
      return
    }
    const hit = cache.get(key)
    if (hit && hit.version === currentVersion) {
      setUrl(hit.url)
      return
    }

    let alive = true
    setUrl(null)
    void (async () => {
      try {
        const bytes = await packFs.readAssetBytes(rootDir, previewPngRel(card.id))
        if (!alive) return
        const objectUrl = URL.createObjectURL(new Blob([bytes]))
        remember(key, objectUrl, currentVersion)
        setUrl(objectUrl)
      } catch {
        // 没有预览文件：保持 null，由调用方回落色块。
      }
    })()

    return () => {
      alive = false
    }
  }, [key, rootDir, card.id, currentVersion])

  return url
}
