/**
 * 文字纹理：把文字参数栅格化成一张卡面同比例、行序已翻好的 RGBA 纹理。
 *
 * 为什么走 `DataTexture` 而不是 `CanvasTexture`：上传的是普通类型化数组，WebGL 语义在
 * 浏览器与小程序离屏 canvas 上都确定；canvas 能否直接当 `TexImageSource` 在各端不一致。
 * 文字重绘只发生在参数变化时（不是逐帧），一次全图拷贝（约 3 MB）换来跨端一致性值得。
 *
 * 降级：拿不到 2D 画布、或栅格化抛错时返回 `null`——该层按「无文字」处理（不出图，
 * 作为祖先时也不裁切子树），并每个图层只警告一次。
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from "three"
import type { Layer, TextParams } from "@prismwright/schema"
import { CARD_ASPECT } from "./card-scene"
import { flipRowsInPlace, fontCssString, layoutText, type TextBlockLayout } from "./text-layout"

/** 文字纹理的像素高度；宽度按卡面宽高比推得（1024 × 1.4⁻¹ ≈ 731）。 */
export const TEXT_TEXTURE_HEIGHT = 1024
export const TEXT_TEXTURE_WIDTH = Math.round(TEXT_TEXTURE_HEIGHT * CARD_ASPECT)

/**
 * 某宽高比下的文字画布尺寸：高固定 {@link TEXT_TEXTURE_HEIGHT}，宽按比例算。
 *
 * 画布与卡面同比例，文字按「卡高比例」排版才不会被拉扁；比例可变的卡各自用自己的尺寸。
 */
export function textTextureSize(aspect: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(TEXT_TEXTURE_HEIGHT * aspect)),
    height: TEXT_TEXTURE_HEIGHT,
  }
}

/**
 * 2D 上下文的最小结构性接口：DOM 的 `CanvasRenderingContext2D` 与小程序离屏 canvas 的
 * 上下文都满足它。只声明用到的成员，免得把 three / 平台类型拖进来。
 */
export interface TextContext2D {
  font: string
  textAlign: string
  textBaseline: string
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  save(): void
  restore(): void
  clearRect(x: number, y: number, w: number, h: number): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  scale(x: number, y: number): void
  measureText(text: string): { width: number }
  fillText(text: string, x: number, y: number): void
  strokeText(text: string, x: number, y: number): void
  // 缓冲区类型写死成 `ArrayBuffer`（DOM 的 `ImageData.data` 同款）：TS 5.7 起类型化数组
  // 带缓冲来源泛型，裸 `Uint8ClampedArray` 是 `ArrayBufferLike`（含 SharedArrayBuffer），
  // three 的 `DataTexture` 不收。
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray<ArrayBuffer> }
}

/** 2D 画布的最小结构性接口。 */
export interface TextCanvas2D {
  width: number
  height: number
  getContext(type: "2d"): TextContext2D | null
}

/** {@link createTextTexture} 的可选参数。 */
export interface TextTextureOptions {
  /** 画布工厂（默认按平台自取，见 {@link createTextCanvas}）；单测注入假实现。 */
  createCanvas?: (width: number, height: number) => TextCanvas2D | null
  /** 卡面宽高比；只在不传 `width` 时用来推画布宽度（默认 {@link CARD_ASPECT}）。 */
  aspect?: number
  width?: number
  height?: number
}

/**
 * 取一张离屏 2D 画布：桌面 / 浏览器走 `document`，小程序走 `wx.createOffscreenCanvas`。
 *
 * 两者都没有时返回 `null`——调用方按无文字降级，不抛异常。
 */
export function createTextCanvas(width: number, height: number): TextCanvas2D | null {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    return canvas as unknown as TextCanvas2D
  }
  const wx = (globalThis as { wx?: { createOffscreenCanvas?: (options: unknown) => unknown } }).wx
  if (!wx?.createOffscreenCanvas) return null
  try {
    return wx.createOffscreenCanvas({ type: "2d", width, height }) as TextCanvas2D
  } catch {
    return null
  }
}

/**
 * hex → `rgba(r, g, b, a)`；接受 #rgb / #rrggbb / #rrggbbaa。
 *
 * 8 位 hex 自带的透明度**乘进**参数 `alpha`（文字投影因此是「颜色 alpha × 投影不透明度」）。
 * 输出统一用 `rgba()` 而不是把 hex 原样交给画布：小程序离屏画布对 8 位 hex 的支持没有保证，
 * `rgba()` 两边都认。
 */
export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "")
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.padEnd(6, "0").slice(0, 6)
  const value = Number.parseInt(full, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  const own = raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1
  const a = Math.min(1, Math.max(0, alpha * own))
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 10000) / 10000})`
}

/**
 * 按排版结果落笔。
 *
 * 有投影时画两遍：第一遍带投影、第二遍把 shadow 关掉用**完全相同的命令**再画一遍，
 * 第二遍的字身盖住第一遍，只留下向外扩散的投影。否则描边与填充各带一次投影，投影会
 * 叠两次、且半透明填充会让底下的投影透出来。
 */
function drawLines(
  ctx: TextContext2D,
  layout: TextBlockLayout,
  params: TextParams,
  height: number,
): void {
  const stroke = params.stroke
  const shadow = params.shadow
  const paint = () => {
    for (const line of layout.lines) {
      // 布局 y 向上为正，画布 y 向下：落笔取反。
      const y = -line.y
      for (const run of line.runs) {
        if (run.text === "") continue
        const x = line.x + run.x
        if (stroke && stroke.width > 0) {
          // 走 rgba()：颜色自带的透明度（8 位 hex）在这里落地，见 hexToRgba。
          ctx.strokeStyle = hexToRgba(stroke.color, 1)
          ctx.lineWidth = stroke.width * height
          ctx.strokeText(run.text, x, y)
        }
        ctx.fillStyle = hexToRgba(params.color, 1)
        ctx.fillText(run.text, x, y)
      }
    }
  }
  if (!shadow) {
    paint()
    return
  }
  ctx.shadowColor = hexToRgba(shadow.color, shadow.opacity)
  ctx.shadowBlur = shadow.blur * height
  ctx.shadowOffsetX = shadow.offsetX * height
  // 投影偏移的 y 与文字 y 同口径（向上为正），画布向下，故取反。
  ctx.shadowOffsetY = -shadow.offsetY * height
  paint()
  ctx.shadowColor = "transparent"
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  paint()
}

/**
 * 文字栅格化后的像素：**行序与 PNG 一致**（第 0 行是画面顶部），未按纹理口径翻转。
 *
 * 发布时要用它把文字烤成 PNG 资源（见桌面端 `features/publish/bake-text.ts`）；纹理那边
 * 再自行翻转（见 {@link createTextTexture}）。
 */
export interface TextRaster {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

/**
 * 把文字参数画到离屏画布上、取回像素。
 *
 * @returns 未翻转的像素；内容为空白、或拿不到画布 / 栅格化失败时为 `null`。
 */
export function renderTextRaster(
  params: TextParams,
  opts: TextTextureOptions = {},
): TextRaster | null {
  if (params.content.trim() === "") return null
  const height = opts.height ?? TEXT_TEXTURE_HEIGHT
  const width = opts.width ?? Math.round(height * (opts.aspect ?? CARD_ASPECT))
  const canvas = (opts.createCanvas ?? createTextCanvas)(width, height)
  const ctx = canvas?.getContext("2d") ?? null
  if (!canvas || !ctx) return null
  try {
    // 字体必须先于测量：`measureText` 按当前 `ctx.font` 量宽度，而新画布默认是
    // 10px sans-serif——先测后设的话，量出来的宽度与真正落笔的字号差一个数量级，
    // 居中 / 右对齐会整块偏出去。
    ctx.font = fontCssString(params, params.fontSize * height)
    const layout = layoutText(params, (text) => ctx.measureText(text).width, height)
    ctx.clearRect(0, 0, width, height)
    ctx.save()
    // 原点搬到文字块中心，再按整块旋转 / 缩放；块内坐标于是与 layoutText 的口径一致。
    ctx.translate(width / 2 + params.x * height, height / 2 - params.y * height)
    ctx.rotate((params.rotation * Math.PI) / 180)
    ctx.scale(params.scale, params.scale)
    // runs 各自带起点，一律左对齐落笔；基线取中线，行高中线才落在块内。
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.lineJoin = "round"
    drawLines(ctx, layout, params, height)
    ctx.restore()

    const image = ctx.getImageData(0, 0, width, height)
    return { width, height, data: image.data }
  } catch (err) {
    console.warn("[card-renderer] 文字栅格化失败", err)
    return null
  }
}

/**
 * 把文字参数栅格化成纹理。
 *
 * @returns 纹理；内容为空白、或拿不到画布 / 栅格化失败时为 `null`。
 *
 * 空内容返回 `null` 而不是全透明纹理：二者在着色器里等价（`uHasText = 0` 整段跳过），
 * 但 `null` 让祖先蒙版槽位一并置 0——「勾了作为蒙版还没输入文字」时子树不会凭空消失。
 */
export function createTextTexture(
  params: TextParams,
  opts: TextTextureOptions = {},
): Texture | null {
  const raster = renderTextRaster(params, opts)
  if (!raster) return null
  const { width, height, data } = raster
  // 画布行序是「上 -> 下」，WebGL 纹理从上往下数第 0 行在 v = 0 处；翻过来才与屏幕方向一致。
  flipRowsInPlace(data, width, height)
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType)
  // 画布内容是 sRGB：着色器按纹理解码后在线性空间合成。
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  // DataTexture 的 flipY 默认就是 false，行序已在上面的 flipRowsInPlace 翻好。
  texture.needsUpdate = true
  return texture
}

/**
 * 参与栅格化的字段按固定顺序序列化成缓存键。
 *
 * 刻意**不含** `asMask`：切换蒙版开关只重建材质，不该重画字形。
 */
export function textureKeyOf(params: TextParams): string {
  return JSON.stringify([
    params.content,
    params.fontFamily,
    params.fontSize,
    params.fontWeight,
    params.italic,
    params.color,
    params.letterSpacing,
    params.lineHeight,
    params.align,
    params.x,
    params.y,
    params.scale,
    params.rotation,
    params.stroke?.color ?? null,
    params.stroke?.width ?? null,
    params.shadow?.color ?? null,
    params.shadow?.opacity ?? null,
    params.shadow?.offsetX ?? null,
    params.shadow?.offsetY ?? null,
    params.shadow?.blur ?? null,
  ])
}

/** {@link TextTextureCache} 的可选参数。 */
export interface TextTextureCacheOptions {
  /** 卡面宽高比（默认 {@link CARD_ASPECT}）；只在缓存内部默认工厂造纹理时用。 */
  aspect?: number
  /** 纹理工厂；单测注入假实现。默认 `createTextTexture`，并按 {@link TextTextureCacheOptions.aspect} 定尺寸。 */
  createTexture?: (params: TextParams, size: { width: number; height: number }) => Texture | null
}

/**
 * 把「面」与图层 id 拼成缓存键。
 *
 * 双面卡的正反两面是两棵独立的图层树，id 却可能相同（复制面时沿用原 id 很自然），
 * 若只按 id 缓存会互相覆盖。分隔符用 NUL：图层 id 来自用户 / schema，不会含它，
 * 拼接不会产生歧义。`scope` 为空时原样返回 id——单面卡的行为与加作用域之前完全一致。
 */
export function scopedLayerId(scope: string, layerId: string): string {
  return scope === "" ? layerId : `${scope}\u0000${layerId}`
}

/**
 * 按「面 + 图层 id」缓存文字纹理。
 *
 * `card-view` 的 rebuild 会被每次 `update(card)` 触发（包括每敲一个字），若每次都重新
 * 栅格化，打字会变成持续重画。缓存键由**参与栅格化的字段**决定：同 id 同键复用，键变
 * 则建新纹理并释放旧的；`retain` 按「卡面里还存在的图层 id」释放已删除图层的纹理
 * （关掉眼睛的层仍保留，避免反复重画）。键里的面作用域见 {@link scopedLayerId}。
 */
export class TextTextureCache {
  private readonly entries = new Map<string, { key: string; texture: Texture }>()
  private readonly warned = new Set<string>()
  private readonly createTexture: (
    params: TextParams,
    size: { width: number; height: number },
  ) => Texture | null
  private readonly size: { width: number; height: number }

  constructor(opts: TextTextureCacheOptions = {}) {
    this.size = textTextureSize(opts.aspect ?? CARD_ASPECT)
    this.createTexture = opts.createTexture ?? ((params, size) => createTextTexture(params, size))
  }

  /**
   * 取某图层的文字纹理；不是文字层、内容为空或创建失败时为 `null`。
   *
   * @param layer - 任意图层；只有 `kind === "text" && text !== null` 才参与。
   * @param scope - 面的作用域（如 `"back"`）；默认 `""` 即单面 / 主卡面。
   */
  get(layer: Layer, scope = ""): Texture | null {
    const params = layer.text
    if (layer.kind !== "text" || !params) return null
    const id = scopedLayerId(scope, layer.id)
    const key = textureKeyOf(params)
    const hit = this.entries.get(id)
    if (hit && hit.key === key) return hit.texture
    const texture = this.createTexture(params, this.size)
    if (!texture) {
      // 降级：按作用域后的 id 只警告一次，免得每次重建刷屏；失败结果不缓存，下次再试。
      if (!this.warned.has(id)) {
        this.warned.add(id)
        console.warn("[card-renderer] 文字层无法栅格化，按无文字处理", layer.id)
      }
      hit?.texture.dispose()
      this.entries.delete(id)
      return null
    }
    hit?.texture.dispose()
    this.entries.set(id, { key, texture })
    return texture
  }

  /**
   * 释放不在 `ids` 里的纹理（删层 / 改成普通层时）。
   *
   * `ids` 必须是**已拼好面作用域**的 id（`scopedLayerId` 的返回值），否则默认面的
   * 纹理会被当成「已删除」释放掉。
   */
  retain(ids: ReadonlySet<string>): void {
    for (const [id, entry] of this.entries) {
      if (ids.has(id)) continue
      entry.texture.dispose()
      this.entries.delete(id)
      this.warned.delete(id)
    }
  }

  /** 释放全部纹理。 */
  dispose(): void {
    for (const entry of this.entries.values()) entry.texture.dispose()
    this.entries.clear()
    this.warned.clear()
  }
}
