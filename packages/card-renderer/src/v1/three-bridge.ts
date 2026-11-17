/**
 * three 枚举桥接层。
 *
 * 把 {@link BlendName}（本包自有字面量）映射为 three 的 `Blending` 值。集中在一处，
 * 使 `mapping.ts` 等纯逻辑保持零 three 依赖，也让「three 版本差异」只在此文件处理。
 *
 * `screen` 需要自定义混合：`src=ONE, dst=ONE_MINUS_SRC_COLOR`（即 `src + dst*(1-src)`），
 * three 未内建，故用 `CustomBlending` 手工指定。其余三种用 three 内建枚举。
 */
import {
  AdditiveBlending,
  CustomBlending,
  MultiplyBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcColorFactor,
  type Blending,
  type BlendingDstFactor,
  type BlendingSrcFactor,
} from "three"
import type { BlendName } from "./mapping"

/** three 混合配置：`blending` 值 + 仅 `screen` 需要的自定义因子。 */
export interface BlendingConfig {
  blending: Blending
  blendSrc?: BlendingSrcFactor
  blendDst?: BlendingDstFactor
}

/** 把混合模式名映射为 three 的混合配置。 */
export function resolveBlending(mode: BlendName): BlendingConfig {
  switch (mode) {
    case "add":
      return { blending: AdditiveBlending }
    case "multiply":
      return { blending: MultiplyBlending }
    case "screen":
      return { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcColorFactor }
    case "normal":
    default:
      return { blending: NormalBlending }
  }
}
