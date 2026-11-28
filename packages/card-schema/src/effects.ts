/**
 * 效果列表的纯查询辅助。
 *
 * 架构位置：数据层（`@prismwright/schema`）里的「效果列表算法」——零依赖、零 IO，供渲染器（解析
 * 目标的图蒙版纹理与参数）与编辑器（收集资源路径、判断缺失）共用。集中在此是为了杜绝各处各写
 * 一遍查找——尤其 `enabled` 过滤一旦漏写，「关掉蒙版」会静默失效。
 */
import type {
  Effect,
  GradientParams,
  ImageParams,
  MaskEraseParams,
  MaskImageParams,
} from "./types.js"

/**
 * 取目标的效果列表里**生效的**图蒙版参数。
 *
 * 返回第一条 `enabled` 的 `imageMask` 的 params；没有则返回 `null`（该目标不吃图蒙版）。
 * 只返回参数、不判空 `path`——「已添加但未上传」是合法中间态，由调用方按需判 `path.length > 0`。
 */
export function resolveImageMask(effects: readonly Effect[]): MaskImageParams | null {
  for (const e of effects) {
    if (e.kind === "imageMask" && e.enabled) return e.params
  }
  return null
}

/**
 * 取某目标（卡面或某个图层）的效果列表里**生效的**擦除蒙版参数。
 *
 * 与图蒙版不同，擦除是「相乘」的一层：它不参与蒙版二选一，而是作用在该目标的最终 alpha 上。
 * 卡面级那张乘整张卡（含全部图层）；图层级那张只乘该层，并向下继承到其子树。
 * 只返回参数、不判空 `path`——「已添加但还没画」是合法中间态，由调用方按
 * `path.length > 0` 决定是否真的相乘。
 */
export function resolveEraseMask(effects: readonly Effect[]): MaskEraseParams | null {
  for (const e of effects) {
    if (e.kind === "maskErase" && e.enabled) return e.params
  }
  return null
}

/**
 * 取目标效果列表里**生效的**图片参数。
 *
 * 返回第一条 `enabled` 的 `image` 的 params；没有则返回 `null`（该目标不放图片）。
 * 只返回参数、不判空 `path`——「已添加但未选图」是合法中间态，由调用方按需判
 * `path.length > 0`（与 {@link resolveImageMask} 同口径）。
 */
export function resolveImage(effects: readonly Effect[]): ImageParams | null {
  for (const e of effects) {
    if (e.kind === "image" && e.enabled) return e.params
  }
  return null
}

/**
 * 取目标效果列表里的渐变参数（含 5 个相位全局项）。
 *
 * 返回第一条 `gradient` 的 params，**不论其 `enabled`**——相位全局项不随效果开关失效（见设计方案 §3），
 * 故「关掉渐变」后仍需读到它的 5 个标量。没有渐变效果时返回 `null`，由调用方回落 `DEFAULT_GRADIENT_PHASE`。
 *
 * 注意：返回体同时含**受 `enabled` 门控**的斜坡字段（`mode` / `count` / `angle` / `twist`）；渐变被关掉时
 * 这些字段是陈旧值，调用方只应取用 5 个相位标量，勿从本返回值直接读斜坡配置。
 */
export function resolveGradient(effects: readonly Effect[]): GradientParams | null {
  for (const e of effects) {
    if (e.kind === "gradient") return e.params
  }
  return null
}

/**
 * 取目标效果列表里**生效的**渐变参数（色标 / 合成方式 / 斜坡）。
 *
 * 与 {@link resolveGradient} 的差别只在 `enabled`：相位全局项关掉开关也要读，
 * 而「这层出不出全息」必须听开关。只返回参数、不判空 `colors`——「已添加但删空了色标」
 * 是合法中间态（= 不出全息），由调用方按需判（见渲染器的 `holoIsActive`）。
 */
export function resolveHoloGradient(effects: readonly Effect[]): GradientParams | null {
  for (const e of effects) {
    if (e.kind === "gradient" && e.enabled) return e.params
  }
  return null
}
