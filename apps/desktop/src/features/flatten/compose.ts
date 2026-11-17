/**
 * 把一组纯图片图层烤成一张 PNG（浏览器侧：解码 → 离屏画布 → 编码 → 落盘）。
 *
 * 本文件是 `pack-flatten.ts` 注入的那个 `compose` 的真实实现，只做 IO 与绘制；
 * 「哪几张图、画多大、摆在哪」全部来自 `flatten.ts` 的纯函数——那套换算与渲染器共用
 * 同一份 `fitImageSize` / `CARD_ASPECT`，合并前后才逐像素对得上。
 *
 * 三种混合模式的处理（能走到这里的只有 `add` 与 `normal`，见 `flatten.ts` 的判据）：
 * - `add` → 画布 `lighter`：逐通道相加，与 three 的 `AdditiveBlending` 等价；
 * - `normal` → 画布默认 `source-over`，即 Porter-Duff `over`，满足结合律。
 *
 * 每层各自的 `opacity` 在这里乘成 `globalAlpha`：组内先按原样叠出像素，产物再以不透明度
 * 1 叠回卡面，效果与逐层叠加一致（`pack-flatten.ts` 因此把新图层的不透明度设为 1）。
 */
import { resolveImage, type Layer } from "@cardbara/schema"
import { CARD_ASPECT } from "@cardbara/renderer/v1"
import { packFs } from "../../tauri/pack-fs"
import { imageEffectPath, placementFor, planCanvasSize, sizingOf } from "./flatten"

/** 合成所需的 IO 依赖；测试或换存储时替换这两项即可。 */
export interface ComposeContext {
  /** 系列根目录（绝对路径）。 */
  packRoot: string
  /** 目标卡面的宽高比（宽/高）；省略按 5:7。决定画布形状与图片取景。 */
  aspect?: number
  /** 读系列内资源字节；缺省走 Tauri。 */
  readBytes?: (packRoot: string, rel: string) => Promise<ArrayBuffer>
  /** 写系列内资源字节；缺省走 Tauri。 */
  writeBytes?: (packRoot: string, rel: string, bytes: Uint8Array) => Promise<void>
}

/** 混合模式 → 画布合成算子。只给可合并的两种，其余落到 `source-over`。 */
function compositeOp(blend: Layer["blend"]): GlobalCompositeOperation {
  return blend === "add" ? "lighter" : "source-over"
}

/** 解码一张图。`createImageBitmap` 在两个目标 webview（WebView2 / WKWebView）都可用。 */
async function decode(bytes: ArrayBuffer): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes]))
}

/** 把画布编码成 PNG 字节。 */
async function encode(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画布编码 PNG 失败"))),
      "image/png",
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * 把一组图层合成一张 PNG 写进系列，返回新图的相对路径。
 *
 * @param layers - 同一卡面上相邻、混合模式相同的一组图层（绘制顺序）。
 * @param ctx - IO 上下文。
 * @returns 新 PNG 的相对路径（`assets/<uuid>.png`）。
 * @throws 读图 / 解码 / 编码 / 落盘任一步失败时抛出——调用方据此放弃本次合并。
 */
export async function composeGroup(layers: readonly Layer[], ctx: ComposeContext): Promise<string> {
  const readBytes = ctx.readBytes ?? packFs.readAssetBytes
  const writeBytes = ctx.writeBytes ?? packFs.writeBytesAtomic
  const cardAspect = ctx.aspect ?? CARD_ASPECT

  const parts: {
    layer: Layer
    params: NonNullable<ReturnType<typeof resolveImage>>
    bitmap: ImageBitmap
  }[] = []
  try {
    for (const layer of layers) {
      const rel = imageEffectPath(layer)
      const params = resolveImage(layer.effects)
      if (!rel || !params) continue
      const bitmap = await decode(await readBytes(ctx.packRoot, rel))
      parts.push({ layer, params, bitmap })
    }

    if (parts.length === 0) throw new Error("没有可合成的图片")

    const size = planCanvasSize(
      parts.map((p) => sizingOf(p.params, { width: p.bitmap.width, height: p.bitmap.height }, cardAspect)),
      cardAspect,
    )
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const g = canvas.getContext("2d")
    if (!g) throw new Error("无法创建 2D 画布")

    for (const { layer, params, bitmap } of parts) {
      const natural = { width: bitmap.width, height: bitmap.height }
      const place = placementFor(params, natural, size, cardAspect)
      g.save()
      g.globalAlpha = layer.opacity
      g.globalCompositeOperation = compositeOp(layer.blend)
      g.translate(place.centerX, place.centerY)
      g.rotate(place.rotationRad)
      g.drawImage(bitmap, -place.drawWidth / 2, -place.drawHeight / 2, place.drawWidth, place.drawHeight)
      g.restore()
    }

    const rel = `assets/${crypto.randomUUID()}.png`
    await writeBytes(ctx.packRoot, rel, await encode(canvas))
    return rel
  } finally {
    for (const p of parts) p.bitmap.close()
  }
}
