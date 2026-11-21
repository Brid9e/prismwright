/**
 * `@cardbara/renderer/v1` 公共出口。
 *
 * 版本分层：本文件即 v1 的全部公共面；裸入口 `@cardbara/renderer` 有意不再导出，
 * 将来 v2 在 `src/v2/` 平级并列，由子路径 `/v2` 暴露。
 *
 * 只导出「调用方需要」的符号：视图工厂与类型。内部实现（材质、着色器、缓存）不外泄，
 * 以便未来重构内部结构而不破坏下游。
 */
export { createCardView } from "./card-view"
export { createRarityFx, rarityFxDuration, RARITY_FX_PRESETS } from "./rarity-fx"
export type { RarityFx, RarityFxHost, RarityFxKey } from "./rarity-fx"
export type { CardView, CardViewOptions, ResolveAsset } from "./types"
export type { FlipState } from "./types"
// 离屏逐帧渲染：确定正视角 + 透明通道，供后台生成卡面资产（PNG / WebM 帧）。
export { createCardFrameRenderer } from "./frame-renderer"
export type { CardFrameRenderer, CardFrameRendererOptions } from "./frame-renderer"
// 导出用的无缝摆动曲线与取景常量：桌面端编排导出时按下标取姿态、按周期算帧数。
export { exportSway, EXPORT_SWAY_PERIOD } from "./tilt"
export type { Tilt } from "./tilt"
export { EXPORT_CAMERA_MARGIN } from "./frame-renderer"
// 缩放的取值范围由渲染器持有，UI 拿它当滑杆的 min/max——单一来源，免得两处漂移。
export { MAX_ZOOM, MIN_ZOOM } from "./zoom"
// 内置蒙版预设：UI 用 MASK_PRESETS 填下拉、选中即用 materializePreset 物化整组参数。
export { MASK_PRESETS, materializePreset } from "./mask-presets/registry"
export type { MaskPreset } from "./mask-presets/registry"
// 效果注册表：UI 据此生成面板、store 据此取默认值与槽位上限——效果栈的单一元数据来源。
export {
  EFFECT_REGISTRY,
  EFFECT_KINDS,
  MOIRE_MAX,
  GRADIENT_MAX,
  GLOSS_MAX,
  MASK_PRESET_MAX,
  PALETTE_MAX,
} from "./effects/registry"
export type {
  EffectDef,
  EffectScope,
  FieldDescriptor,
  FieldOption,
  FieldType,
  PackedUniforms,
} from "./effects/registry"
// 效果列表 → 分档定长 uniform：材质层据此把目标的 effects 灌进着色器数组 uniform。
export { toEffectUniforms } from "./effects/uniforms"
export type { EffectUniformArrays } from "./effects/uniforms"
export type { CardFace, Layer } from "@cardbara/schema"
// 卡面几何与图片摆放：图层「合并成一张图」要在离屏画布上复现同一套换算，故这两个常量/函数
// 必须是渲染器自己的那一份，不能在桌面端另抄一遍（两份公式漂移 = 合并前后观感不一致）。
export { CARD_ASPECT, clampCornerRadius } from "./card-scene"
// 底图 UV 变换：桌面端吸管要在 CPU 上取原图像素，必须与片元走同一套「卡面 uv → 底图 uv」。
export { fitSpan, frontUvTransform, sampleFrontUv } from "./front-uv"
export type { FrontUvOptions, FrontUvTransform } from "./front-uv"
// 客户端坐标 → NDC：拾色 / 画笔的前半步（与画布取点同一套换算）。
export { clientToNdc } from "./pick"
export type { Ndc, PickRect } from "./pick"
export { clampPixelRatio, createDomHost } from "./host"
export type { CanvasLike, CardViewHost, HostPointerHandlers } from "./host"
export { textureFromImage } from "./texture"
// 文字栅格化：桌面端发布时要把文字烤成 PNG 资源（小程序端不依赖字体），需要与编辑器
// 预览同一份「怎么画」——尺寸、行序（PNG 口径，未翻转）都由渲染器这一份实现决定。
export {
  renderTextRaster,
  textureKeyOf,
  textTextureSize,
  TEXT_TEXTURE_HEIGHT,
  TEXT_TEXTURE_WIDTH,
} from "./text-texture"
export type { TextRaster } from "./text-texture"
