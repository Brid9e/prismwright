/**
 * 组装全息图层 ShaderMaterial（含混合模式与祖先蒙版软裁切）。
 */
import { Color, DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4, type Texture } from "three"
import {
  alphaOf,
  MAX_NEST_DEPTH,
  resolveImageMask,
  resolvePalette,
  type CardFace,
  type Effect,
  type GlossParams,
  type ImageParams,
  type Layer,
  type MaskImageParams,
} from "@cardbara/schema"
import { fitSpan, frontUvTransform } from "../front-uv"
import { maskUvParams } from "../mask-uv"
import { textureAspect } from "../texture-aspect"
import { GLSL_VERTEX } from "../shaders/common"
import { LAYER_FRAGMENT } from "../shaders/layer"
import { paletteUniforms } from "../palette"
import { maskIsActive, patternModeCode, toUniforms } from "../mapping"
import { GLOSS_MAX, MOIRE_MAX } from "../effects/registry"
import { glossAlphaUniforms, glossColorUniforms } from "../effects/gloss-color"
import { toEffectUniforms } from "../effects/uniforms"
import { toEffectUniformObjects } from "../effects/uniform-binding"
import { resolveBlending } from "../three-bridge"
import { resolveLayerBump } from "../bump"

/** 一个祖先的蒙版绑定：已解析的蒙版参数 + 蒙版纹理（外加擦除图，擦除对子树继承）。 */
export interface AncestorMask {
  /** 已解析的祖先图蒙版参数；祖先无生效 imageMask 时为 `null`。 */
  imageMask: MaskImageParams | null
  /** 祖先的蒙版纹理；祖先无蒙版时为 `null`。 */
  mask: Texture | null
  /** 祖先自己的擦除图（祖先挂了 maskErase 才有）；擦除向下继承，子树一并被擦。 */
  erase?: Texture | null
  /** 祖先作为文字蒙版时的字形纹理；否则为 `null`（或省略）。 */
  textMask?: Texture | null
  /**
   * 祖先上「作为蒙版」的启用光泽条目（最多 `GLOSS_MAX` 条，保持列表序）。
   *
   * 光带场在这里不是纹理：子图层用同一套 `glossMaskWeight` 参数化重算覆盖率（随倾斜扫动，
   * 烘成静态纹理就扫不起来了）。见 `effects/gloss-mask.ts`。
   */
  glossMasks?: readonly GlossParams[]
}

/** 构造图层材质的参数。 */
export interface LayerMaterialParams {
  layer: Layer
  /** 本层图蒙版纹理；本层 imageMask 的 path 为空时为 `null`。 */
  mask: Texture | null
  /** 祖先链（最外层在前、直接父层在末）；顶层图层为空数组。 */
  ancestors: readonly AncestorMask[]
  /** 蒙版 sampler 的占位纹理：填满未使用的祖先槽位，避免 sampler 为 null 触发告警。 */
  maskPlaceholder: Texture
  /**
   * 卡面原图纹理；没有卡面图时为 `null`。颜色源蒙版（本层与祖先）按它采样，
   * 与卡面材质看到的原图是同一张。
   */
  front?: Texture | null
  /**
   * 蒙版擦除图（挂在卡面上、整卡一张）；没有时为 `null`。
   *
   * 不从 `effects` 里解析：擦除条目住在**卡面**的效果列表里，而本参数是本层的列表。
   * 由 card-view 统一解析后传给每个图层材质，保证整卡用的是同一张。
   */
  erase?: Texture | null
  /**
   * 本层**自己**的擦除图（maskErase 挂在 `p.effects` 里）；没有时为 `null`。
   *
   * 与 `erase`（整卡那张）是两张独立的图，最终相乘：本层 × 祖先 × 卡面。纹理由调用方
   * 异步解析后传入——材质是同步构造的，不能在这里读盘。
   */
  layerErase?: Texture | null
  /**
   * 是否把被**本层**擦掉的区域铺一层半透明底色（绘画辅助，默认关）。
   *
   * 只在交互视图的绘画会话里打开；离屏导出不传。只作用于本层自己的擦除图——整卡的底色
   * 由卡面材质负责。
   */
  erasePreview?: boolean
  /** 本层效果列表。 */
  effects: readonly Effect[]
  /**
   * 本层图片效果（若有）。纹理缺失 / path 为空时为 `null`——材质仍绑定占位纹理并置
   * `uHasImage = 0`，图层其余部分照常渲染。
   */
  image?: { texture: Texture; params: ImageParams } | null
  /**
   * 本层自己的法线贴图纹理（image 效果的 `normalPath` 载入结果）；未选 / 未载入时为 `null`。
   * 与 `image.texture` 相互独立：法线贴图能单独生效。
   */
  normal?: Texture | null
  /**
   * 本层所属卡面的法线贴图纹理（`frontNormalPath` 的载入结果）；继承卡面法线时用。
   * 未选 / 未载入时为 `null`。
   */
  faceNormal?: Texture | null
  /**
   * 本层所属的卡面数据（正面 / 背面）。只用于**法线继承**：本层没自己的图片法线时沿用
   * {@link CardFace.frontBumpStrength} 那一组，并按这里的底图变换采样卡面原图（见 bump.ts）。
   * 不传 = 不继承。
   */
  face?: CardFace | null
  /**
   * 本层文字纹理；不是文字层、内容为空或纹理创建失败时为 `null`（着色器里 `uHasText = 0`）。
   * 纹理由调用方用 `TextTextureCache` 准备好后同步传入——材质是同步构造的。
   */
  text?: Texture | null
  /**
   * moire 继承源：卡面的效果列表（透传进图层材质，用于折射全息相位）。
   *
   * 本层自带 moire 时以本层为准，继承源仅在**本层无 moire** 时生效（见 `toEffectUniforms`）。
   */
  inheritedMoire: readonly Effect[]
  /**
   * 相位时间（秒）。实时预览不传（恒 0，观感逐像素不变）；离屏导出按帧时间传入，
   * 全息图案便随时间自己流动（见 `shaders/common.ts` 的 holoColor）。
   */
  time?: number
  aspect: number
  cornerRadius: number
}

/**
 * 本层**自有**的启用摩尔纹条数（不含从卡面继承的那份）。
 *
 * 内容浮雕（刻纹 / 摩尔纹压在图片 / 文字上的明暗）只认自有条目：`toEffectUniforms` 在本层没有
 * moire 时会把 uMoire* 整档换成卡面的，拿那份当高度场会把整卡花纹压到每一张图片图层上。
 */
function ownMoireCount(effects: readonly Effect[]): number {
  let n = 0
  for (const e of effects) if (e.kind === "moire" && e.enabled && n < MOIRE_MAX) n++
  return n
}

/**
 * 创建全息图层材质。
 *
 * @param p - 见 {@link LayerMaterialParams}。
 * @returns 配置好 uniform 与混合的 `ShaderMaterial`；调用方负责 `dispose()`。
 */
export function createLayerMaterial(p: LayerMaterialParams): ShaderMaterial {
  const u = toUniforms(p.layer)
  // 色标与 uHasHolo 同源：都取本层效果列表（`toUniforms(p.layer)` 也读 `layer.effects`），
  // 避免二者取自不同列表时「门开着却采样到默认调色板」。
  const palette = paletteUniforms(resolvePalette(p.layer.effects)?.colors ?? [])
  const blend = resolveBlending(u.blend)

  // 本层效果 + 卡面 moire 继承一并打包成定长数组（键即着色器 uniform 名）。
  const fx = toEffectUniforms(p.effects, p.inheritedMoire)
  // 本层图蒙版从效果列表解析（不再是图层专属字段）。
  const imageMask = resolveImageMask(p.effects)
  // 卡面原图：颜色源蒙版采样它。没图时颜色源整体关掉（见 maskIsActive）。
  const frontTexture = p.front ?? null
  const frontValid = frontTexture !== null
  // 颜色源蒙版采样的是卡面原图，其「蒙版图」比例就是原图比例；图片源才看蒙版纹理。
  const maskImageAspect = (m: MaskImageParams | null, tex: Texture | null) =>
    textureAspect(m?.source === "color" ? frontTexture : tex, p.aspect)
  // 本层图蒙版的位移 / 缩放 / 旋转 / 填充方式（缺省即恒等：中心在卡心、按覆盖铺满卡面、不旋转）。
  // 填充方式要蒙版图的自然比例；本层没有蒙版纹理时按卡面比例兜底。
  const maskUv = maskUvParams(p.aspect, imageMask, maskImageAspect(imageMask, p.mask))

  // 图片效果：纹理与变换参数。尺寸看纹理的自然宽高比；无尺寸信息时按方图兜底。
  // 填充方式与卡面底图、图蒙版共用 fitSpan（缺省 contain = 加 fit 字段之前的画面）。
  const imageTexture = p.image?.texture ?? null
  const imageParams = p.image?.params ?? null
  const texWidth = Number(imageTexture?.image?.width)
  const texHeight = Number(imageTexture?.image?.height)
  const imageAspect = texWidth > 0 && texHeight > 0 ? texWidth / texHeight : 1
  const [fitWidth, fitHeight] = fitSpan(imageAspect, p.aspect, imageParams?.fit ?? "contain")
  const imageScale = imageParams?.scale ?? 1

  // 法线（bump）：本层图片自带就用自己的（来源 1），否则继承卡面底图的（来源 2）。
  // 卡面那份要按底图的填充 / 偏移 / 缩放 / 旋转换算采样点，故这里算一份与卡面材质同源的变换。
  const bump = resolveLayerBump({
    image: imageParams,
    hasImage: imageTexture !== null,
    hasNormal: p.normal !== null && p.normal !== undefined,
    face: p.face ?? null,
    hasFaceImage: frontTexture !== null,
    hasFaceNormal: p.faceNormal !== null && p.faceNormal !== undefined,
  })
  // 法线采样器只有一根：在构造期就按解析结果选定纹理（本层 / 卡面），片元按 uBumpSource 只换算
  // 采样点、不再选纹理——图层片元的纹理单元只剩 15/16（上限 16）。
  const bumpNormalTexture =
    bump.mode === "normal"
      ? ((bump.source === 2 ? p.faceNormal : p.normal) ?? null)
      : null
  const faceUv = frontUvTransform({
    imageAspect: textureAspect(frontTexture, p.aspect),
    cardAspect: p.aspect,
    fit: p.face?.frontFit ?? "cover",
    offsetX: p.face?.frontOffsetX ?? 0,
    offsetY: p.face?.frontOffsetY ?? 0,
    scale: p.face?.frontScale ?? 1,
    rotation: p.face?.frontRotation ?? 0,
  })

  // 祖先蒙版打包成定长（MAX_NEST_DEPTH）并行数组：GLSL 数组长度须在编译期固定，故未使用的
  // 槽位也要填满——sampler 填占位纹理、hasMask 置 0，着色器里权重恒为 1（等价于「无此祖先」）。
  // 未使用槽位的 maskMode 默认 1、edge1 默认 1：hasMask=0 时二者均不参与计算，取值只为让
  // 占位槽位在定长数组里确定下来。
  const uAncestorMask: Texture[] = []
  const uAncestorHasMask: number[] = []
  // 0 = 图蒙版（亮度 / 颜色 + 阈值），1 = 文字蒙版（字形 alpha 直接相乘）。文字蒙版复用
  // `uAncestorMask` 的采样槽位：片元只有 16 个纹理单元（ANGLE/D3D11 下限），再单开一组
  // 祖先文字蒙版采样器就会超限、整段片元编译失败。二者不会同时出现（文字层没有效果栈，
  // 挂不上图蒙版）；真同时给出时文字蒙版优先。
  const uAncestorMaskKind: number[] = []
  const uAncestorMaskMode: number[] = []
  const uAncestorInvert: number[] = []
  const uAncestorEdge0: number[] = []
  const uAncestorEdge1: number[] = []
  const uAncestorCenter: Vector2[] = []
  const uAncestorSize: Vector2[] = []
  const uAncestorRotation: number[] = []
  const uAncestorSource: number[] = []
  const uAncestorColor: Color[] = []
  // 祖先的擦除图：未使用的槽位填占位纹理、hasErase 置 0（着色器里权重恒为 1）。
  const uAncestorEraseMap: Texture[] = []
  const uAncestorHasErase: number[] = []
  // 祖先的「作为蒙版」光泽：按「槽位 × 条序」展平成并行数组（下标 = 槽位 × GLOSS_MAX + 条序）。
  // 未使用的条目填 0——对应槽位的 count 为 0 时着色器整段跳过，取值只为让定长数组确定下来。
  const uAncestorGlossCount: number[] = []
  const uAncestorGlossMode: number[] = []
  const uAncestorGlossBands: number[] = []
  const uAncestorGlossSpacing: number[] = []
  const uAncestorGlossWidth: number[] = []
  const uAncestorGlossAngle: number[] = []
  const uAncestorGlossTwist: number[] = []
  const uAncestorGlossTwistSeed: number[] = []
  const uAncestorGlossOffsetX: number[] = []
  const uAncestorGlossOffsetY: number[] = []
  const uAncestorGlossSoftness: number[] = []
  for (let i = 0; i < MAX_NEST_DEPTH; i++) {
    const a = p.ancestors[i]
    const imageMask = a?.imageMask ?? null
    const textMask = a?.textMask ?? null
    const hasMask = maskIsActive(imageMask, { frontValid })
    const maskUv = maskUvParams(p.aspect, imageMask, maskImageAspect(imageMask, a?.mask ?? null))
    uAncestorMask.push(textMask ?? (hasMask ? (a?.mask ?? p.maskPlaceholder) : p.maskPlaceholder))
    uAncestorHasMask.push(textMask !== null || hasMask ? 1 : 0)
    uAncestorMaskKind.push(textMask !== null ? 1 : 0)
    uAncestorMaskMode.push(imageMask?.mode === "fill" ? 0 : 1)
    uAncestorInvert.push(imageMask?.invert ? 1 : 0)
    uAncestorEdge0.push(imageMask?.edge0 ?? 0)
    uAncestorEdge1.push(imageMask?.edge1 ?? 1)
    // 祖先蒙版的位移 / 缩放 / 旋转：未使用槽位取恒等（hasMask=0 时不参与计算）。
    uAncestorCenter.push(new Vector2(maskUv.centerX, maskUv.centerY))
    uAncestorSize.push(new Vector2(maskUv.sizeX, maskUv.sizeY))
    uAncestorRotation.push(maskUv.rotation)
    // 颜色源：来源开关与拾取色（未使用槽位取图片源 + 默认灰，hasMask=0 时不参与计算）。
    uAncestorSource.push(imageMask?.source === "color" ? 1 : 0)
    uAncestorColor.push(new Color(imageMask?.color ?? "#808080"))
    uAncestorEraseMap.push(a?.erase ?? p.maskPlaceholder)
    uAncestorHasErase.push(a?.erase ? 1 : 0)
    const glossMasks = a?.glossMasks ?? []
    uAncestorGlossCount.push(Math.min(glossMasks.length, GLOSS_MAX))
    for (let j = 0; j < GLOSS_MAX; j++) {
      const g = glossMasks[j]
      uAncestorGlossMode.push(g ? patternModeCode(g.mode) : 0)
      uAncestorGlossBands.push(g ? g.count : 0)
      uAncestorGlossSpacing.push(g ? g.spacing : 0)
      uAncestorGlossWidth.push(g ? g.width : 0)
      uAncestorGlossAngle.push(g ? g.angle : 0)
      uAncestorGlossTwist.push(g ? g.twist : 0)
      uAncestorGlossTwistSeed.push(g ? g.twistSeed : 0)
      uAncestorGlossOffsetX.push(g ? g.offsetX : 0)
      uAncestorGlossOffsetY.push(g ? g.offsetY : 0)
      uAncestorGlossSoftness.push(g ? g.softness : 0)
    }
  }

  return new ShaderMaterial({
    uniforms: {
      uMask: { value: p.mask },
      // 颜色源：蒙版改为采样卡面原图（与卡面材质同一张），按颜色距离取权重。
      // 没图时 sampler 绑占位纹理、hasMask 归零（见下面的 maskIsActive）。
      uFrontMap: { value: frontTexture ?? p.maskPlaceholder },
      // 蒙版擦除：整卡一张。没有时补占位纹理（uHasErase=0 时片元不采样）。
      uEraseMap: { value: p.erase ?? p.maskPlaceholder },
      uHasErase: { value: p.erase ? 1 : 0 },
      // 本层自己的擦除图：与整卡那张相乘（见 shaders/layer.ts）。
      uLayerEraseMap: { value: p.layerErase ?? p.maskPlaceholder },
      uHasLayerErase: { value: p.layerErase ? 1 : 0 },
      uErasePreview: { value: p.erasePreview ? 1 : 0 },
      uMaskSource: { value: imageMask?.source === "color" ? 1 : 0 },
      uMaskColor: { value: new Color(imageMask?.color ?? "#808080") },
      uCameraPosition: { value: new Vector3() },
      uColors: { value: palette.colors.map((c) => new Color(c)) },
      uColorAlphas: { value: palette.alphas },
      uStops: { value: palette.positions },
      uAspect: { value: p.aspect },
      uCornerRadius: { value: p.cornerRadius },
      uHoloMix: { value: u.uHoloMix },
      uHoloAlpha: { value: u.uHoloAlpha },
      uOpacity: { value: u.uOpacity },
      uHasHolo: { value: u.hasHolo ? 1 : 0 },
      // 内容浮雕只认本层自有的摩尔纹：`fx` 里的 uMoire* 在「本层没有 moire」时填的是继承
      // 自卡面的那份（见 toEffectUniforms），拿它当浮雕高度场会把整卡花纹压到图片 / 文字上。
      uOwnMoireCount: { value: ownMoireCount(p.effects) },
      uPhaseSpeed: { value: u.uPhaseSpeed },
      uTiltGain: { value: u.uTiltGain },
      uTime: { value: p.time ?? 0 },
      uDistortionStrength: { value: u.uDistortionStrength },
      uNoiseStrength: { value: u.uNoiseStrength },
      uTransition: { value: u.uTransition },
      uOffset: { value: new Vector2(u.uOffset[0], u.uOffset[1]) },
      uHasMask: { value: maskIsActive(imageMask, { frontValid }) ? 1 : 0 },
      uMaskMode: { value: imageMask?.mode === "fill" ? 0 : 1 },
      uMaskInvert: { value: imageMask?.invert ? 1 : 0 },
      uLineEdge0: { value: imageMask?.edge0 ?? 0 },
      uLineEdge1: { value: imageMask?.edge1 ?? 1 },
      // 本层图蒙版的位移 / 缩放 / 旋转（见 mask-uv.ts）。
      uMaskCenter: { value: new Vector2(maskUv.centerX, maskUv.centerY) },
      uMaskSize: { value: new Vector2(maskUv.sizeX, maskUv.sizeY) },
      uMaskRotation: { value: maskUv.rotation },
      // 效果栈的定长数组（含 moire 继承结果）整批绑入：相位组（摩尔纹 / 渐变 / 刻纹）、
      // 颜色组（光泽）、alpha 组（程序化蒙版）。着色器按各档计数逐条循环，count 为 0 即整档跳过。
      ...toEffectUniformObjects(fx),
      // 光带颜色不走 packUniforms（不是标量 / vec2）：缺省槽位填老的暖白常量。
      uGlossColor: { value: glossColorUniforms(p.effects) },
      uGlossAlpha: { value: glossAlphaUniforms(p.effects) },
      uAncestorMask: { value: uAncestorMask },
      uAncestorHasMask: { value: uAncestorHasMask },
      uAncestorMaskKind: { value: uAncestorMaskKind },
      uAncestorMaskMode: { value: uAncestorMaskMode },
      uAncestorInvert: { value: uAncestorInvert },
      uAncestorEdge0: { value: uAncestorEdge0 },
      uAncestorEdge1: { value: uAncestorEdge1 },
      uAncestorCenter: { value: uAncestorCenter },
      uAncestorSize: { value: uAncestorSize },
      uAncestorRotation: { value: uAncestorRotation },
      uAncestorSource: { value: uAncestorSource },
      uAncestorColor: { value: uAncestorColor },
      uAncestorEraseMap: { value: uAncestorEraseMap },
      uAncestorHasErase: { value: uAncestorHasErase },
      // 祖先的「作为蒙版」光泽（覆盖率 → 向下裁切子树，见 shaders/layer.ts）。
      uAncestorGlossCount: { value: uAncestorGlossCount },
      uAncestorGlossMode: { value: uAncestorGlossMode },
      uAncestorGlossBands: { value: uAncestorGlossBands },
      uAncestorGlossSpacing: { value: uAncestorGlossSpacing },
      uAncestorGlossWidth: { value: uAncestorGlossWidth },
      uAncestorGlossAngle: { value: uAncestorGlossAngle },
      uAncestorGlossTwist: { value: uAncestorGlossTwist },
      uAncestorGlossTwistSeed: { value: uAncestorGlossTwistSeed },
      uAncestorGlossOffsetX: { value: uAncestorGlossOffsetX },
      uAncestorGlossOffsetY: { value: uAncestorGlossOffsetY },
      uAncestorGlossSoftness: { value: uAncestorGlossSoftness },
      // 本层文字：无纹理时绑占位纹理、uHasText = 0（着色器整段跳过）。
      uTextMap: { value: p.text ?? p.maskPlaceholder },
      uHasText: { value: p.text ? 1 : 0 },
      // 作为蒙版：只读图层自身字段，不另加参数。
      uTextAsMask: { value: p.layer.kind === "text" && p.layer.text?.asMask ? 1 : 0 },
      // 图片效果：无图时 sampler 绑占位纹理、uHasImage = 0（着色器整段跳过）。
      uImage: { value: imageTexture ?? p.maskPlaceholder },
      uHasImage: { value: imageTexture && imageParams ? 1 : 0 },
      uImageCenter: { value: new Vector2(imageParams?.x ?? 0, imageParams?.y ?? 0) },
      uImageSize: {
        value: new Vector2(fitWidth * imageScale, fitHeight * imageScale),
      },
      // 角度 → 弧度：正值 = 屏幕顺时针（符号约定见
      // docs/superpowers/specs/2026-10-27-image-layer-design.md §4.3）。
      uImageRotation: { value: ((imageParams?.rotation ?? 0) * Math.PI) / 180 },
      // 法线（bump）：来源 + 四项参数。卡面那份（来源 2）用 uFaceMapMatrix / uFaceMapOffset
      // 把卡面 UV 换算成卡面底图 UV，与卡面片元的 uMapMatrix / uMapOffset 同一套数学。
      uNormalMap: { value: bumpNormalTexture ?? p.maskPlaceholder },
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
      uFaceMapMatrix: { value: new Vector4(...faceUv.matrix) },
      uFaceMapOffset: { value: new Vector2(faceUv.offsetU, faceUv.offsetV) },
    },
    vertexShader: GLSL_VERTEX,
    fragmentShader: LAYER_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    blending: blend.blending,
    ...(blend.blendSrc !== undefined ? { blendSrc: blend.blendSrc } : {}),
    ...(blend.blendDst !== undefined ? { blendDst: blend.blendDst } : {}),
  })
}
