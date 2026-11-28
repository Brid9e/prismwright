/**
 * 缩放映射（纯函数，零 three 依赖）。
 *
 * 缩放以「推拉相机」实现：卡片平面在世界坐标里的尺寸恒定（`PlaneGeometry(aspect, 1)`），
 * 改的是相机到卡面的距离。不用 `PerspectiveCamera.zoom` 是因为那个只缩投影矩阵，
 * 而卡面的高光着色依赖 `uCameraPosition`（见 `card-view.ts` 的 `updateUniforms`）——
 * 推拉会让高光跟着动，视觉上才像「凑近看」。
 */

/** 相机到卡面的基准距离，即 `zoom === 1` 时的 z。与初版写死的 4 一致。 */
export const BASE_DISTANCE = 4

/** 最小缩放：再小卡片就淹没在预览面板里了。 */
export const MIN_ZOOM = 0.5

/** 最大缩放：再大卡片会被面板裁掉太多。 */
export const MAX_ZOOM = 4

/**
 * 把缩放倍数夹到 `[MIN_ZOOM, MAX_ZOOM]`。
 *
 * 非有限值（`NaN` / `±Infinity`）回落到 `1`：视口尺寸、滑杆值都可能传入这类值，
 * 而 `NaN` 一旦进了相机坐标，整场渲染会静默变黑——那是最难查的一类故障。
 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * 缩放倍数 → 相机到卡面的距离（zoom 越大越近）。
 *
 * `fitDistance` 抬高 `zoom = 1` 的基准：宽卡 / 窄画幅下整张卡刚好进画面的距离可能比
 * {@link BASE_DISTANCE} 更远，取较大者保证 1 倍时完整可见。`zoom > 1` 后按同一基准
 * 继续拉近并裁切边缘，不再被 fit 距离钉住——这是「放大到 400%」能真正生效的前提。
 *
 * @param zoom - 缩放倍数；先经 {@link clampZoom} 夹取。
 * @param fitDistance - 整卡贴合所需的最小距离；省略或 0 时退回 {@link BASE_DISTANCE}。
 * @returns 相机的 z 坐标（正数）。
 */
export function zoomToCameraDistance(zoom: number, fitDistance = 0): number {
  const base = Math.max(BASE_DISTANCE, fitDistance)
  return base / clampZoom(zoom)
}

/**
 * 让整张卡（宽 `cardAspect`、高 1）都进画幅所需的最小相机距离。
 *
 * 固定视场角取景时，卡高 1 在基准距离 4 处只占视野的一半不到，画幅随窗口变化也不至于裁掉；
 * 但宽高比可调的卡可以很宽（或画幅很窄），此时左右边缘会先溢出。此函数按「可见半宽 /
 * 半高 ≥ 卡的一半 × 边距」反解距离，调用方与缩放距离取 `max`——缩得不比它更近即可。
 *
 * 输入不可用（非有限、非正）时返回 0，调用方的 `max` 于是无效果，退化为原取景。
 *
 * @param cardAspect - 卡面宽高比（宽/高）。
 * @param viewportAspect - 视口宽高比（画布宽/高）。
 * @param fovDeg - 相机竖直视场角（度）。
 * @param margin - 四周安全边距（倍率，默认 1.15）。
 * @returns 相机到卡面的最小距离（非负）。
 */
export function fitCameraDistance(
  cardAspect: number,
  viewportAspect: number,
  fovDeg: number,
  margin = 1.15,
): number {
  if (!(cardAspect > 0) || !(viewportAspect > 0) || !Number.isFinite(fovDeg)) return 0
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360)
  if (!(tanHalf > 0)) return 0
  const byHeight = (0.5 * margin) / tanHalf
  const byWidth = (cardAspect * 0.5 * margin) / (tanHalf * viewportAspect)
  return Math.max(byHeight, byWidth)
}
