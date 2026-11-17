/**
 * 拾色：客户端坐标 → 归一化设备坐标（NDC）。
 *
 * 吸管（在卡面原图上取色）与将来的画笔（在蒙版上擦除）都要先把指针位置换成卡面 UV：
 * 客户端坐标 → NDC → 射线 → 卡面交点 → 几何 uv。这里只做第一步，余下交给 three 的
 * `Raycaster`——这一步是唯一容易写错又难从画面归因的数学（轴向 / 比例）。
 */

/** 元素在视口里的位置与尺寸（CSS 像素），即 `getBoundingClientRect()` 的投影。 */
export interface PickRect {
  left: number
  top: number
  width: number
  height: number
}

/** 画布坐标的 NDC（x 向右、y 向上，范围 [-1, 1]）。 */
export interface Ndc {
  x: number
  y: number
}

/**
 * 把客户端坐标换算成 NDC。
 *
 * 尺寸非正（尚未布局）或非有限时返回 `null`：交给 raycast 只会得到 NaN 射线，
 * 那种失败在运行时既无声又难查。
 */
export function clientToNdc(clientX: number, clientY: number, rect: PickRect): Ndc | null {
  const { left, top, width, height } = rect
  if (!(width > 0) || !(height > 0)) return null
  return {
    x: ((clientX - left) / width) * 2 - 1,
    // 屏幕 y 向下、NDC y 向上，故取反。
    y: -((clientY - top) / height) * 2 + 1,
  }
}

/**
 * 把 NDC 换回客户端坐标（{@link clientToNdc} 的逆运算）。
 *
 * 用途是**反投影**：预览里的画笔范围圈要知道「卡面上的一段像素在屏幕上是多长」，
 * 只能把卡面 UV 投回屏幕再量距离。尺寸非正时返回 `null`，与正向同一道防线。
 */
export function ndcToClient(ndc: Ndc, rect: PickRect): { x: number; y: number } | null {
  const { left, top, width, height } = rect
  if (!(width > 0) || !(height > 0)) return null
  return {
    x: left + ((ndc.x + 1) / 2) * width,
    // 屏幕 y 向下、NDC y 向上，故取反（与 clientToNdc 对应）。
    y: top + ((1 - ndc.y) / 2) * height,
  }
}
