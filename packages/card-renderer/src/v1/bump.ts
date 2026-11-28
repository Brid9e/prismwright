/**
 * 法线（bump）来源解析：纯数据，无 three 依赖。
 *
 * 法线有两条通路：
 *  - **亮度伪法线**（默认）：从图片自身的亮度差**当场生成**——相邻像素的亮度差就是高度场的
 *    斜率，斜率再扰动法线（光照 / 反射）与效果 UV（光泽 / 摩尔纹 / 刻纹的走势）。省掉一条
 *    资源管线，参数只有几个滑块可调。
 *  - **法线贴图**（用户选了才走）：采样配套的切线空间法线图，解码成同样的斜率。它**整体接替**
 *    亮度通路，不与亮度差叠加——一张法线图里已经写死了形状，再掺亮度差只会把形状搅乱。
 *
 * 继承规则（亮度与贴图各按自己的开关判断）：
 *  - 图层有自己的图片且法线强度 > 0 → 用自己的（自带法线贴图优先于自己的亮度差）；
 *  - 否则图层没有图 / 图没开法线 → 用卡面底图的那份（同样：卡面的法线贴图优先于卡面亮度差）；
 *  - 卡面自己没图 / 没开 → 关。
 *
 * `source` 是材质与着色器之间的契约：0 = 关、1 = 自身图（图层图片 / 卡面底图）、2 = 卡面底图。
 * 图层片元靠它选采样函数（卡面片元只会收到 0 / 1）。`mode` 决定采样哪条通路。
 */
import {
  DEFAULT_BUMP_LIGHT_ANGLE,
  DEFAULT_BUMP_LIGHT_COLOR,
  type ImageParams,
} from "@prismwright/schema"

/** 法线的可调参数（不区分来源）。 */
export interface BumpSettings {
  /** 强度（0–10）：0 = 关。法线贴图的坡向量级比亮度差大，故上限更高。 */
  strength: number
  /** 取样步长（卡高单位）：越大越粗。仅亮度通路使用。 */
  detail: number
  /** 对图案走势的推动比例（0–1）：0 = 只扰动光照。 */
  flow: number
  /** 斜光在高度场上投下的明暗强度（0–1）：0 = 不出明暗。 */
  light: number
  /** 斜光方向（度，-180–180；127 = 与刻纹浮雕同向）。 */
  lightAngle: number
  /** 斜光颜色（hex）：只染明暗偏离量，白 = 中性。 */
  lightColor: string
  /** 反转明暗方向。 */
  invert: boolean
}

/** 法线来源编码（着色器 uniform `uBumpSource` 的取值）。 */
export type BumpSource = 0 | 1 | 2

/** 法线通路编码（着色器 uniform `uBumpMode` 的取值）：亮度差伪法线 / 采法线贴图。 */
export type BumpMode = "luma" | "normal"

/** 已解析的法线设置。 */
export interface ResolvedBump extends BumpSettings {
  source: BumpSource
  mode: BumpMode
  /** 法线贴图的绿通道是否翻转（`mode` 为 `normal` 时有意义）。 */
  flipY: boolean
}

/** 「关」：强度 0 且来源 0；其余参数取 schema 缺省值，便于材质直接绑定。 */
export const BUMP_OFF: ResolvedBump = {
  source: 0,
  mode: "luma",
  strength: 0,
  detail: 0.01,
  flow: 0.5,
  light: 1,
  lightAngle: DEFAULT_BUMP_LIGHT_ANGLE,
  lightColor: DEFAULT_BUMP_LIGHT_COLOR,
  invert: false,
  flipY: false,
}

/** 一组法线字段（`ImageParams` 与 `CardFace` 共有的键，差一个前缀）。 */
export interface BumpFields {
  bumpStrength: number
  bumpDetail: number
  bumpFlow: number
  bumpLight: number
  bumpLightAngle: number
  bumpLightColor: string
  bumpInvert: boolean
  /** 法线贴图相对路径；空串 = 未选。 */
  normalPath: string
  /** 翻转法线贴图的绿通道。 */
  normalFlipY: boolean
}

/**
 * 解析一份法线设置。
 *
 * @param fields - 法线各参数（图片效果或卡面的原始字段）。
 * @param hasImage - 取样源是否真的有底图。亮度通路没有图时亮度差没有意义（会拿占位像素算出
 *   假斜度）；法线通路自带数据，不依赖底图。
 * @param source - 启用时的来源编码：1 = 自身图，2 = 卡面底图。
 * @param hasNormal - 法线贴图纹理是否真的载入。路径写了但贴图没载入时退回亮度通路。
 */
export function resolveBump(
  fields: BumpFields,
  hasImage: boolean,
  source: 1 | 2,
  hasNormal: boolean,
): ResolvedBump {
  if (fields.bumpStrength <= 0) return BUMP_OFF
  const base: Omit<ResolvedBump, "mode" | "flipY"> = {
    source,
    strength: fields.bumpStrength,
    detail: fields.bumpDetail,
    flow: fields.bumpFlow,
    light: fields.bumpLight,
    lightAngle: fields.bumpLightAngle,
    lightColor: fields.bumpLightColor,
    invert: fields.bumpInvert,
  }
  if (fields.normalPath !== "" && hasNormal) return { ...base, mode: "normal", flipY: fields.normalFlipY }
  if (!hasImage) return BUMP_OFF
  return { ...base, mode: "luma", flipY: false }
}

/** {@link resolveLayerBump} 的输入：四张纹理各问一次「在场吗」。 */
export interface LayerBumpInput {
  /** 本层图片效果参数；没有图时为 `null`。 */
  image: ImageParams | null
  /** 本层图片纹理是否真的在场。 */
  hasImage: boolean
  /** 本层自己的法线贴图纹理是否真的载入。 */
  hasNormal: boolean
  /** 背景图层的 image 参数（最底层可见 image 图层）；没有时传 `null`。 */
  background: ImageParams | null
  /** 背景图纹理是否真的在场。 */
  hasBackgroundImage: boolean
  /** 背景图层的法线贴图纹理是否真的载入。 */
  hasBackgroundNormal: boolean
}

/**
 * 图层用的法线：继承链为「自己的法线贴图 › 自己的亮度差 › 卡面的法线贴图 › 卡面的亮度差」。
 *
 * @param input - 见 {@link LayerBumpInput}。
 */
export function resolveLayerBump(input: LayerBumpInput): ResolvedBump {
  const own = input.image
    ? resolveBump(input.image, input.hasImage, 1, input.hasNormal)
    : BUMP_OFF
  if (own.source !== 0) return own
  const inherited = input.background
    ? resolveBump(input.background, input.hasBackgroundImage, 1, input.hasBackgroundNormal)
    : BUMP_OFF
  // 背景图在着色器里用 uFrontMap / uFaceMapMatrix 采样，故来源改写成 2。
  return inherited.source === 0 ? BUMP_OFF : { ...inherited, source: 2 }
}
