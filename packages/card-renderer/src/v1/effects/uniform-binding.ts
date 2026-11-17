/**
 * `EffectUniformArrays` → three `uniforms` 值对象。
 *
 * 标量数组直接绑定（three 会把 number[] 当作 `float[]`）；`uMaskPresetOffset` 是 `vec2[]`，
 * 需转成 `Vector2[]`。集中在此，避免 base / layer 两个材质各写一遍。
 *
 * 键名即着色器 uniform 名，逐字对应（见 `effects/uniforms.ts`）——这条接缝类型看不出来，
 * 名字写错只会让画面静默不动，故由材质的单测钉住。
 */
import { Vector2 } from "three"
import type { EffectUniformArrays } from "./uniforms"

export function toEffectUniformObjects(
  fx: EffectUniformArrays,
): Record<string, { value: unknown }> {
  const out: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(fx)) {
    // 这是 `EffectUniformArrays` 里**唯一**的 vec2 数组，故逐个列名而不抽通用规则。
    // 将来再加一个 vec2 数组（如另一种带位移的效果），必须同步在这里登记：漏了会被 else
    // 分支原样按 `[number, number][]` 绑进去，three 读 `.x/.y` 得到 undefined → 静默画错。
    if (key === "uMaskPresetOffset") {
      out[key] = { value: (value as [number, number][]).map(([x, y]) => new Vector2(x, y)) }
    } else {
      out[key] = { value }
    }
  }
  return out
}
