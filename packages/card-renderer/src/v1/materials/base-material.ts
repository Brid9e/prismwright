/**
 * 组装卡面 ShaderMaterial。
 */
import { Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4, type Texture } from "three"
import {
  alphaOf,
  DEFAULT_BUMP_LIGHT_ANGLE,
  DEFAULT_BUMP_LIGHT_COLOR,
  resolveImageMask,
  type Effect,
  type FrontFit,
} from "@cardbara/schema"
import { frontUvTransform } from "../front-uv"
import { maskUvParams } from "../mask-uv"
import { textureAspect } from "../texture-aspect"
import { CARD_BACKGROUND_COLOR } from "../card-scene"
import { GLSL_VERTEX } from "../shaders/common"
import { BASE_FRAGMENT } from "../shaders/base"
import { paletteUniforms } from "../palette"
import { maskIsActive } from "../mapping"
import { toEffectUniforms } from "../effects/uniforms"
import { toEffectUniformObjects } from "../effects/uniform-binding"
import { glossAlphaUniforms, glossColorUniforms } from "../effects/gloss-color"
import { resolveBump } from "../bump"

/** 构造卡面材质的参数。 */
export interface BaseMaterialParams {
  /** 卡面纹理。 */
  map: Texture
  /** 卡片宽高比（宽/高）。 */
  aspect: number
  /** 圆角半径（相对卡宽比例）。 */
  cornerRadius: number
  /** 卡面效果列表（光泽 / 摩尔纹 / 图蒙版等）。 */
  effects: readonly Effect[]
  /** 自流动时间（秒）；0 = 静止。实时牌堆只给当前卡推进。 */
  time?: number
  /** 卡面图蒙版纹理；无蒙版时为 `null`。 */
  mask: Texture | null
  /**
   * 蒙版擦除图（黑 = 擦掉、白 = 保留）；没有（未添加 / 未绘制 / 纹理未就绪）时为 `null`。
   *
   * 由调用方从卡面效果列表解析（`resolveEraseMask`）后传入**纹理**——材质是同步构造的，
   * 而纹理要异步读盘。传 `null` 即 `uHasErase = 0`（片元直接返回 1，不擦除）。
   */
  erase?: Texture | null
  /**
   * 是否把**被擦掉的区域**铺一层半透明底色（绘画辅助，默认关）。
   *
   * 只在交互视图的绘画会话里打开：擦除后该处本就是透明的，没有底色就分不清笔迹边界。
   * 离屏导出不传，恒为关——导出要的是真实结果，不是辅助显示。
   */
  erasePreview?: boolean
  /** 底图填充方式。默认 `"cover"`。 */
  frontFit?: FrontFit
  /** 底图水平偏移（卡高单位，正 = 图片向右）。默认 0。 */
  frontOffsetX?: number
  /** 底图垂直偏移（卡高单位，正 = 图片向上）。默认 0。 */
  frontOffsetY?: number
  /** 底图等比缩放倍率（1 = 不缩放）。默认 1。 */
  frontScale?: number
  /** 底图顺时针旋转角度（度，绕图片中心）。默认 0。 */
  frontRotation?: number
  /** 法线强度（0–1）。0 = 关（默认）。见 bump.ts。 */
  frontBumpStrength?: number
  /** 法线取样步长（卡高单位）。默认 0.01。 */
  frontBumpDetail?: number
  /** 法线对图案走势的推动比例（0–1）。默认 0.5。 */
  frontBumpFlow?: number
  /** 法线高度场的斜光明暗强度（0–1）。默认 1。 */
  frontBumpLight?: number
  /** 斜光方向（度，-180–180）。默认 127（与刻纹浮雕同向）。 */
  frontBumpLightAngle?: number
  /** 斜光颜色（hex）。默认 #ffffff（中性）。 */
  frontBumpLightColor?: string
  /** 反转法线明暗方向。默认 false。 */
  frontBumpInvert?: boolean
  /** 卡面法线贴图相对路径；空串 = 未选（默认）。只用于判定走哪条法线通路。 */
  frontNormalPath?: string
  /** 卡面法线贴图纹理；未载入（未选 / 读盘失败）时为 `null`。 */
  normal?: Texture | null
  /** 翻转卡面法线贴图的绿通道。默认 false。 */
  frontNormalFlipY?: boolean
  /**
   * `map` 是否是真卡面原图（而非 1×1 占位纹理）。颜色源蒙版要采样原图，
   * 没图时蒙版必须整体关掉。默认 `true`。
   */
  frontValid?: boolean
}

/**
 * 占位调色板（卡面材质本身不使用全息色）。
 *
 * 公共片段 `GLSL_COMMON` 声明了 `uColors` / `uStops`，而「已声明但未使用」的 uniform 数组
 * 会不会被驱动优化掉，取决于具体实现——这里保留占位，是为了不去赌那件事。改动成本两行，
 * 而这台机器上没有可自动化验证的 GL（见 `__tests__/layer-material.test.ts` 的说明）。
 */
const PLACEHOLDER = paletteUniforms([])

/**
 * 创建卡面材质。
 *
 * @param p - 见 {@link BaseMaterialParams}。
 * @returns 配置好的 `ShaderMaterial`；调用方负责在销毁时 `dispose()`。
 */
export function createBaseMaterial(p: BaseMaterialParams): ShaderMaterial {
  // 卡面自身的效果列表即其全部；它没有 moire 继承源（那是图层才有的概念），故继承参数传空。
  const fx = toEffectUniforms(p.effects, [])
  // 图蒙版从效果列表解析（与图层材质同构；卡面已无专属蒙版字段）。
  const imageMask = resolveImageMask(p.effects)
  // 颜色源蒙版采样的是卡面原图，其「蒙版图」比例就是原图比例；图片源才看蒙版纹理。
  const colorSource = imageMask?.source === "color"
  // 图蒙版的位移 / 缩放 / 旋转 / 填充方式（缺省即恒等：中心在卡心、按覆盖铺满卡面、不旋转）。
  // 填充方式要蒙版图的自然比例；卡面本身没有蒙版时无所谓，按卡面比例兜底。
  const maskUv = maskUvParams(
    p.aspect,
    imageMask,
    textureAspect(colorSource ? p.map : p.mask, p.aspect),
  )
  // 底图采样变换：比例取纹理真实宽高，填充方式与偏移来自卡面数据。
  const uv = frontUvTransform({
    imageAspect: textureAspect(p.map, p.aspect),
    cardAspect: p.aspect,
    fit: p.frontFit ?? "cover",
    offsetX: p.frontOffsetX ?? 0,
    offsetY: p.frontOffsetY ?? 0,
    scale: p.frontScale ?? 1,
    rotation: p.frontRotation ?? 0,
  })
  // 法线来源：卡面只有自己这一份（来源 1 = 卡面底图）。没有真底图时整体关掉——
  // 1×1 占位像素的亮度差没有意义，会算出一圈假斜坡。
  const bump = resolveBump(
    {
      bumpStrength: p.frontBumpStrength ?? 0,
      bumpDetail: p.frontBumpDetail ?? 0.01,
      bumpFlow: p.frontBumpFlow ?? 0.5,
      bumpLight: p.frontBumpLight ?? 1,
      bumpLightAngle: p.frontBumpLightAngle ?? DEFAULT_BUMP_LIGHT_ANGLE,
      bumpLightColor: p.frontBumpLightColor ?? DEFAULT_BUMP_LIGHT_COLOR,
      bumpInvert: p.frontBumpInvert ?? false,
      normalPath: p.frontNormalPath ?? "",
      normalFlipY: p.frontNormalFlipY ?? false,
    },
    p.frontValid ?? true,
    1,
    p.normal !== null && p.normal !== undefined,
  )
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: p.map },
      uTime: { value: p.time ?? 0 },
      // 列主序：x/y = 第一列（m00, m10），z/w = 第二列（m01, m11），见 front-uv.ts。
      uMapMatrix: { value: new Vector4(...uv.matrix) },
      uMapOffset: { value: new Vector2(uv.offsetU, uv.offsetV) },
      // 越界处垫的卡面底色。Color 会在构造时把 sRGB 十六进制转到线性工作空间，
      // 与纹理取样（three 在片元里解码 sRGB）处在同一空间。
      uMapBackground: { value: new Color(CARD_BACKGROUND_COLOR) },
      uCameraPosition: { value: new Vector3() },
      uColors: { value: PLACEHOLDER.colors.map((c) => new Color(c)) },
      uColorAlphas: { value: PLACEHOLDER.alphas },
      uStops: { value: PLACEHOLDER.positions },
      // 与上面两个数组同理：uTransition 由 GLSL_COMMON 声明（spectrum 要用），卡面不出全息、
      // 用不到它，但补个中性值，免得去赌驱动是否把它优化掉。
      uTransition: { value: 1 },
      uAspect: { value: p.aspect },
      uCornerRadius: { value: p.cornerRadius },
      // 卡面补的蒙版通路：与图层同构，供卡面镂空 / 裁切。程序化蒙版启用时着色器忽略 uMask。
      uMask: { value: p.mask },
      // 颜色源：蒙版改为采样卡面原图，按「像素色 ↔ 拾取色」的距离取权重。没有原图时
      // maskIsActive 直接判否（否则会去采 1×1 占位纹理，整卡被静默裁掉）。
      uFrontMap: { value: p.map },
      uMaskSource: { value: colorSource ? 1 : 0 },
      uMaskColor: { value: new Color(imageMask?.color ?? "#808080") },
      // 图蒙版由效果解析：图片源要求 path 非空；颜色源要求有卡面原图。
      uHasMask: { value: maskIsActive(imageMask, { frontValid: p.frontValid ?? true }) ? 1 : 0 },
      uMaskMode: { value: imageMask?.mode === "fill" ? 0 : 1 },
      uMaskInvert: { value: imageMask?.invert ? 1 : 0 },
      uLineEdge0: { value: imageMask?.edge0 ?? 0 },
      uLineEdge1: { value: imageMask?.edge1 ?? 1 },
      // 图蒙版的位移 / 缩放 / 旋转（见 mask-uv.ts）。
      uMaskCenter: { value: new Vector2(maskUv.centerX, maskUv.centerY) },
      uMaskSize: { value: new Vector2(maskUv.sizeX, maskUv.sizeY) },
      uMaskRotation: { value: maskUv.rotation },
      // 蒙版擦除：有纹理才开门。没有时补一张已有的纹理当占位——uHasErase=0 时片元不采样。
      uEraseMap: { value: p.erase ?? p.map },
      uHasErase: { value: p.erase ? 1 : 0 },
      uErasePreview: { value: p.erasePreview ? 1 : 0 },
      // 法线（bump）：由底图亮度差当场生成，选了法线贴图时改采贴图；扰动光泽 / 摩尔纹 / 刻纹的走势。
      // 采样器没贴图时绑底图占位——uBumpMode = 0 时片元不采样它。
      uNormalMap: { value: p.normal ?? p.map },
      uBumpMode: { value: bump.mode === "normal" ? 1 : 0 },
      uBumpFlipY: { value: bump.flipY ? 1 : 0 },
      uBumpSource: { value: bump.source },
      uBumpStrength: { value: bump.strength },
      uBumpDetail: { value: bump.detail },
      uBumpFlow: { value: bump.flow },
      uBumpLight: { value: bump.light },
      uBumpLightAngle: { value: bump.lightAngle },
      uBumpLightColor: { value: new Color(bump.lightColor) },
      uBumpLightAlpha: { value: alphaOf(bump.lightColor) },
      uBumpInvert: { value: bump.invert ? 1 : 0 },
      // 效果栈的定长数组（uMoire* / uGradient* / uLattice* / uGloss* / uMaskPreset*）整批绑入。
      ...toEffectUniformObjects(fx),
      // 光带颜色不走 packUniforms（它不是标量 / vec2）：与调色板同理，在这里直接解析成
      // Color。缺省槽位填老的暖白常量（见 effects/gloss-color.ts）。
      uGlossColor: { value: glossColorUniforms(p.effects) },
      uGlossAlpha: { value: glossAlphaUniforms(p.effects) },
    },
    vertexShader: GLSL_VERTEX,
    fragmentShader: BASE_FRAGMENT,
    transparent: true,
    side: DoubleSide,
  })
}
