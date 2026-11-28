/**
 * 效果注册表：一种效果的静态描述（角色、槽位、默认参数、i18n 键、UI 字段、uniform 打包）。
 *
 * 架构位置：渲染层「效果栈」的核心元数据。它同时被三处消费——
 * UI（自动生成面板）、渲染层（打包 uniform）、store（新建时的默认参数与槽位上限）。
 * 扩充方式：加一种效果 = schema 加一个 params + 本文件加一条注册（含 {@link EffectParamsOf} 一支、
 * {@link EFFECT_KINDS} 补一项）+ 一条 GLSL 落点 + i18n 补键。
 *
 * 做法沿用既有的 `mask-presets/registry.ts`（`MASK_PRESETS`）：同一份静态描述，
 * 由注册表当单一来源，消费方不再各写一遍默认值与字段。
 */
import { DEFAULT_STOPS, EffectSchema } from "@prismwright/schema"
import type {
  EffectKind,
  EffectRole,
  GradientParams,
  MaskPresetParams,
  MaskImageParams,
  MaskEraseParams,
  ImageParams,
  MoireParams,
  GlossParams,
  HoloGridParams,
} from "@prismwright/schema"
import { patternModeCode } from "../mapping"

/**
 * 每种效果在单个目标上的槽位上限。
 *
 * 多数与着色器的定长数组长度一一对应；「资源 + 门控」型效果（`imageMask`）不进任何
 * 定长数组，上限恒为 1。
 */
export const MOIRE_MAX = 2
/** 渐变每层一条：相位全局项是图层级的单份设置，多条会为「听谁的」制造歧义（见设计方案 §3）。 */
export const GRADIENT_MAX = 1
export const GLOSS_MAX = 2
export const MASK_PRESET_MAX = 2
/** 图蒙版（自定义蒙版）单目标上限：固定 1 张（一个目标最多一张图蒙版）。 */
export const IMAGE_MASK_MAX = 1
/** 蒙版擦除单目标上限：固定 1 张（一张画布就是一处擦除，要改就再画）。 */
export const MASK_ERASE_MAX = 1
/** 独立网格单目标上限：固定 1（一个目标一份网格）。 */
export const HOLO_GRID_MAX = 1
/** 图片效果单目标上限：一个图层最多一张图片（要多张就多建图层）。 */
export const IMAGE_MAX = 1

/**
 * 可编辑字段的控件类型。UI 据此生成对应 PropertyRow。
 *
 * `color` = 单色选择（色块 + 吸管）；与 `colorStops`（色标表）不是一回事。
 * `paint` = 绘画入口（启动笔刷 / 清除），只用于蒙版擦除的 `path`——它不是「选文件」，
 * 而是在预览上画一张图，故不能复用 `image`。
 */
export type FieldType =
  | "slider"
  | "select"
  | "switch"
  | "preset"
  | "image"
  | "colorStops"
  | "color"
  | "paint"

/**
 * 效果可挂载的目标范围。
 *
 * `gradient` / `holoGrid` 只对图层有意义（卡面片元不跑 `holoPhase` / `holoColor`，两者
 * 在卡面上空转）；`moire` / `gloss` / `maskPreset` / `imageMask` 卡面确实会渲染。UI 据此过滤
 * 「＋ 添加效果」菜单（只在新增加时过滤，已存在的条目仍照常渲染）。
 */
export type EffectScope = "both" | "layer" | "face"

/** `select` / `preset` 的一个候选项。 */
export interface FieldOption {
  readonly value: string
  readonly labelKey: string
}

/** 一个可编辑字段的描述——UI 面板据此自动生成控件，不再逐效果手写 JSX。 */
export interface FieldDescriptor {
  readonly key: string
  /**
   * i18n 键，**相对 `effect` 命名空间**（如 `gloss.intensity`）——消费方 `useTranslation("effect")`
   * 后直接 `t(labelKey)`。与 `MASK_PRESETS` 的写法一致，故不重复带命名空间前缀。
   */
  readonly labelKey: string
  readonly type: FieldType
  readonly min?: number
  readonly max?: number
  readonly step?: number
  /**
   * slider 显示的小数位。**整数型参数（step ≥ 1）须显式设 0**——`Slider` 缺省是 3 位，不写会
   * 让 `count: 14` 这类整数值显示成 `14.000`（见组件侧 `precision={field.precision}`）。
   */
  readonly precision?: number
  readonly options?: readonly FieldOption[]
  /** 条件显示：参数满足才显示该字段（如渐变的「角度」只在平行模式显示）。 */
  readonly visibleWhen?: (params: Record<string, unknown>) => boolean
  /**
   * 字段级的可挂载范围（**默认两端都显示**）。与效果级的 {@link EffectDef.scope} 是两层：
   * 效果级管「这个效果能不能挂到该目标」，字段级管「挂上来后这个参数显不显示」。
   *
   * 用例：`moire.faceStrength`（卡面浮雕）只作用于卡面片元，挂到图层上是**死参数**，
   * 故标 `face` 从图层面板隐去——否则用户拖一个对画面毫无作用的滑块。
   */
  readonly scope?: EffectScope
}

/** 打包成扁平 uniform 值的返回类型。 */
export type PackedUniforms = Record<string, number | [number, number]>

/** 一个效果种类的静态描述。 */
export interface EffectDef<K extends EffectKind = EffectKind> {
  readonly kind: K
  readonly role: EffectRole
  /** 效果可挂载的目标范围：`both` 两种都行，`layer` / `face` 各限一端（见设计方案 §5）。 */
  readonly scope: EffectScope
  /** 单目标槽位上限。 */
  readonly maxPerTarget: number
  /** 新建该效果时的初始参数（每次返回**新对象**，不共享引用）。 */
  defaultParams(): EffectParamsOf<K>
  /** i18n 键，相对 `effect` 命名空间（如 `gloss.label`）。 */
  readonly labelKey: string
  /** UI 字段描述。 */
  readonly fields: readonly FieldDescriptor[]
  /**
   * 把参数打包成扁平 uniform 值。
   *
   * 写作函数**属性**（而非方法）是为了让 `strictFunctionTypes` 对参数做逆变检查——这样
   * `packUniforms` 收错参数类型会在 {@link EFFECT_REGISTRY} 的 `satisfies` 处报错，而非被
   * 方法的双变（bivariance）悄悄放过。
   *
   * 注意 uniform 键名**不必**等于参数键名：如网格把 `count` 打成 `families`、光泽打成 `bands`，
   * 那是着色器侧的契约名（见 `effects/uniforms.ts`）。
   */
  packUniforms: (params: EffectParamsOf<K>) => PackedUniforms
}

/**
 * `EffectKind` → 对应参数类型。
 *
 * 每种 kind 的参数形状不同（渐变有 count、刻纹有 offsetX……），注册表条目要按 kind
 * 收窄到自己的参数类型，故用条件类型把判别式映射回 params。`EFFECT_REGISTRY` 的
 * `satisfies { [K in EffectKind]: EffectDef<K> }` 会拿它逐键校验：加一种效果时这里同步加一支，
 * 漏了、或某条的 `kind` / `defaultParams` / `packUniforms` 与本条参数类型不吻合，都会在此编译报错。
 */
type EffectParamsOf<K extends EffectKind> = K extends "gradient"
  ? GradientParams
  : K extends "holoGrid"
    ? HoloGridParams
    : K extends "moire"
      ? MoireParams
      : K extends "gloss"
        ? GlossParams
        : K extends "maskPreset"
          ? MaskPresetParams
          : K extends "imageMask"
            ? MaskImageParams
            : K extends "maskErase"
              ? MaskEraseParams
              : K extends "image"
                ? ImageParams
                : never

/** 方向模式选择项（三种效果共用同一枚举）。 */
const MODE_OPTIONS: readonly FieldOption[] = [
  { value: "parallel", labelKey: "pattern.parallel" },
  { value: "radial", labelKey: "pattern.radial" },
  { value: "rays", labelKey: "pattern.rays" },
]

/** 调色板的合成方式：色带 / 叠色式暗部叠色。 */
const PALETTE_COMPOSITE_OPTIONS: readonly FieldOption[] = [
  { value: "palette", labelKey: "gradient.compositePalette" },
  { value: "tint", labelKey: "gradient.compositeTint" },
]

/** 图蒙版来源的选择项（与 `MaskSource` 一一对应）。 */
const MASK_SOURCE_OPTIONS: readonly FieldOption[] = [
  { value: "image", labelKey: "imageMask.sourceImage" },
  { value: "color", labelKey: "imageMask.sourceColor" },
]

/** 图蒙版模式的选择项（与 `MaskMode` 一一对应）。 */
const MASK_MODE_OPTIONS: readonly FieldOption[] = [
  { value: "line", labelKey: "imageMask.modeLine" },
  { value: "fill", labelKey: "imageMask.modeFill" },
]

/** 图蒙版填充方式的选择项（与底图的 `FrontFit` 一一对应；与底图同一展示序）。 */
const MASK_FIT_OPTIONS: readonly FieldOption[] = [
  { value: "cover", labelKey: "imageMask.fitCover" },
  { value: "contain", labelKey: "imageMask.fitContain" },
  { value: "stretch", labelKey: "imageMask.fitStretch" },
]

/** 图片贴片的填充方式：取值与展示序同 {@link MASK_FIT_OPTIONS}，文案走 `image.*`。 */
const IMAGE_FIT_OPTIONS: readonly FieldOption[] = [
  { value: "cover", labelKey: "image.fitCover" },
  { value: "contain", labelKey: "image.fitContain" },
  { value: "stretch", labelKey: "image.fitStretch" },
]

/**
 * 各 params 的规范默认值——由 schema 解析「最小种子」得到，避免两处漂移。
 *
 * 不在这里手写默认值：schema 的 `.default()` 才是唯一来源。参数改动时默认值自动跟上，
 * 注册表不会与 schema 悄悄分叉；「每次返回新对象」也由 parse 保证（见测试）。
 */
function parseParams<K extends EffectKind>(
  kind: K,
  seed: Record<string, unknown>,
): EffectParamsOf<K> {
  const parsed = EffectSchema.parse({ kind, id: "seed", enabled: true, params: seed })
  // parse 返回的是宽的判别联合，`params` 是各 kind 参数的并集；这里收窄回本条 kind 的类型。
  // 该 cast 由 `EFFECT_REGISTRY` 的 satisfies 兜底——若映射写错，satisfies 会先报错。
  return parsed.params as EffectParamsOf<K>
}

export const EFFECT_REGISTRY = {
  gradient: {
    kind: "gradient",
    role: "phase",
    scope: "layer",
    maxPerTarget: GRADIENT_MAX,
    // 预置产品默认调色板（金→蓝→紫）：schema 的 `colors` 默认是 `[]`（不出全息），
    // 新建时给一组可见初值，而非空。
    defaultParams: () =>
      parseParams("gradient", { colors: DEFAULT_STOPS.map((s) => ({ ...s })) }),
    labelKey: "gradient.label",
    fields: [
      // 原 palette 效果（schema v10 并入）：色标 / 合成方式 / 叠色参数放在最前。
      {
        key: "composite",
        labelKey: "gradient.composite",
        type: "select",
        options: PALETTE_COMPOSITE_OPTIONS,
      },
      // 叠色合成不读色标：隐藏色标，避免用户以为改色仍有反应。
      {
        key: "colors",
        labelKey: "gradient.colors",
        type: "colorStops",
        visibleWhen: (p) => p.composite !== "tint",
      },
      // 叠色合成的可调项：默认值即 holo.fs 的常量，只在 叠色模式下显示。
      {
        key: "hue",
        labelKey: "gradient.hue",
        type: "slider",
        min: 0,
        max: 0.2,
        step: 0.001,
        precision: 3,
        visibleWhen: (p) => p.composite === "tint",
      },
      {
        key: "sat",
        labelKey: "gradient.sat",
        type: "slider",
        min: 0,
        max: 2,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.composite === "tint",
      },
      {
        key: "lift",
        labelKey: "gradient.lift",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.composite === "tint",
      },
      {
        key: "tint",
        labelKey: "gradient.tint",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.composite === "tint",
      },
      {
        key: "deltaBase",
        labelKey: "gradient.deltaBase",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.composite === "tint",
      },
      {
        key: "deltaContrast",
        labelKey: "gradient.deltaContrast",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.composite === "tint",
      },
      {
        key: "deltaBright",
        labelKey: "gradient.deltaBright",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.composite === "tint",
      },
      { key: "mode", labelKey: "gradient.mode", type: "select", options: MODE_OPTIONS },
      {
        key: "count",
        labelKey: "gradient.count",
        type: "slider",
        min: 1,
        max: 64,
        step: 1,
        precision: 0,
      },
      {
        key: "angle",
        labelKey: "gradient.angle",
        type: "slider",
        min: 0,
        max: 360,
        step: 1,
        precision: 0,
        visibleWhen: (p) => p.mode === "parallel",
      },
      {
        key: "twist",
        labelKey: "gradient.twist",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      // 扭转种子：决定「怎么转」——扭转中心与沿卡面的扭转率都由它派生（见着色器 twistPhase）。
      // 0 = 绕卡心匀速（旧行为）；换种子即换一副螺旋，扭转强度仍由上一项 twist 单独控制。
      {
        key: "twistSeed",
        labelKey: "gradient.twistSeed",
        type: "slider",
        min: 0,
        max: 1000000,
        step: 1,
        precision: 0,
      },
      // 相位全局项：多数原为图层字段，现随 `gradient` 效果承载（见设计方案 §4.2）；`transition`
      // 是后加的同类项。它们**不受 `enabled` 门控**（关掉斜坡仍生效，见 §3），故与斜坡字段一并
      // 列在此处、始终可见；进 `uPhaseSpeed` 等散装 uniform 而非定长数组，故不进下面的
      // `packUniforms`。取值域与默认值沿用旧图层控件。
      {
        key: "distortionStrength",
        labelKey: "gradient.distortionStrength",
        type: "slider",
        min: 0,
        max: 1000,
        step: 1,
        precision: 0,
      },
      {
        key: "phaseSpeed",
        labelKey: "gradient.phaseSpeed",
        type: "slider",
        min: 0,
        max: 5,
        step: 0.01,
        precision: 2,
      },
      // 倾斜灵敏度：只放大「转卡带来的变化」，静止画面不受影响（平卡时法线就是正对方向）。
      {
        key: "tiltGain",
        labelKey: "gradient.tiltGain",
        type: "slider",
        min: 0,
        max: 3,
        step: 0.01,
        precision: 2,
      },
      {
        key: "noiseStrength",
        labelKey: "gradient.noiseStrength",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      // 色标过渡带宽度：0 = 硬边（纯色块），1 = 整段线性过渡（旧观感），>1 让相邻段浑融。
      // 默认 1，故旧系列不受影响。上限与 GradientParamsSchema 一致（单一来源见那里的注释）。
      {
        key: "transition",
        labelKey: "gradient.transition",
        type: "slider",
        min: 0,
        max: 3,
        step: 0.01,
        precision: 2,
      },
      {
        key: "offsetX",
        labelKey: "gradient.offsetX",
        type: "slider",
        min: -3,
        max: 3,
        step: 0.01,
        precision: 2,
      },
      {
        key: "offsetY",
        labelKey: "gradient.offsetY",
        type: "slider",
        min: -3,
        max: 3,
        step: 0.01,
        precision: 2,
      },
      // 整齐：1 = 只留斜坡本身，色带笔直等距；0 = 保留原有的方向项 / 固定正弦 / 像素位移。
      // schema v10 起默认 1；旧数据里落盘的 0 不被改写。它是相位全局项（同 distortionStrength），
      // 不进定长数组。
      {
        key: "straight",
        labelKey: "gradient.straight",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
    ],
    packUniforms: (p: GradientParams): PackedUniforms => ({
      mode: patternModeCode(p.mode),
      density: p.count,
      angle: p.angle,
      twist: p.twist,
      twistSeed: p.twistSeed,
      straight: p.straight,
    }),
  },
  moire: {
    kind: "moire",
    role: "phase",
    scope: "both",
    maxPerTarget: MOIRE_MAX,
    defaultParams: () => parseParams("moire", {}),
    labelKey: "moire.label",
    fields: [
      { key: "mode", labelKey: "moire.mode", type: "select", options: MODE_OPTIONS },
      {
        key: "angle",
        labelKey: "moire.angle",
        type: "slider",
        min: 0,
        max: 360,
        step: 1,
        precision: 0,
        visibleWhen: (p) => p.mode === "parallel",
      },
      {
        key: "density",
        labelKey: "moire.density",
        type: "slider",
        min: 1,
        max: 64,
        step: 1,
        precision: 0,
      },
      {
        key: "depth",
        labelKey: "moire.depth",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "twist",
        labelKey: "moire.twist",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      // 扭转种子：决定「怎么转」——扭转中心与沿卡面的扭转率都由它派生（见着色器 twistPhase）。
      // 0 = 绕卡心匀速（旧行为）；换种子即换一副螺旋，扭转强度仍由上一项 twist 单独控制。
      {
        key: "twistSeed",
        labelKey: "moire.twistSeed",
        type: "slider",
        min: 0,
        max: 1000000,
        step: 1,
        precision: 0,
      },
      {
        key: "contentRelief",
        labelKey: "moire.contentRelief",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
    ],
    packUniforms: (p: MoireParams): PackedUniforms => ({
      mode: patternModeCode(p.mode),
      angle: p.angle,
      density: p.density,
      depth: p.depth,
      twist: p.twist,
      twistSeed: p.twistSeed,
      contentRelief: p.contentRelief,
    }),
  },
  gloss: {
    kind: "gloss",
    role: "color",
    scope: "both",
    maxPerTarget: GLOSS_MAX,
    defaultParams: () => parseParams("gloss", {}),
    labelKey: "gloss.label",
    fields: [
      { key: "mode", labelKey: "gloss.mode", type: "select", options: MODE_OPTIONS },
      {
        key: "count",
        labelKey: "gloss.count",
        type: "slider",
        min: 1,
        max: 16,
        step: 1,
        precision: 0,
      },
      {
        key: "spacing",
        labelKey: "gloss.spacing",
        type: "slider",
        min: 0.02,
        max: 2,
        step: 0.01,
        precision: 2,
      },
      {
        key: "width",
        labelKey: "gloss.width",
        type: "slider",
        min: 0.005,
        max: 1,
        step: 0.005,
        precision: 3,
      },
      {
        key: "angle",
        labelKey: "gloss.angle",
        type: "slider",
        min: 0,
        max: 360,
        step: 1,
        precision: 0,
        visibleWhen: (p) => p.mode === "parallel",
      },
      {
        key: "twist",
        labelKey: "gloss.twist",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      // 扭转种子：决定「怎么转」——扭转中心与沿卡面的扭转率都由它派生（见着色器 twistPhase）。
      // 0 = 绕卡心匀速（旧行为）；换种子即换一副螺旋，扭转强度仍由上一项 twist 单独控制。
      {
        key: "twistSeed",
        labelKey: "gloss.twistSeed",
        type: "slider",
        min: 0,
        max: 1000000,
        step: 1,
        precision: 0,
      },
      {
        key: "intensity",
        labelKey: "gloss.intensity",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      // 光带颜色：缺省 = 老暖白常量（见 schema 的注释），故这里不能给默认值。
      // 开蒙版时光带不上色，色块隐藏。
      { key: "color", labelKey: "gloss.color", type: "color", visibleWhen: (p) => !p.asMask },
      // 作为蒙版：光带场变成覆盖率、向下裁切子图层（与文字蒙版同义）。只在图层上显示——
      // 卡面没有子层可裁。
      { key: "asMask", labelKey: "gloss.asMask", type: "switch", scope: "layer" },
      // 整场平移（UV 域）：把光带（或它当蒙版时的窗口）挪到想要的落点。量程与刻纹的
      // offsetX / offsetY 同口径；缺省 0 = 钉在原位。
      {
        key: "offsetX",
        labelKey: "gloss.offsetX",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "offsetY",
        labelKey: "gloss.offsetY",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      // 羽化：光带边缘往内渐隐的比例。1 = 从中心一路渐隐（旧画法，默认），0 = 硬边。
      {
        key: "softness",
        labelKey: "gloss.softness",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
    ],
    packUniforms: (p: GlossParams): PackedUniforms => ({
      mode: patternModeCode(p.mode),
      bands: p.count,
      spacing: p.spacing,
      width: p.width,
      angle: p.angle,
      twist: p.twist,
      twistSeed: p.twistSeed,
      intensity: p.intensity,
      asMask: p.asMask ? 1 : 0,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
      softness: p.softness,
    }),
  },
  holoGrid: {
    kind: "holoGrid",
    role: "phase",
    scope: "layer",
    maxPerTarget: HOLO_GRID_MAX,
    defaultParams: () => parseParams("holoGrid", {}),
    labelKey: "holoGrid.label",
    fields: [
      {
        key: "count",
        labelKey: "holoGrid.count",
        type: "slider",
        min: 1,
        max: 8,
        step: 1,
        precision: 0,
      },
      {
        key: "angle",
        labelKey: "holoGrid.angle",
        type: "slider",
        min: 0,
        max: 360,
        step: 1,
        precision: 0,
      },
      {
        key: "density",
        labelKey: "holoGrid.density",
        type: "slider",
        min: 1,
        max: 100,
        step: 1,
        precision: 0,
      },
      {
        key: "width",
        labelKey: "holoGrid.width",
        type: "slider",
        min: 0.02,
        max: 0.6,
        step: 0.01,
        precision: 2,
      },
      {
        key: "strength",
        labelKey: "holoGrid.strength",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "offsetX",
        labelKey: "holoGrid.offsetX",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "offsetY",
        labelKey: "holoGrid.offsetY",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
    ],
    // 网格是相位加项：线族参数进定长数组。
    packUniforms: (p: HoloGridParams): PackedUniforms => ({
      families: p.count,
      angle: p.angle,
      density: p.density,
      width: p.width,
      strength: p.strength,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
    }),
  },
  maskPreset: {
    kind: "maskPreset",
    role: "alpha",
    scope: "both",
    maxPerTarget: MASK_PRESET_MAX,
    // 种子预设 id 必须是 `MASK_PRESETS` 里真实存在的一条（"polygon"）；空 id 会被 schema 拒掉。
    defaultParams: () => parseParams("maskPreset", { id: "polygon" }),
    labelKey: "maskPreset.label",
    fields: [
      { key: "id", labelKey: "maskPreset.preset", type: "preset" },
      {
        key: "sides",
        labelKey: "maskPreset.sides",
        type: "slider",
        min: 3,
        max: 64,
        step: 1,
        precision: 0,
      },
      {
        key: "spike",
        labelKey: "maskPreset.spike",
        type: "slider",
        min: 0.1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "irregular",
        labelKey: "maskPreset.irregular",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      { key: "equilateral", labelKey: "maskPreset.equilateral", type: "switch" },
      {
        key: "density",
        labelKey: "maskPreset.density",
        type: "slider",
        min: 1,
        max: 64,
        step: 1,
        precision: 0,
      },
      {
        key: "size",
        labelKey: "maskPreset.size",
        type: "slider",
        min: 0.01,
        max: 0.3,
        step: 0.005,
        precision: 3,
      },
      {
        key: "sizeJitter",
        labelKey: "maskPreset.sizeJitter",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "arrangement",
        labelKey: "maskPreset.arrangement",
        type: "select",
        options: [
          { value: "random", labelKey: "maskPreset.arrangementRandom" },
          { value: "regular", labelKey: "maskPreset.arrangementRegular" },
        ],
      },
      {
        key: "softness",
        labelKey: "maskPreset.softness",
        type: "slider",
        min: 0,
        max: 0.5,
        step: 0.005,
        precision: 3,
      },
      {
        key: "seed",
        labelKey: "maskPreset.seed",
        type: "slider",
        min: 0,
        max: 1000000,
        step: 1,
        precision: 0,
      },
      {
        key: "offsetX",
        labelKey: "maskPreset.offsetX",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "offsetY",
        labelKey: "maskPreset.offsetY",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      { key: "flipX", labelKey: "maskPreset.flipX", type: "switch" },
      { key: "flipY", labelKey: "maskPreset.flipY", type: "switch" },
      {
        key: "rotation",
        labelKey: "maskPreset.rotation",
        type: "slider",
        min: 0,
        max: 360,
        step: 1,
        precision: 0,
      },
      { key: "invert", labelKey: "maskPreset.invert", type: "switch" },
    ],
    packUniforms: (p: MaskPresetParams): PackedUniforms => ({
      sides: p.sides,
      spike: p.spike,
      irregular: p.irregular,
      equilateral: p.equilateral ? 1 : 0,
      density: p.density,
      size: p.size,
      sizeJitter: p.sizeJitter,
      arrangement: p.arrangement === "random" ? 1 : 0,
      softness: p.softness,
      seed: p.seed,
      offset: [p.offsetX, p.offsetY],
      flipX: p.flipX ? 1 : 0,
      flipY: p.flipY ? 1 : 0,
      rotation: p.rotation,
      invert: p.invert ? 1 : 0,
    }),
  },
  imageMask: {
    kind: "imageMask",
    role: "alpha",
    scope: "both",
    maxPerTarget: IMAGE_MASK_MAX,
    defaultParams: () => parseParams("imageMask", {}),
    labelKey: "imageMask.label",
    fields: [
      // 来源：图片蒙版（上传一张图）或颜色蒙版（吸管从卡面原图拾一个颜色）。
      // 两者的字段集不同，故 path / mode 仅在图片源显示，color 仅在颜色源显示。
      { key: "source", labelKey: "imageMask.source", type: "select", options: MASK_SOURCE_OPTIONS },
      {
        key: "color",
        labelKey: "imageMask.color",
        type: "color",
        visibleWhen: (p) => p.source === "color",
      },
      {
        key: "path",
        labelKey: "imageMask.path",
        type: "image",
        visibleWhen: (p) => p.source !== "color",
      },
      {
        key: "mode",
        labelKey: "imageMask.mode",
        type: "select",
        options: MASK_MODE_OPTIONS,
        visibleWhen: (p) => p.source !== "color",
      },
      // 阈值对两种来源都成立：图片源是亮度带、颜色源是颜色距离带（语义见 schema 的注释）。
      {
        key: "edge0",
        labelKey: "imageMask.edge0",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.source === "color" || p.mode === "line",
      },
      {
        key: "edge1",
        labelKey: "imageMask.edge1",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        visibleWhen: (p) => p.source === "color" || p.mode === "line",
      },
      { key: "invert", labelKey: "imageMask.invert", type: "switch" },
      // 跟随卡面（一键对齐）：打开后编辑器在写卡面变换时把填充方式 / 位移 / 缩放 / 旋转
      // 抄进本条目（见 packStore 的 applyFrontTransformToMask），参数里落的是具体数值。
      // 跟随时下面五项不显示——写了也会被卡面值覆盖。
      // 蒙版图的填充方式 / 位移 / 缩放 / 旋转（与 image 效果同一套量纲与范围，默认覆盖 + 零位移 + 1 倍 + 0 度）。
      {
        key: "fit",
        labelKey: "imageMask.fit",
        type: "select",
        options: MASK_FIT_OPTIONS,
      },
      {
        key: "x",
        labelKey: "imageMask.x",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "y",
        labelKey: "imageMask.y",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "scale",
        labelKey: "imageMask.scale",
        type: "slider",
        min: 0.1,
        max: 4,
        step: 0.01,
        precision: 2,
      },
      {
        key: "rotation",
        labelKey: "imageMask.rotation",
        type: "slider",
        min: -180,
        max: 180,
        step: 1,
        precision: 0,
      },
    ],
    // 图蒙版是「资源 + 门控」型效果：上限 1、且带一个 sampler（纹理名没法打包成 number），
    // 故不进 toEffectUniforms 的任何定长数组——参数与纹理由材质侧 resolveImageMask 直接解析。
    packUniforms: () => ({}),
  },
  maskErase: {
    kind: "maskErase",
    role: "alpha",
    // 两端都可挂：卡面级 = 整张卡（含全部图层）擦除；图层级 = 只擦该层（连同其子树），
    // 用于「只留这一层想要的部分」。
    scope: "both",
    maxPerTarget: MASK_ERASE_MAX,
    defaultParams: () => parseParams("maskErase", {}),
    labelKey: "maskErase.label",
    fields: [
      // 唯一「参数」是落盘路径：入口在预览里的画笔，画面由用户画出来而不是选文件。
      { key: "path", labelKey: "maskErase.paint", type: "paint" },
    ],
    // 资源型效果（一张纹理 + 一个门控），参数不打包成 number，见材质侧 resolveEraseMask。
    packUniforms: () => ({}),
  },
  image: {
    kind: "image",
    role: "content",
    scope: "layer",
    maxPerTarget: IMAGE_MAX,
    defaultParams: () => parseParams("image", {}),
    labelKey: "image.label",
    fields: [
      { key: "path", labelKey: "image.path", type: "image" },
      // 跟随卡面（一键对齐）：打开后编辑器在写卡面变换时把填充方式 / 位移 / 缩放 / 旋转
      // 抄进本条目（见 packStore 的 applyFrontTransformToImage），参数里落的是具体数值。
      // 跟随时下面的填充方式与四个滑块不显示——写了也会被卡面值覆盖。
      {
        key: "fit",
        labelKey: "image.fit",
        type: "select",
        options: IMAGE_FIT_OPTIONS,
      },
      {
        key: "x",
        labelKey: "image.x",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "y",
        labelKey: "image.y",
        type: "slider",
        min: -1,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "rotation",
        labelKey: "image.rotation",
        type: "slider",
        min: -180,
        max: 180,
        step: 1,
        precision: 0,
      },
      {
        key: "scale",
        labelKey: "image.scale",
        type: "slider",
        min: 0.1,
        max: 4,
        step: 0.01,
        precision: 2,
      },
      // 法线（bump）有两个来源，二选一：上传的法线贴图优先，没有贴图时由图片自身亮度差
      // 当场生成（解码与接管规则见 bump.ts / GLSL 的 normalMapSlope）。
      // 强度 0 = 本条目不开、沿用卡面底图的法线（继承规则见 bump.ts），故默认就是关。
      // 不随「跟随卡面」隐藏：它跟图片内容有关，与卡面变换无关。
      { key: "normalPath", labelKey: "image.normalPath", type: "image" },
      // 绿通道方向：DirectX 与 OpenGL 法线图的 Y 轴约定相反，选错时凹凸看起来是「反的」。
      { key: "normalFlipY", labelKey: "image.normalFlipY", type: "switch", visibleWhen: (p) => Boolean(p.normalPath) },
      {
        key: "bumpStrength",
        labelKey: "image.bumpStrength",
        type: "slider",
        min: 0,
        max: 10,
        step: 0.01,
        precision: 2,
      },
      {
        key: "bumpDetail",
        labelKey: "image.bumpDetail",
        type: "slider",
        min: 0.001,
        max: 0.05,
        step: 0.001,
        precision: 3,
        // 细节是亮度法线的取样步长；法线贴图自带形状，这一项在贴图模式下不起作用。
        visibleWhen: (p) => !p.normalPath,
      },
      {
        key: "bumpFlow",
        labelKey: "image.bumpFlow",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "bumpLight",
        labelKey: "image.bumpLight",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      },
      {
        key: "bumpLightAngle",
        labelKey: "image.bumpLightAngle",
        type: "slider",
        min: -180,
        max: 180,
        step: 1,
        precision: 0,
      },
      { key: "bumpLightColor", labelKey: "image.bumpLightColor", type: "color" },
      { key: "bumpInvert", labelKey: "image.bumpInvert", type: "switch" },
    ],
    // 资源型效果：纹理与四个标量由材质侧 resolveImage 直接解析，不进入任何定长数组。
    packUniforms: () => ({}),
  },
} as const satisfies { [K in EffectKind]: EffectDef<K> }

/**
 * 全部 kind 的稳定枚举序（UI 菜单 / 遍历用）。
 *
 * 显式列出而非 `Object.keys(EFFECT_REGISTRY)`：顺序即菜单展示序，需稳定且可读。加一种效果时
 * 除了在 `EFFECT_REGISTRY` 加一条，也要在这里补上——测试会对照两处的 kind 集合兜底。
 */
export const EFFECT_KINDS: readonly EffectKind[] = [
  "gradient",
  "moire",
  "gloss",
  "holoGrid",
  "maskPreset",
  "imageMask",
  "maskErase",
  "image",
]
