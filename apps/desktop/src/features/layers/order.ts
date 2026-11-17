/**
 * 图层列表的「展示顺序 ← 图层树」换算。
 *
 * 展示顺序要同时满足两条直觉：**顶行 = 最上层**（同级里绘制更晚的在上），且**父行排在其子行
 * 之上**（层级用缩进表达，父先于它的子树出现）。二者合起来给出一条确定的遍历规则——对**每一
 * 层同级**按数组倒序访问（末位 = 最上层，先出），且**先出父、再递归出它的子树**。
 *
 * 注意不能把整条深度优先序列一次性倒过来（那等于对全序列取反）：前者会顺带把子树整体翻到父行
 * **上方**，于是子层显示在父层上面，与「父上子下」相反。绘制顺序（`flattenLayers`）仍是深度
 * 优先、父在前子随后，那是渲染要的口径，两者不要混。
 *
 * 展开/折叠由调用方以「折叠集合」传入：任一祖先被折叠，其整棵子树都不出现在展示行里（折叠父行
 * 时其子树整体跳过）。每行另外带出结构信息（深度 / 父 id / 同级下标 / 子层数），供缩进渲染与
 * 拖拽落位使用。
 */
import type { Layer } from "@cardbara/schema"

/** 界面上的一个图层行：绘制序列倒序后的一行，附带缩进与落位所需的结构信息。 */
export interface LayerRow {
  id: string
  /** 嵌套深度（顶层为 0）。 */
  depth: number
  /** 直接父层的 id；顶层为 `null`。 */
  parentId: string | null
  /** 在**同级**数组中的下标。 */
  indexInParent: number
  /** 子层数量（判断是否画展开三角）。 */
  childCount: number
}

/**
 * 把图层树转成界面展示顺序（顶行在最上层，父行在其子树之上）。
 *
 * @param layers - 顶层图层数组。
 * @param collapsed - 已折叠的图层 id 集合；缺省视为全部展开。
 * @returns 展示行数组（不改动入参）。
 */
export function toDisplayOrder(
  layers: readonly Layer[],
  collapsed: ReadonlySet<string> = new Set(),
): LayerRow[] {
  const rows: LayerRow[] = []
  /**
   * 递归一段同级列表：倒序访问（同级里最上层先出），逐个「先父、再子树」。
   *
   * @param list - 当前同级的图层数组。
   * @param depth - 该层级的嵌套深度（顶层为 0）。
   * @param parentId - 该层级各行的父层 id；顶层为 `null`。
   */
  const walk = (list: readonly Layer[], depth: number, parentId: string | null): void => {
    for (let i = list.length - 1; i >= 0; i--) {
      const layer = list[i]
      rows.push({
        id: layer.id,
        depth,
        parentId,
        indexInParent: i,
        childCount: layer.children.length,
      })
      // 父行折叠 → 整棵子树跳过（子层同样不出现）。
      if (!collapsed.has(layer.id)) walk(layer.children, depth + 1, layer.id)
    }
  }
  walk(layers, 0, null)
  return rows
}
