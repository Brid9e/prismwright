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
  Layer,
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

/**
 * 调整层可以向下传播的效果种类：相位 / 颜色类。
 *
 * 内容类（image）与 alpha 类（各种蒙版）是「这一层画什么 / 怎么裁」的语义，传给下方图层
 * 会变成另一回事；调整层只承载「怎么长」的效果。
 */
const ADJUSTMENT_EFFECT_KINDS: ReadonlySet<Effect["kind"]> = new Set([
  "gradient",
  "moire",
  "gloss",
  "holoGrid",
])

/** 某个图层向上收到、由调整层传下来的效果。 */
function adjustableEffects(effects: readonly Effect[]): Effect[] {
  return effects.filter((e) => e.enabled && ADJUSTMENT_EFFECT_KINDS.has(e.kind))
}

/**
 * 计算每个图层的**有效效果列表**：自有效果 + 同组上方调整层传下来的效果。
 *
 * 规则（PS 调整层语义，作用范围限定「同组下方」）：
 * - 同一父层内，调整层只影响它**下方**的兄弟；不影响上方，也不越过父层影响别的组。
 * - 祖先组上方的调整层会随递归传进整个子树（因为组整体在调整层下方）。
 * - 调整层自身不绘制；它的效果按 `ADJUSTMENT_EFFECT_KINDS` 过滤，且只有 `enabled` 的条目传播。
 * - 有效列表把继承来的效果放在自有之前——单槽位效果（如渐变）由更靠上的调整层优先；
 *   多槽位效果（摩尔纹 / 光泽）继续由自有条目补齐。
 *
 * @param layers - 顶层图层数组（数组顺序是绘制顺序：末位在上）。
 * @returns 每个图层 id → 有效效果列表；未出现的图层（理论上不存在）调用方应回落自有列表。
 */
export function resolveEffectiveEffects(layers: readonly Layer[]): Map<string, Effect[]> {
  const out = new Map<string, Effect[]>()

  const walk = (siblings: readonly Layer[], inherited: readonly Effect[]): void => {
    // 展示顺序是数组倒序：从最上层往下走，遇到调整层就把它加到「给下方」的集合里。
    let active = inherited
    for (let i = siblings.length - 1; i >= 0; i--) {
      const layer = siblings[i]
      out.set(layer.id, [...active, ...layer.effects])
      if (layer.kind === "adjustment" && layer.enabled) {
        active = [...active, ...adjustableEffects(layer.effects)]
      }
      // 组的子树整体在祖先调整层下方；调整层自己的子树也吃自己的效果。
      walk(layer.children, active)
    }
  }

  walk(layers, [])
  return out
}
