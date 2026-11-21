/**
 * 吸管取色的纯换算部分。
 *
 * 预览里点到的位置给出的是**卡面 UV**，而拾色要的是**底图原图像素**——两者之间隔着
 * 填充方式 / 偏移 / 缩放 / 旋转（`frontUvTransform`），再隔着「纹理 v 向上、像素行向下」
 * 这一次翻转。把这两步拆成可单测的小函数放这里，预览面板只负责挂事件、取 `ImageData`。
 *
 * 与渲染同源很关键：底图片元用的就是同一个 `frontUvTransform`，这里绝不能再手写一份
 * 近似公式，否则吸到的颜色会和画面对不上。
 */
import { CARD_ASPECT, frontUvTransform, sampleFrontUv } from "@prismwright/renderer/v1"
import { alphaOf, withAlpha, type ColorStop, type FrontFit } from "@prismwright/schema"
import type { FaceRef } from "../../store/packStore"
import { replaceStop } from "../layers/colors"

/** 一张已解码图片的尺寸（只取换算需要的两项）。 */
export interface ImageSize {
  width: number
  height: number
}

/** 底图在卡面上的摆放参数，与 `CardFace` 的 `front*` 字段同义。 */
export interface FrontPlacement {
  fit: FrontFit
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
}

/**
 * 纹理 UV → 原图像素坐标（左上角为原点）。
 *
 * three 的纹理默认 `flipY`，所以 `v = 0` 是图片**底边**：像素行要按 `1 - v` 取。
 * 越界（点在卡面底色或图片被裁掉的部分）返回 `null`——那里没有原图可吸。
 */
export function imagePixelCoord(
  u: number,
  v: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (!(width > 0) || !(height > 0)) return null
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  const x = Math.min(width - 1, Math.floor(u * width))
  const y = Math.min(height - 1, Math.floor((1 - v) * height))
  return { x, y }
}

/**
 * 卡面 UV → 原图像素坐标；点在图片范围外时返回 `null`。
 *
 * @param cardAspect - 这张卡的宽高比（宽/高）；省略按 5:7。比例错了会吸到画面旁侧的颜色。
 */
export function frontPixelCoord(
  u: number,
  v: number,
  size: ImageSize,
  placement: FrontPlacement,
  cardAspect: number = CARD_ASPECT,
): { x: number; y: number } | null {
  const t = frontUvTransform({
    imageAspect: size.width / size.height,
    cardAspect,
    fit: placement.fit,
    offsetX: placement.offsetX,
    offsetY: placement.offsetY,
    scale: placement.scale,
    rotation: placement.rotation,
  })
  const uv = sampleFrontUv(t, u, v)
  return imagePixelCoord(uv.u, uv.v, size.width, size.height)
}

/**
 * 拾色请求的目标卡面是否正是预览现在显示的那一面。
 *
 * 请求是在效果栈里发起的（记下「写回哪个卡面」），而预览同一时刻只显示一张。
 * 两边对不上时不能落点：否则在背面视图点了正面的效果，吸到的是背面的颜色。
 */
export function faceRefMatches(
  ref: FaceRef,
  side: "front" | "back",
  selectedCardId: string | null,
): boolean {
  if (ref.kind === "back") return side === "back"
  return side === "front" && ref.cardId === selectedCardId
}

/**
 * 点击拾色层后的处置。
 *
 * - `sample`：取到颜色，写回效果参数并退出拾色；
 * - `cancel`：退出拾色。点在卡外、或卡面根本没有底图时用它——拾色层盖住整个预览，
 *   不退出就等于把卡片锁死（旧实现正是这样让十字光标「关不掉」）；
 * - `ignore`：底图还在解码、或点在图片被裁掉的区域，允许用户再点一次。
 */
export type PickClickAction = "sample" | "cancel" | "ignore"

export interface PickClickState {
  /** 点击落在卡面内（`pickUv` 有值）。 */
  insideCard: boolean
  /** 当前卡面设置了底图。 */
  hasFrontImage: boolean
  /** 从底图采到的颜色；未解码完 / 落在图外时为 `null`。 */
  color: string | null
}

export function pickClickAction(state: PickClickState): PickClickAction {
  if (!state.insideCard) return "cancel"
  if (!state.hasFrontImage) return "cancel"
  return state.color === null ? "ignore" : "sample"
}

/**
 * 把吸到的颜色写回某个色标：只换色值，位置不动；**保留该色标原有的透明度**。
 *
 * 吸管取的是底图的 RGB，没有透明度可言。若直接用 6 位色值覆盖，一个半透明的色标会
 * 在吸色后突然变实——那是用户没要求的改动。故透明度沿用色标自己的那一份。
 *
 * @param colors - 现有色标数组。
 * @param index - 目标下标；越界（拾色期间效果被删）时返回原数组引用。
 * @param hex - 吸到的 `#rrggbb`。
 */
export function applyPickedStopColor(colors: ColorStop[], index: number, hex: string): ColorStop[] {
  const stop = colors[index]
  if (!stop) return colors
  return replaceStop(colors, index, withAlpha(hex, alphaOf(stop.color)))
}

/** 0–255 的三通道转 `#rrggbb`（小写，与 schema 的 hex 规范一致）。 */
export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * 从已解码的图片上取某点的颜色（`#rrggbb`），超出图片范围返回 `null`。
 *
 * 走离屏 canvas：图片只解码一次、每点一次只读 1×1 像素，开销可以忽略。
 */
export function sampleImageColor(
  drawable: CanvasImageSource,
  size: ImageSize,
  coord: { x: number; y: number },
): string | null {
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(drawable, 0, 0)
  const [r, g, b] = ctx.getImageData(coord.x, coord.y, 1, 1).data
  return rgbToHex(r, g, b)
}
