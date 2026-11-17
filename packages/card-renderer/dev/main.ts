/**
 * 视觉验收页：加载一张样例卡（1 个可调图层），用右侧滑块实时调参，
 * 供与 buling 单层效果肉眼对照校准（WebGL 无法单测的补偿手段）。
 *
 * 图蒙版与程序化蒙版都并入图层的效果栈（分别是 `imageMask` / `maskPreset` 两条效果），
 * 本页的 `maskMode` / `invert` 控件写进 `imageMask` 条目，不再是图层专属字段。
 */
import {
  DEFAULT_STOPS,
  GlossParamsSchema,
  MoireParamsSchema,
  type CardFace,
  type Effect,
  type Layer,
  type MaskPresetParams,
  type PatternMode,
} from "@cardbara/schema"
import { createCardView, createDomHost } from "../src/v1/index"
import { MASK_PRESETS } from "../src/v1/index"
import { makeFrontTexture, makeLineMaskTexture, makeFillMaskTexture } from "./sample-textures"

const front = makeFrontTexture()
const lineMask = makeLineMaskTexture()
const fillMask = makeFillMaskTexture()

const layer: Layer = {
  id: "l1",
  name: "",
  enabled: true,
  holoMix: 0.9,
  holoAlpha: 1,
  blend: "add",
  opacity: 1,
  // 色标随数据层改造自图层字段迁入 palette 效果条目，取产品默认调色板（金→蓝→紫，即 DEFAULT_STOPS）。
  // 各效果按 kind 依次叠加，顺序由着色器固定，与列表位置无关。渐变空间用产品默认（平行、count 31、
  // angle 38.4），本页拖控件即改；相位全局项（扭曲 / 流速 / 噪声 / 偏移）也迁进 gradient 的 params。
  // 几何刻纹本页没有控件、产品默认又关闭，故不挂效果条目；刻纹的观感在桌面应用里验收。
  // 图蒙版同样作为效果条目挂上（path 指向 line 样例图），其模式 / 反转由本页控件在 apply() 里改写。
  effects: [
    {
      id: "fx-palette",
      enabled: true,
      kind: "palette",
      params: { colors: DEFAULT_STOPS.map((s) => ({ ...s })) },
    },
    {
      id: "fx-gradient",
      enabled: true,
      kind: "gradient",
      // 这一页是给「与 buling 对照校准」用的，故噪声取满档（产品默认 0）；相位偏移取产品默认 0。
      params: {
        mode: "parallel",
        count: 31,
        angle: 38.4,
        twist: 0,
        distortionStrength: 5,
        phaseSpeed: 1,
        noiseStrength: 1,
        offsetX: 0,
        offsetY: 0,
      },
    },
    {
      id: "fx-image-mask",
      enabled: true,
      kind: "imageMask",
      params: { path: "mask:line", mode: "line", edge0: 0, edge1: 0.95, invert: false },
    },
  ],
  children: [],
}
// 卡面材质取 schema 默认（光泽开、摩尔纹关）——两者都已是效果条目，本页可再调。
const card: CardFace = {
  front: "front",
  effects: [
    { id: "fx-gloss", enabled: true, kind: "gloss", params: GlossParamsSchema.parse({}) },
    { id: "fx-moire", enabled: false, kind: "moire", params: MoireParamsSchema.parse({}) },
  ],
  layers: [layer],
}

const view = createCardView({
  host: createDomHost(document.getElementById("stage")!),
  card,
  resolveAsset: async (rel) =>
    rel === "front" ? front : rel === "mask:line" ? lineMask : fillMask,
})

/**
 * 由控件组装蒙版预设参数：预设提供形状档位（spike / size / sizeJitter / softness），
 * 其余（边数 / 不规则 / 密度 / 排布 / 位移 / 翻转 / 旋转 / 种子 / 等边）由本页控件覆盖。
 *
 * @returns 完整的一份 {@link MaskPresetParams}；当下拉选「（关）」时返回 `null`（不挂条目，
 *   蒙版仍走图蒙版路径）。
 */
function maskPresetParams(): MaskPresetParams | null {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const presetId = el<HTMLSelectElement>("maskPresetId").value
  if (!presetId) return null
  const preset = MASK_PRESETS.find((p) => p.id === presetId)
  if (!preset) return null
  return {
    ...preset.params,
    id: preset.id,
    // 边数 / 不规则由本页控件决定（与桌面端同一口径：预设给形状一组初值，滑块再覆盖）。
    sides: Number(el<HTMLInputElement>("maskPresetSides").value),
    irregular: Number(el<HTMLInputElement>("maskPresetIrregular").value),
    // 等边 / 翻转 / 旋转同样由本页控件决定（预设不含这几项，物化时一律是默认值）。
    equilateral: el<HTMLInputElement>("maskPresetEquilateral").checked,
    density: Number(el<HTMLInputElement>("maskPresetDensity").value),
    // 排布由本页自己的下拉决定，不受预设影响（与桌面端同一口径：排布管「怎么摆」，与形状正交）。
    arrangement: el<HTMLSelectElement>("maskPresetArrangement")
      .value as MaskPresetParams["arrangement"],
    offsetX: Number(el<HTMLInputElement>("maskPresetOffsetX").value),
    offsetY: Number(el<HTMLInputElement>("maskPresetOffsetY").value),
    flipX: el<HTMLInputElement>("maskPresetFlipX").checked,
    flipY: el<HTMLInputElement>("maskPresetFlipY").checked,
    rotation: Number(el<HTMLInputElement>("maskPresetRotation").value),
    seed: Number(el<HTMLInputElement>("maskPresetSeed").value),
    // 程序化蒙版的反转已改为逐条自带（与图蒙版各持一份），本页未开对应控件——反转的校准在桌面端做。
    invert: false,
  }
}

/** 读控件 → 组装新 card → view.update。 */
function apply(): void {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const gradientEffect: Effect = {
    id: "fx-gradient",
    enabled: true,
    kind: "gradient",
    params: {
      mode: el<HTMLSelectElement>("gradientMode").value as PatternMode,
      count: Number(el<HTMLInputElement>("gradientCount").value),
      angle: Number(el<HTMLInputElement>("gradientAngle").value),
      twist: Number(el<HTMLInputElement>("gradientTwist").value),
      // 相位全局项原挂在图层字段上，现由 gradient 效果承载——仍读同一批滑块。
      distortionStrength: Number(el<HTMLInputElement>("distortion").value),
      phaseSpeed: Number(el<HTMLInputElement>("phaseSpeed").value),
      noiseStrength: Number(el<HTMLInputElement>("noiseStrength").value),
      offsetX: Number(el<HTMLInputElement>("offsetX").value),
      offsetY: Number(el<HTMLInputElement>("offsetY").value),
    },
  }
  // 色标由 palette 效果承载（原为图层字段），本页无对应控件，故用产品默认调色板。
  const paletteEffect: Effect = {
    id: "fx-palette",
    enabled: true,
    kind: "palette",
    params: { colors: DEFAULT_STOPS.map((s) => ({ ...s })) },
  }
  const mp = maskPresetParams()
  // 图蒙版并入效果栈：模式取自 maskMode 控件，path 随之在 line / fill 两张样例图之间切换；
  // 反转取自 invert 复选框（每张图蒙版自带 invert，不再是图层共用字段）。
  const imageMaskMode = el<HTMLSelectElement>("maskMode").value as "line" | "fill"
  const imageMaskEffect: Effect = {
    id: "fx-image-mask",
    enabled: true,
    kind: "imageMask",
    params: {
      path: imageMaskMode === "line" ? "mask:line" : "mask:fill",
      mode: imageMaskMode,
      edge0: 0,
      edge1: 0.95,
      invert: el<HTMLInputElement>("invert").checked,
    },
  }
  // palette / gradient / imageMask（及程序化蒙版）各按 kind 依次叠加——顺序由着色器固定，与列表位置无关。
  const layerEffects: Effect[] = mp
    ? [
        paletteEffect,
        gradientEffect,
        imageMaskEffect,
        { id: "fx-mask", enabled: true, kind: "maskPreset", params: mp },
      ]
    : [paletteEffect, gradientEffect, imageMaskEffect]
  const nextLayer: Layer = {
    ...layer,
    blend: el<HTMLSelectElement>("blend").value as Layer["blend"],
    holoMix: Number(el<HTMLInputElement>("holoMix").value),
    holoAlpha: Number(el<HTMLInputElement>("holoAlpha").value),
    opacity: Number(el<HTMLInputElement>("opacity").value),
    effects: layerEffects,
  }
  const nestOn = el<HTMLInputElement>("nest").checked
  // 子层不挂 imageMask（效果只留 palette + gradient）→ 自身整卡出全息，只有「祖先软裁切」这一条在决定它的形状：
  // 勾上 nest 后，特效只应出现在父层线稿（暗线）处。子层会继承 nextLayer.effects（其中含 imageMask），
  // 故显式覆盖 effects 把图蒙版撇掉。
  const child: Layer = {
    ...nextLayer,
    id: "l1-child",
    name: "",
    effects: [paletteEffect, gradientEffect],
    children: [],
  }
  const next: CardFace = {
    front: "front",
    effects: [
      {
        id: "fx-gloss",
        enabled: el<HTMLInputElement>("glossEnabled").checked,
        kind: "gloss",
        params: {
          mode: el<HTMLSelectElement>("glossMode").value as PatternMode,
          count: Number(el<HTMLInputElement>("glossCount").value),
          spacing: Number(el<HTMLInputElement>("glossSpacing").value),
          width: Number(el<HTMLInputElement>("glossWidth").value),
          angle: Number(el<HTMLInputElement>("glossAngle").value),
          twist: Number(el<HTMLInputElement>("glossTwist").value),
          intensity: Number(el<HTMLInputElement>("glossIntensity").value),
        },
      },
      {
        id: "fx-moire",
        enabled: el<HTMLInputElement>("moireEnabled").checked,
        kind: "moire",
        params: {
          mode: el<HTMLSelectElement>("moireMode").value as PatternMode,
          angle: Number(el<HTMLInputElement>("moireAngle").value),
          density: Number(el<HTMLInputElement>("moireDensity").value),
          depth: Number(el<HTMLInputElement>("moireDepth").value),
          twist: Number(el<HTMLInputElement>("moireTwist").value),
          faceStrength: Number(el<HTMLInputElement>("moireFaceStrength").value),
        },
      },
    ],
    layers: [nestOn ? { ...nextLayer, children: [child] } : nextLayer],
  }
  view.update(next)
}

for (const id of [
  "maskMode",
  "blend",
  "holoMix",
  "holoAlpha",
  "opacity",
  "distortion",
  "phaseSpeed",
  "noiseStrength",
  "offsetX",
  "offsetY",
  "invert",
  "glossEnabled",
  "glossMode",
  "glossCount",
  "glossSpacing",
  "glossWidth",
  "glossAngle",
  "glossTwist",
  "glossIntensity",
  "moireEnabled",
  "moireMode",
  "moireAngle",
  "moireDensity",
  "moireDepth",
  "moireTwist",
  "moireFaceStrength",
  "gradientMode",
  "gradientCount",
  "gradientAngle",
  "gradientTwist",
  "maskPresetId",
  "maskPresetSides",
  "maskPresetIrregular",
  "maskPresetEquilateral",
  "maskPresetArrangement",
  "maskPresetDensity",
  "maskPresetOffsetX",
  "maskPresetOffsetY",
  "maskPresetFlipX",
  "maskPresetFlipY",
  "maskPresetRotation",
  "maskPresetSeed",
  "nest",
]) {
  document.getElementById(id)?.addEventListener("input", apply)
}
