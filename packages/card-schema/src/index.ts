/**
 * @prismwright/schema 的公共入口：本包对外 API 的唯一聚合点。
 *
 * 架构位置：数据层（纯 TypeScript + zod，零 UI / IO 依赖）的门面。
 * 消费方应只从 `.`（即本文件）导入，不直接深入 `types.ts` / `schema.ts` 等内部模块。
 *
 * 对外暴露七组符号：
 * - 类型：`Rarity` / `BlendMode` / `MaskMode` / `MaskArrangement` / `PatternMode` / `ColorStop` / `Layer` /
 *   `CardFace` / `Card` / `Pack`，以及效果栈的 `EffectRole` / `EffectKind` / `EffectBase` / `Effect` /
 *   `EffectParams` / `GradientParams` / `MoireParams` / `GlossParams` / `PaletteParams` /
 *   `MaskPresetParams` / `MaskImageParams` / `ImageParams`，以及文字图层的 `LayerKind` / `TextAlign` /
 *   `TextStrokeParams` / `TextShadowParams` / `TextParams`；
 * - 校验：`HEX_COLOR` 及二十四个 zod schema（含效果栈与文字图层）；
 * - 卡面形状缺省：`DEFAULT_CARD_ASPECT` / `DEFAULT_CORNER_RADIUS`；
 * - 色标工具：`evenlySpacedStops`、默认调色板 `DEFAULT_PALETTE` / `DEFAULT_STOPS` 与
 *   渐变相位默认 `DEFAULT_GRADIENT_PHASE`（渲染器侧共用，见 `@prismwright/renderer` 的 `palette.ts`）；
 * - 默认值工厂：`newId` / `createLayer` / `createTextLayer` / `createCard` / `createCardFace` / `createEmptyPack`；
 * - 迁移：`CURRENT_SCHEMA_VERSION` / `migrate` / `parsePack`；
 * - 图层树工具：`flattenLayers` / `findLayerById` / `detachLayer` 等（见 `tree.ts`）；
 * - 效果查询：`resolveImageMask` / `resolveEraseMask` / `resolveImage` / `resolveGradient` / `resolvePalette`（见 `effects.ts`）。
 * - 资源收集：`collectFaceAssets` / `collectCardAssets` / `collectPackAssets` / `collectCoverAssets`（见 `assets.ts`，桌面端与小程序共用同一份判定）。
 */
export type {
  Rarity,
  BlendMode,
  MaskMode,
  FrontFit,
  CardFinish,
  PackArtBlend,
  PackArtFit,
  PackArtStyle,
  MaskArrangement,
  PatternMode,
  ColorStop,
  EffectRole,
  EffectKind,
  EffectBase,
  Effect,
  EffectParams,
  GradientParams,
  MoireParams,
  GlossParams,
  PaletteParams,
  HoloGridParams,
  MaskPresetParams,
  MaskImageParams,
  MaskEraseParams,
  ImageParams,
  LayerKind,
  TextAlign,
  TextStrokeParams,
  TextShadowParams,
  TextParams,
  Layer,
  CardFace,
  Card,
  AlbumLayout,
  Pack,
} from "./types.js"
export {
  HEX_COLOR,
  alphaOf,
  withAlpha,
  RaritySchema,
  BlendModeSchema,
  MaskModeSchema,
  FrontFitSchema,
  CardFinishSchema,
  PackArtBlendSchema,
  PackArtFitSchema,
  PackArtStyleSchema,
  DEFAULT_PACK_ART_STYLE,
  MaskArrangementSchema,
  PatternModeSchema,
  ColorStopSchema,
  LayerSchema,
  CardFaceSchema,
  CardSchema,
  AlbumLayoutSchema,
  ALBUM_PAGE_SIZE,
  PackSchema,
  MAX_NEST_DEPTH,
  DEFAULT_CARD_ASPECT,
  DEFAULT_CORNER_RADIUS,
  DEFAULT_BUMP_LIGHT_ANGLE,
  DEFAULT_BUMP_LIGHT_COLOR,
  evenlySpacedStops,
  DEFAULT_PALETTE,
  DEFAULT_STOPS,
  DEFAULT_GRADIENT_PHASE,
  EffectSchema,
  GradientParamsSchema,
  MoireParamsSchema,
  GlossParamsSchema,
  PaletteParamsSchema,
  HoloGridParamsSchema,
  MaskPresetParamsSchema,
  MaskImageParamsSchema,
  MaskEraseParamsSchema,
  ImageParamsSchema,
  LayerKindSchema,
  TextAlignSchema,
  TextStrokeParamsSchema,
  TextShadowParamsSchema,
  TextParamsSchema,
} from "./schema.js"
export {
  newId,
  createLayer,
  createTextLayer,
  createCard,
  createCardFace,
  createEmptyPack,
} from "./defaults.js"
export { CURRENT_SCHEMA_VERSION, migrate, parsePack } from "./migrate.js"
export type { FlatLayer } from "./tree.js"
export {
  flattenLayers,
  isLayerVisible,
  findLayerById,
  findLayerLocation,
  detachLayer,
  subtreeHeight,
  ancestorChain,
  exceedsNestDepth,
} from "./tree.js"
export {
  collectFaceAssets,
  collectCardAssets,
  collectPackAssets,
  collectCoverAssets,
} from "./assets.js"
export {
  resolveImageMask,
  resolveEraseMask,
  resolveImage,
  resolveGradient,
  resolvePalette,
} from "./effects.js"
