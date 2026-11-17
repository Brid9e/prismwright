/**
 * 「未揭晓」卡面：纯深色底 + 居中一个大问号。
 *
 * 抽卡页的卡在翻过来之前不能露出真卡面（见 `card-view` 的 `frontLayersShown` 与翻面闸门），
 * 但也不能是一片空白——空卡看起来像加载失败。旧版是棋盘格上交错印水豚 logo 与问号，
 * 太碎；现在只留一个问号，干净，翻面过程中也一眼读得出「还没揭晓」。
 *
 * 为什么放在渲染器里而不是 canvas 上盖一层 HTML：它得跟着卡片一起转（圆角、透视、厚度切边
 * 都要对），叠在画布上的元素做不到。
 *
 * 图案走 `DataTexture` 而不是 `CanvasTexture`，与文字纹理同理（见 `text-texture.ts`）：
 * 小程序离屏 canvas 能否直接当 `TexImageSource` 各端不一致，而像素拷贝两端确定。
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
  type Texture,
} from "three"
import { CARD_ASPECT } from "./card-scene"
import { GLSL_ROUNDED_RECT_MASK, GLSL_VERTEX } from "./shaders/common"
import { createTextCanvas, type TextContext2D } from "./text-texture"
import { flipRowsInPlace } from "./text-layout"

/**
 * 纹理高度（像素）。
 *
 * 按「一屏卡面约 700 设备像素」定：再高只是给纯色底和一个问号多付显存。
 */
export const MYSTERY_TEXTURE_HEIGHT = 672

/** 默认 5:7 卡面下的纹理宽度（480 × 672）。 */
export const MYSTERY_TEXTURE_WIDTH = Math.round(MYSTERY_TEXTURE_HEIGHT * CARD_ASPECT)

/**
 * 某宽高比下的纹理宽度：高度固定，宽度跟着卡面走——问号才不会在非 5:7 的系列卡上被拉扁。
 */
export function mysteryTextureWidth(aspect: number): number {
  if (!(aspect > 0)) return MYSTERY_TEXTURE_WIDTH
  return Math.max(1, Math.round(MYSTERY_TEXTURE_HEIGHT * aspect))
}

/** 底色：近乎纯黑，不抢稀有度光晕的戏，也像一张还没翻开的卡。 */
const BACKGROUND = "#141417"

/** 问号颜色：半透明灰紫，低对比度但不至于看不见。 */
const INK_COLOR = "rgba(150, 150, 165, 0.55)"

/** 问号字号占纹理高度的比例：正视角下就是一个大问号。 */
const QUESTION_SIZE_RATIO = 0.52

/** 问号用的字体：两端都有、且字形粗壮的通用族（不依赖产品字体是否装上）。 */
const QUESTION_FONT = "sans-serif"

/**
 * 栅格化需要的 2D 上下文成员。
 *
 * 在 {@link TextContext2D} 之上只补一个填充矩形：旧版的路径绘制随 logo 一起撤掉了。
 */
export interface MysteryContext2D extends TextContext2D {
  fillRect(x: number, y: number, w: number, h: number): void
}

/** 2D 画布的最小结构性接口（{@link TextCanvas2D} 的加宽版）。 */
export interface MysteryCanvas2D {
  width: number
  height: number
  getContext(type: "2d"): MysteryContext2D | null
}

/** 画布工厂；单测注入假实现。 */
export type MysteryCanvasFactory = (width: number, height: number) => MysteryCanvas2D | null

/** 默认画布工厂：复用文字纹理那套跨端取画布的逻辑。 */
const defaultCanvasFactory: MysteryCanvasFactory = (width, height) =>
  createTextCanvas(width, height) as unknown as MysteryCanvas2D | null

/** 把整张未揭晓卡面画到 2D 上下文上：先铺底色，再居中印一个大问号。 */
export function drawMysteryCard(ctx: MysteryContext2D, width: number, height: number): void {
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = INK_COLOR
  ctx.font = `bold ${Math.round(height * QUESTION_SIZE_RATIO)}px ${QUESTION_FONT}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("?", width / 2, height / 2)
}

/**
 * 生成底纹纹理。
 *
 * @param createCanvas - 画布工厂；缺省按平台自取。
 * @param aspect - 卡面宽高比；决定纹理宽度，避免问号被拉扁。
 * @returns 纹理；拿不到 2D 画布时为 `null`（调用方退化成直接显示真卡面）。
 */
export function createMysteryTexture(
  createCanvas: MysteryCanvasFactory = defaultCanvasFactory,
  aspect: number = CARD_ASPECT,
): Texture | null {
  const textureWidth = mysteryTextureWidth(aspect)
  const canvas = createCanvas(textureWidth, MYSTERY_TEXTURE_HEIGHT)
  if (!canvas) return null
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  drawMysteryCard(ctx, textureWidth, MYSTERY_TEXTURE_HEIGHT)

  const { data } = ctx.getImageData(0, 0, textureWidth, MYSTERY_TEXTURE_HEIGHT)
  // 画布行序是「上 -> 下」，WebGL 纹理从上往下数第 0 行在 v = 0 处；翻过来才与屏幕方向一致。
  flipRowsInPlace(data, textureWidth, MYSTERY_TEXTURE_HEIGHT)

  const texture = new DataTexture(
    data,
    textureWidth,
    MYSTERY_TEXTURE_HEIGHT,
    RGBAFormat,
    UnsignedByteType,
  )
  // 画布内容是 sRGB：着色器按纹理解码后在线性空间合成。
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

/**
 * 底纹的片元着色器。
 *
 * 只有「采样 + 圆角遮盖」两件事：这不是卡面，没有光泽 / 蒙版 / 擦除——那些都属于被藏起来的
 * 真卡面。圆角必须与卡面用**同一个** {@link GLSL_ROUNDED_RECT_MASK}，否则底纹会盖到侧壁上
 * （圆角处白边的另一条来路）。
 */
const MYSTERY_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uAspect;
uniform float uCornerRadius;
varying vec2 vUv;

${GLSL_ROUNDED_RECT_MASK}

void main() {
  float card = roundedRectMask(vUv, uAspect, uCornerRadius);
  if (card < 0.001) discard;
  vec4 base = texture2D(uMap, vUv);
  gl_FragColor = vec4(base.rgb, card);
  #include <colorspace_fragment>
}
`

/** 未揭晓底纹的材质与纹理。 */
export interface MysteryFace {
  /** 盖在主卡面平面上的材质。 */
  material: ShaderMaterial
  /** 释放材质与纹理。 */
  dispose(): void
}

/**
 * 创建未揭晓底纹。
 *
 * @param opts.aspect - 卡面宽高比（宽/高）。
 * @param opts.cornerRadius - 圆角半径（与卡面同一口径，卡高单位）。
 * @param opts.createCanvas - 画布工厂；单测注入假实现。
 * @returns 材质句柄；拿不到 2D 画布时为 `null`。
 */
export function createMysteryFace(opts: {
  aspect: number
  cornerRadius: number
  createCanvas?: MysteryCanvasFactory
}): MysteryFace | null {
  const texture = createMysteryTexture(opts.createCanvas, opts.aspect)
  if (!texture) {
    // 降级：没有画布就没有底纹。卡片照常显示真卡面（等于改造前的行为），不抛异常。
    console.warn("[card-renderer] 拿不到 2D 画布，未揭晓底纹不可用")
    return null
  }
  const material = new ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uAspect: { value: opts.aspect },
      uCornerRadius: { value: opts.cornerRadius },
    },
    vertexShader: GLSL_VERTEX,
    fragmentShader: MYSTERY_FRAGMENT,
    transparent: true,
    side: DoubleSide,
  })
  return {
    material,
    dispose() {
      material.dispose()
      texture.dispose()
    },
  }
}
