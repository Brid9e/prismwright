/**
 * 蒙版擦除画布的纯几何 / 取值约定（与 React、canvas API 无关，便于单测）。
 *
 * 擦除图是一张**卡面比例的黑白图**：白 = 保留，黑 = 擦掉（见 schema 的 `MaskEraseParams`）。
 * 用户直接在这张图上画——画笔落点要从预览的射线 UV 换算到画布像素。
 *
 * 坐标约定与贴图一致：three 的纹理默认 `flipY`，着色器里的 `vUv.y = 0` 对应图片**底边**，
 * 而 canvas 的 `y = 0` 是**顶边**——故画布 y 要翻过来。
 */

/** 擦除画布宽度（像素）。高度按卡面比例推得。 */
export const ERASE_CANVAS_WIDTH = 500

/** 卡面宽高比（1 : 1.4），与渲染器的 `CARD_ASPECT` 同源。 */
const ERASE_CANVAS_ASPECT = 1.4

/** 擦除画布高度（像素）。 */
export const ERASE_CANVAS_HEIGHT = Math.round(ERASE_CANVAS_WIDTH * ERASE_CANVAS_ASPECT)

/**
 * 某宽高比下的擦除画布尺寸：宽固定 {@link ERASE_CANVAS_WIDTH}，高按卡面比例推得。
 *
 * 画布要与卡面同比例，UV 才能等比映射；比例非法（非正 / 非有限）时退回默认画布。
 */
export function eraseCanvasSize(cardAspect: number): { width: number; height: number } {
  if (!(cardAspect > 0) || !Number.isFinite(cardAspect)) {
    return { width: ERASE_CANVAS_WIDTH, height: ERASE_CANVAS_HEIGHT }
  }
  return {
    width: ERASE_CANVAS_WIDTH,
    height: Math.max(1, Math.round(ERASE_CANVAS_WIDTH / cardAspect)),
  }
}

/** 画笔直径（画布像素）：约卡宽的 8%，画一笔的宽度在预览上看接近手指粗细。 */
export const ERASE_BRUSH_WIDTH = 40

/** 画笔颜色：黑 = 擦除，白 = 恢复（擦掉的区域画回白色即重新出现）。 */
export function brushColor(restore: boolean): string {
  return restore ? "white" : "black"
}

/**
 * 是否处于「恢复」态：右键或按住 Alt。与常见图像编辑器一致。
 */
export function isRestoreGesture(e: { button: number; altKey: boolean }): boolean {
  return e.button === 2 || e.altKey
}

/**
 * 这一笔是否恢复（画白）而不是擦除（画黑）。
 *
 * 工具栏的「恢复笔」开关与手势是**异或**关系：开关关着时右键 / Alt 恢复（默认手感）；
 * 开关打开后整支笔变成恢复笔，此时右键 / Alt 反向为擦除——与常见绘图软件「修饰键临时
 * 反转当前工具」的约定一致。
 *
 * @param restoreMode - 浮条上的「恢复笔」是否打开。
 * @param gesture - 本次按下的按钮与修饰键（取 `button` 与 `altKey`）。
 */
export function isRestoreStroke(
  restoreMode: boolean,
  gesture: { button: number; altKey: boolean },
): boolean {
  return restoreMode !== isRestoreGesture(gesture)
}

/**
 * 卡面 UV → 擦除画布像素坐标。
 *
 * 越界（指针不在卡面上）或尺寸非法时返回 `null`——调用方据此跳过这一笔，而不是把线
 * 画到画布边缘之外。
 *
 * @param u - 卡面 UV 的横向分量（0 = 左缘）。
 * @param v - 卡面 UV 的纵向分量（0 = **底边**，见文件头）。
 * @returns 画布像素坐标（左上原点），或 `null`。
 */
export function uvToCanvasPoint(
  u: number,
  v: number,
  width: number = ERASE_CANVAS_WIDTH,
  height: number = ERASE_CANVAS_HEIGHT,
): { x: number; y: number } | null {
  if (!(width > 0) || !(height > 0)) return null
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  return {
    x: Math.min(width - 1, Math.floor(u * width)),
    y: Math.min(height - 1, Math.floor((1 - v) * height)),
  }
}

/**
 * 「擦除画布像素 → 屏幕像素」的比例，用于把画笔宽度画成看得见的范围圈。
 *
 * @param screenWidth - 卡面在屏幕上的宽（CSS 像素），由 UV 两端点反投影量得。
 * @param screenHeight - 卡面在屏幕上的高。
 * @param canvasWidth - 擦除画布宽（像素）。
 * @param canvasHeight - 擦除画布高（像素）。
 * @returns 比例；任一尺寸非正 / 非有限时返回 `null`（调用方据此不画圈）。
 *
 * 横竖各求一次再取**几何平均**：卡面倾斜时两个方向被透视缩短的程度不同，只信宽度会在
 * 横向倾斜时画出偏大的圈。几何平均对两边是对称的，正视角下则正好等于两者的共同值。
 */
export function canvasToScreenScale(
  screenWidth: number,
  screenHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): number | null {
  const sx = screenWidth / canvasWidth
  const sy = screenHeight / canvasHeight
  if (!(sx > 0) || !(sy > 0) || !Number.isFinite(sx) || !Number.isFinite(sy)) return null
  return Math.sqrt(sx * sy)
}
