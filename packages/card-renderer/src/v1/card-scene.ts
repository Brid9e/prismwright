/**
 * 卡面场景的共享常量与脚手架——被交互视图（`card-view`）与离屏渲染（`frame-renderer`）共同引用。
 *
 * 抽出来的理由：卡面平面宽高比、图层 z 步进、相机视场角、占位纹理这几样，是「一张卡怎么搭」的
 * 既定事实。交互预览与后台导出必须一致，否则同一张卡在两处会长得不一样——放在一处即单一来源。
 */
import {
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  Shape,
  type Texture,
} from "three"

/** 卡面默认宽高比（宽/高），在卡面纹理加载完成前占位（= 2.5/3.5）。 */
export const CARD_ASPECT = 2.5 / 3.5

/** 图层平面相对卡面的 Z 微偏移，避免共面 z-fighting。 */
export const LAYER_Z_STEP = 0.001

/**
 * 相机竖直视场角（度）。
 *
 * 交互视图直接用它取景；离屏导出改用「贴合卡面的视场角」（见 `frame-renderer`），但相机**位置**
 * 仍停在交互视图的基准距离，故两处的 `uCameraPosition` 一致、全息观感相同。
 */
export const CAMERA_FOV = 35

/**
 * 「贴合卡面」的相机竖直视场角（度）：在距离 `distance` 处让高 `planeHeight` 的平面**正好填满**
 * 竖直视野（不余白、不裁切）。
 *
 * 交互视图用固定 {@link CAMERA_FOV} 取景（留白给倾斜与摆动）；离屏导出要的是「卡面即画幅」的
 * 抠图，故改用这里的角度。相机**位置**仍停在基准距离（见 `frame-renderer`），于是两处的
 * `uCameraPosition` 一致、全息观感相同——差别只在取景角度。
 *
 * 推导：距离 `d` 处可见的竖直半高为 `d * tan(fov/2)`，令其等于 `planeHeight / 2` 反解即得。
 *
 * @param planeHeight - 卡面平面在世界坐标里的高（本工程恒为 `1`，见 `PlaneGeometry` 的构造）。
 * @param distance - 相机到卡面的距离（正数）。
 * @returns 竖直视场角（度）。
 */
export function fitFov(planeHeight: number, distance: number): number {
  return (2 * Math.atan(planeHeight / 2 / distance) * 180) / Math.PI
}

/**
 * 卡片厚度（卡高单位：卡高 = 1）。
 *
 * 按真实比例算是 0.76mm / 88mm ≈ 0.0086，但照搬那套「真实」在屏幕上显得偏厚——倾斜时像
 * 一块小砖头，圆角侧壁尤其显厚。2026-10-29 从 0.015 减半到 0.0075，2026-11-06 再减到 0.003
 * （≈ 0.26mm，视觉上就是一张卡纸的边缘）；0.003 在真机上又薄到几乎看不出边，2026-11-12
 * 回调到 0.006（≈ 0.53mm，倾斜时能看清是一条浅色切边）。
 * 这是目测值，不是推导值；改它应当是有意为之（只有倾斜时才看得见，正视角导出不受影响）。
 */
export const CARD_THICKNESS = 0.006

/**
 * 卡片侧壁的颜色。
 *
 * 真卡的切边不是白的：面纸之间夹着一层深色卡芯（游戏王那种，仿卡往往没有这层，
 * 切边发白），倾斜时看过去是一条深色细线。这里取近黑的炭灰。
 * 曾经用过浅灰白 `#e6e6ea`，在浅色页面底上倾斜时整条边直接糊没了。
 */
export const CARD_EDGE_COLOR = 0x2e2e36

/**
 * 把圆角半径夹进卡面几何允许的范围：`[0, min(卡宽一半, 0.5)]`。
 *
 * 圆角半径与卡面同口径（卡高单位），但卡可以窄到 0.5 甚至更窄——半宽 0.25 的卡摆不下
 * 半径 0.4 的圆角。超过半宽时切线长度为负、几何会自交；着色器的圆角遮罩也必须用**同一夹取后**
 * 的值，否则遮罩与侧壁对不上，圆角处会露出一圈边。`createCardSlab` 与各材质都走这里。
 */
export function clampCornerRadius(aspect: number, cornerRadius: number): number {
  return Math.max(0, Math.min(cornerRadius, aspect / 2, 0.5))
}

/**
 * 创建「卡片厚度」的侧壁网格：把圆角矩形沿 -Z 挤出一层薄板，放进卡面之后。
 *
 * 只画侧壁——前盖与后盖的材质 `visible = false`。理由：封盖一旦可见，就会在卡面的镂空处、
 * 圆角之外的透明区垫一层实色，把「透明 PNG 」这件事实直接毁掉；而侧壁在正视角下与视线平行、
 * 投不出像素，所以正视角导出与加厚度之前逐像素一致，倾斜时才露出那条边。
 *
 * 位置：前盖与卡面平面共面于 z = 0、后盖在 z = -{@link CARD_THICKNESS}。前盖不可见，
 * 故与卡面共面不会 z-fighting。
 *
 * @param aspect - 卡面宽高比（宽/高）。
 * @param cornerRadius - 圆角半径（与着色器 `uCornerRadius` 同一口径，卡高单位）。
 * @returns 可直接加进场景的网格；调用方需与卡面同步旋转，并在销毁时释放其几何与材质。
 */
export function createCardSlab(aspect: number, cornerRadius: number): Mesh {
  // 半径夹到半宽 / 半高以内（见 clampCornerRadius）：超过就画不出圆角矩形、几何会自交。
  const radius = clampCornerRadius(aspect, cornerRadius)
  const x = aspect / 2
  const y = 0.5
  const shape = new Shape()
  // 圆角必须是**正圆弧**，不能用二次贝塞尔近似：贝塞尔在 45° 处比正圆外凸约 6% 半径
  // （半径 0.06 时外凸 0.0036 卡高），而卡面的圆角遮盖是精确的圆——探出的这一圈正好在
  // 四角露出侧壁的浅色切边，看起来就是「圆角处有白边」。直边两者天然重合，所以只有角上有。
  shape.moveTo(-x + radius, -y)
  shape.lineTo(x - radius, -y)
  shape.absarc(x - radius, -y + radius, radius, -Math.PI / 2, 0, false)
  shape.lineTo(x, y - radius)
  shape.absarc(x - radius, y - radius, radius, 0, Math.PI / 2, false)
  shape.lineTo(-x + radius, y)
  shape.absarc(-x + radius, y - radius, radius, Math.PI / 2, Math.PI, false)
  shape.lineTo(-x, -y + radius)
  shape.absarc(-x + radius, -y + radius, radius, Math.PI, (3 * Math.PI) / 2, false)

  // 圆角按折线挤出：段数少了，倾斜时侧壁的轮廓就是一串折角（8 段时相邻两段差 13°，
  // 肉眼能数出来）。24 段把这个角度压到 4° 上下，几何仍然只有几百个顶点。
  const geometry = new ExtrudeGeometry(shape, {
    depth: CARD_THICKNESS,
    bevelEnabled: false,
    curveSegments: 24,
  })
  // 挤出从 z = 0 长到 z = depth；整体后移，使前盖落在卡面所在的 z = 0。
  geometry.translate(0, 0, -CARD_THICKNESS)

  // ExtrudeGeometry 的材质组：0 = 前盖 + 后盖，1 = 侧壁。
  const caps = new MeshBasicMaterial()
  caps.visible = false
  const sides = new MeshBasicMaterial({ color: CARD_EDGE_COLOR, side: DoubleSide })
  return new Mesh(geometry, [caps, sides])
}

/**
 * 卡面默认底色（深灰 `#282830`）。
 *
 * 两处共用：① 没有底图时的 1×1 占位纹理；② 底图没覆盖到的区域（适应模式留白、缩小 /
 * 旋转露出的角）垫的底色。两处取同一个值，观感上才像「一张卡」，而不是「一张卡 + 一块补丁」。
 */
export const CARD_BACKGROUND_COLOR = 0x282830

/** 创建 1×1 {@link CARD_BACKGROUND_COLOR} 占位纹理，避免材质出现真空底图。 */
export function createPlaceholderTexture(): Texture {
  const tex = new DataTexture(new Uint8Array([0x28, 0x28, 0x30, 0xff]), 1, 1, RGBAFormat)
  tex.needsUpdate = true
  return tex
}
