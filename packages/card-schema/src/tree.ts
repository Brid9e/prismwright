/**
 * 图层树的纯结构操作。
 *
 * 架构位置：数据层（`@prismwright/schema`）里的「树算法」——零依赖、零 IO，供渲染器（摊平出
 * 绘制顺序与祖先链）与编辑器（展示顺序、拖拽落位、深度校验）共用，避免两处各写一份遍历。
 */
import type { Layer } from "./types.js"
import { MAX_NEST_DEPTH } from "./schema.js"

/** 摊平后的一个图层条目：图层本体 + 它在树中的结构位置。 */
export interface FlatLayer {
  layer: Layer
  /**
   * 祖先链，从最外层到直接父层；顶层图层为空数组。
   *
   * 声明为只读：同一数组实例在兄弟条目间**共享**（顶层共享同一个 `[]`，子层共享父层追加后的
   * 数组），消费方若原地修改会静默污染其他条目，故导出边界上禁止写。
   */
  ancestors: readonly Layer[]
  /** 嵌套深度（顶层为 0，恒等于 `ancestors.length`）。 */
  depth: number
  /** 直接父层的 id；顶层为 `null`。 */
  parentId: string | null
  /** 在**同级**数组中的下标。 */
  indexInParent: number
}

/**
 * 把图层树按**深度优先**（父在前、子随后）摊平为一维序列。
 *
 * 顺序即渲染器的绘制顺序：父先画、子随后叠在其上。启用与否不在此过滤——本函数是「结构
 * 真相」，渲染与展示各自按需要再筛选（见 {@link isLayerVisible}）。
 *
 * @param layers - 顶层图层数组。
 * @returns 摊平后的条目数组。
 */
export function flattenLayers(layers: readonly Layer[]): FlatLayer[] {
  const out: FlatLayer[] = []
  const walk = (list: readonly Layer[], ancestors: readonly Layer[]): void => {
    list.forEach((layer, indexInParent) => {
      out.push({
        layer,
        ancestors,
        depth: ancestors.length,
        parentId: ancestors.length ? ancestors[ancestors.length - 1].id : null,
        indexInParent,
      })
      if (layer.children.length) walk(layer.children, [...ancestors, layer])
    })
  }
  walk(layers, [])
  return out
}

/** 该条目是否参与渲染：自身启用且**所有祖先**启用（禁用父层连同整棵子树一起隐藏）。 */
export function isLayerVisible(entry: FlatLayer): boolean {
  return entry.layer.enabled && entry.ancestors.every((a) => a.enabled)
}

/**
 * 按 id 查找图层；找不到返回 `null`。
 *
 * 之所以递归而非在摊平序列上做一次 `find`：store / 编辑器需要在**任意位置**（顶层或深层嵌套）
 * 定位图层，而它们手里的往往是原始树（未摊平），故必须逐层下钻子节点。此处是这份「全树定位」
 * 逻辑的唯一出处，供上层共用，避免各处重复遍历。
 */
export function findLayerById(layers: readonly Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer
    const hit = findLayerById(layer.children, id)
    if (hit) return hit
  }
  return null
}

/**
 * 定位某层的「所在数组与其下标」。
 *
 * @param layers - 顶层图层数组。
 * @returns 命中的**同级数组引用**（顶层时即传入的 `layers`）与下标；找不到返回 `null`。
 */
export function findLayerLocation(
  layers: Layer[],
  id: string,
): { siblings: Layer[]; index: number } | null {
  const index = layers.findIndex((l) => l.id === id)
  if (index !== -1) return { siblings: layers, index }
  for (const layer of layers) {
    const hit = findLayerLocation(layer.children, id)
    if (hit) return hit
  }
  return null
}

/**
 * 就地摘除 id 命中的子树并返回它。
 *
 * 用于移动（先摘后插）与删除（摘掉即弃）。
 *
 * @returns 被摘下的子树根；未命中返回 `null`。
 */
export function detachLayer(layers: Layer[], id: string): Layer | null {
  const located = findLayerLocation(layers, id)
  if (!located) return null
  const [removed] = located.siblings.splice(located.index, 1)
  return removed
}

/** 子树纵深：根记 0，等于从根到最深后代的边数（叶子为 0）。 */
export function subtreeHeight(layer: Layer): number {
  let height = 0
  for (const child of layer.children) {
    height = Math.max(height, 1 + subtreeHeight(child))
  }
  return height
}

/**
 * 某层的祖先链（最外层在前、直接父层在末）；未命中返回 `null`。
 *
 * 顶层图层返回 `[]`（而非 `null`）——「存在但无祖先」与「不存在」是两回事。
 */
export function ancestorChain(layers: readonly Layer[], id: string): readonly Layer[] | null {
  const entry = flattenLayers(layers).find((e) => e.layer.id === id)
  return entry ? entry.ancestors : null
}

/**
 * 把 `moved` 挂到「落位后将拥有 `ancestorCountAtTarget` 个祖先」的位置，是否会超过深度上限。
 *
 * 判定依据：被移动子树最深的后代在落位后的祖先数 = 该根落位后的祖先数 + 子树纵深，
 * 必须 ≤ {@link MAX_NEST_DEPTH}。
 */
export function exceedsNestDepth(moved: Layer, ancestorCountAtTarget: number): boolean {
  return ancestorCountAtTarget + subtreeHeight(moved) > MAX_NEST_DEPTH
}
