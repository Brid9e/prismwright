/**
 * 卡片缩略图：读后台预览流水线生成的 `.previews/<id>.png`，转成 object URL。
 *
 * 为什么不用 `<img src="file://…">`：Tauri 的 asset 协议没有为本项目开启，直接引用本地
 * 路径会被 WebView 拦掉。走 `packFs` 读字节再 `createObjectURL` 是已经验证过的路径
 * （与渲染器的 `resolve-asset` 同源）。
 *
 * 缓存键带 `cardRenderHash`：卡片内容一变，键就变，于是缩略图自然重取（预览流水线在
 * 落盘后会重写同名 PNG）。没有它，改完卡片后列表会一直显示旧图，直到重启。
 *
 * 读不到（预览还没生成 / 文件损坏 / 无 Tauri 环境）就返回 null，列表回落稀有度色块，
 * **不阻塞**卡片库渲染。
 */
import { useEffect, useState } from "react"
import type { Card } from "@prismwright/schema"
import { usePackStore } from "../../store/packStore"
import { packFs } from "../../tauri/pack-fs"
import { cardRenderHash } from "../preview-assets/card-hash"
import { previewPngRel } from "../preview-assets/paths"

/** object URL 缓存上限；超出后按插入顺序淘汰并释放。 */
const MAX_CACHE = 64

const cache = new Map<string, string>()

function remember(key: string, url: string): void {
  cache.set(key, url)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const stale = cache.get(oldest)
    cache.delete(oldest)
    if (stale) URL.revokeObjectURL(stale)
  }
}

/** 某张卡的缩略图 URL；不可用时为 null。 */
export function useCardThumbnail(card: Card): string | null {
  const rootDir = usePackStore((s) => s.rootDir)
  const aspect = usePackStore((s) => s.pack?.aspect ?? 1)
  const key = rootDir ? `${rootDir}|${card.id}|${cardRenderHash(card, aspect)}` : ""
  const [url, setUrl] = useState<string | null>(() => (key ? (cache.get(key) ?? null) : null))

  useEffect(() => {
    if (!rootDir || !key) {
      setUrl(null)
      return
    }
    const hit = cache.get(key)
    if (hit) {
      setUrl(hit)
      return
    }

    let alive = true
    setUrl(null)
    void (async () => {
      try {
        const bytes = await packFs.readAssetBytes(rootDir, previewPngRel(card.id))
        if (!alive) return
        const objectUrl = URL.createObjectURL(new Blob([bytes]))
        remember(key, objectUrl)
        setUrl(objectUrl)
      } catch {
        // 没有预览文件：保持 null，由调用方回落色块。
      }
    })()

    return () => {
      alive = false
    }
  }, [key, rootDir, card.id])

  return url
}
