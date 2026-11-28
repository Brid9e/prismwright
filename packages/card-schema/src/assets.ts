/**
 * 卡面引用的资源路径收集。
 *
 * 纯函数：只读入数据、只产出字符串，不做任何文件系统访问。桌面端（删除卡片时移入回收站、
 * 发布时处理图片）与小程序端（按卡预热资源）用的是**同一份判定**——少收一个路径的后果是
 * 「某张卡偶发缺图」，那种 bug 在两个实现里各写一遍几乎必然漂移，所以放在这里。
 *
 * 路径为空的 `imageMask` / `image` / `maskErase` 是「已添加但还没选图/还没画」的中间态，
 * 一律跳过，避免把无意义的空串交给下游 IO。
 */
import { resolveEraseMask, resolveImage, resolveImageMask } from "./effects.js"
import { flattenLayers } from "./tree.js"
import type { Card, CardFace, Pack } from "./types.js"

/**
 * 收集单个卡面（卡片正面或系列背面）引用的资源相对路径。
 *
 * 顺序为图层树的深度优先顺序（图面、图片、蒙版、擦除图）。卡面已没有独立的前景图字段。
 *
 * @param face - 卡面对象（卡片或系列背面，二者结构相同）。
 * @returns 该卡面引用的相对路径数组（可能含重复，交给调用方去重）。
 */
export function collectFaceAssets(face: CardFace): string[] {
  const rels: string[] = []
  // 摊平后逐层收集：老数据无子层，等价于扁平遍历；有子层时子树里的资源也被收全。
  for (const { layer } of flattenLayers(face.layers)) {
    const mask = resolveImageMask(layer.effects)
    if (mask?.path) rels.push(mask.path)
    const image = resolveImage(layer.effects)
    if (image?.path) rels.push(image.path)
    if (image?.normalPath) rels.push(image.normalPath)
    const layerErase = resolveEraseMask(layer.effects)
    if (layerErase?.path) rels.push(layerErase.path)
  }
  return rels
}

/**
 * 收集单张卡片引用的资源相对路径。
 *
 * 卡片在结构上就是「带身份信息的卡面」，故直接委托；保留本函数是为了给调用方一个语义
 * 清晰的入口，也为将来卡片若引入额外资源（如缩略图）留下扩展点。
 *
 * @param card - 卡片对象。
 * @returns 该卡片引用的相对路径数组。
 */
export function collectCardAssets(card: Card): string[] {
  return collectFaceAssets(card)
}

/**
 * 收集整个系列引用的全部资源相对路径，并按路径去重（首次出现的顺序）。
 *
 * @param pack - 仅取用 `cards` / `hiddenCards` / `back` 三个字段，便于测试构造轻量对象。
 * @returns 去重后的相对路径数组。
 */
export function collectPackAssets(
  pack: Pick<Pack, "cards" | "hiddenCards" | "back">,
): string[] {
  const set = new Set<string>()
  for (const card of pack.cards) {
    for (const rel of collectCardAssets(card)) set.add(rel)
  }
  for (const card of pack.hiddenCards) {
    for (const rel of collectCardAssets(card)) set.add(rel)
  }
  if (pack.back) {
    for (const rel of collectFaceAssets(pack.back)) set.add(rel)
  }
  return [...set]
}

/**
 * 收集系列封面与卡包图引用的相对路径（大封面、小封面、卡包图，按路径去重）。
 *
 * 与 {@link collectPackAssets} 互不包含：这些图不走 WebP 重编码管线（GIF 会掉动画、
 * PNG 会掉透明通道），所以两处必须分开收集。
 */
export function collectCoverAssets(
  pack: Pick<Pack, "coverLarge" | "coverSmall" | "packArt"> & {
    avatarFrame?: string
    achievementIcon?: string
    seriesAvatar?: string
  },
): string[] {
  const out = [
    pack.coverLarge,
    pack.coverSmall,
    pack.packArt,
    pack.avatarFrame ?? "",
    pack.achievementIcon ?? "",
    pack.seriesAvatar ?? "",
  ].filter((rel) => rel !== "")
  return [...new Set(out)]
}
