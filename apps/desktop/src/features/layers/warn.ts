/**
 * 图层行的缺失资产告警判定。
 *
 * 图蒙版与图片都挂在效果列表里（`imageMask` / `image`），故从效果解析而非图层字段。
 * 「已添加但未选图」是合法中间态（`path === ""`），此时不该告警；只有填了 path 且该
 * 资源在预览里被标记为缺失时才亮警示徽标。
 */
import { resolveImage, resolveImageMask, type Effect } from "@cardbara/schema"

/**
 * 该图层是否存在缺失的图片资源（图蒙版或图片，任一即可）。
 *
 * @param effects - 图层的效果列表。
 * @param missingAssets - 预览解析失败后累积的缺失路径集合（`rel → true`）。
 */
export function layerHasMissingAsset(
  effects: readonly Effect[],
  missingAssets: Readonly<Record<string, true>>,
): boolean {
  const imageMask = resolveImageMask(effects)
  const image = resolveImage(effects)
  const maskMissing =
    imageMask !== null && imageMask.path !== "" && missingAssets[imageMask.path] === true
  const imageMissing = image !== null && image.path !== "" && missingAssets[image.path] === true
  return maskMissing || imageMissing
}
