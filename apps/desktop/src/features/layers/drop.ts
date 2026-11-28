/**
 * 拖拽落点解析：把「拖到某行的哪个位置」翻译成「重挂到哪个父、在同级的第几下标」。
 *
 * 落点分三态（基于指针在目标行内的纵向位置，上 1/4 与下 1/4 为缘、中段占一半）：
 * - 上缘（top）  → 放到目标行**之前**，与目标行同级；
 * - 下缘（bottom）→ 放到目标行**之后**，与目标行同级；
 * - 中段（middle）→ 成为目标行的**子层**（追加到其子列表末尾）。
 *
 * 返回 `null` 表示本次拖拽是无操作或非法。深度上限不在本函数判定——它需要被移动子树的纵深，
 * 由调用方（`LayerList`）用 `exceedsNestDepth` 复核后再交给 store。
 *
 * 判定「某行是否在另一行的子树内」只用到展示顺序 + 深度：展示顺序里**父行先出、子树紧随其
 * 后**，故一棵子树的成员在它根的**下方**（下标更大）连续排列，且逐行深度都大于该根。
 */
import type { LayerRow } from "./order"

/** 落点相对目标行的纵向位置。 */
export type DropZone = "top" | "middle" | "bottom"

/**
 * 指针在目标行内的相对位置（0 = 顶边，1 = 底边）→ 三段落点。
 *
 * 上 25% / 中 50% / 下 25%：中段是「放进里面」，判定区最宽；上下缘留给同级插入。
 */
export function dropZoneAt(relativeY: number): DropZone {
  if (relativeY < 0.25) return "top"
  if (relativeY >= 0.75) return "bottom"
  return "middle"
}

/** 解析出的落位目标。 */
export interface DropTarget {
  /** 落位后的父层 id；顶层为 `null`。 */
  parentId: string | null
  /** 在父层子数组（或顶层数组）中的插入下标。 */
  index: number
}

/**
 * `activeIndex` 是否落在 `baseIndex` 所在行的子树内。
 *
 * 子树成员在展示顺序里位于其根的**下方**（下标更大），且逐行深度都大于根的深度：从根的下一位
 * 一直看到 `activeIndex`，一旦某行深度回落到 ≤ 根深度，说明已经离开这棵子树。
 */
function inSubtree(rows: readonly LayerRow[], activeIndex: number, baseIndex: number): boolean {
  if (activeIndex <= baseIndex) return false
  const baseDepth = rows[baseIndex].depth
  for (let i = baseIndex + 1; i <= activeIndex; i++) {
    if (rows[i].depth <= baseDepth) return false
  }
  return true
}

/**
 * 解析一次拖拽的落位目标。
 *
 * @param rows - 当前可见的展示行（{@link LayerRow} 数组，展示顺序）。
 * @param activeId - 被拖动行的 id。
 * @param overId - 指针所落目标行的 id。
 * @param zone - 指针落在目标行的上缘 / 中段 / 下缘。
 * @returns 落位目标；无操作或非法时返回 `null`。
 */
export function resolveDrop(
  rows: readonly LayerRow[],
  activeId: string,
  overId: string,
  zone: DropZone,
): DropTarget | null {
  const activeIndex = rows.findIndex((r) => r.id === activeId)
  const overIndex = rows.findIndex((r) => r.id === overId)
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return null

  // 被拖行是目标行的祖先 → 拖进自己的子树，任何落点都非法。
  if (inSubtree(rows, overIndex, activeIndex)) return null

  const over = rows[overIndex]
  if (zone === "middle") {
    // 目标行是被拖行的祖先 → 不能把祖先塞进后代里当子层，非法。
    if (inSubtree(rows, activeIndex, overIndex)) return null
    return { parentId: over.id, index: over.childCount }
  }

  // 同级之间，展示顺序是同级数组的**倒序**（顶行 = 同级里最上层 = 同级数组末位）。因此视觉上
  // 的「上缘」（更高一层）对应数组里更**大**的下标：插到目标行之后一位（`indexInParent + 1`）；
  // 「下缘」更低，对应目标行当前下标处。搞反会让「拖到上一行上缘」变成原地不动。
  return {
    parentId: over.parentId,
    index: zone === "top" ? over.indexInParent + 1 : over.indexInParent,
  }
}
