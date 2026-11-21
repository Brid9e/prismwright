/**
 * 离屏逐帧渲染：把一张卡面渲成确定性的位图——默认正视角、默认透明通道；倾角与纯色背景可按需覆盖。
 *
 * 与交互视图（`card-view`）的分工：交互视图服务于「看着它转」，帧渲染器服务于「把它抠出来」——
 * 背景资产（最近打开缩略、以后移动端集卡展示）要的是同一张卡在每一处长得一模一样，故这里
 * **默认不倾斜、不摆动、不跟随指针**，永远从正前方看；但导出需要「转动的静卡」时，可经
 * {@link CardFrameRenderer.renderPng} 的第二参逐帧喂入倾角（见 `tilt.ts` 的 `exportSway`）——
 * 帧渲染器因此既能抠正视角静帧，也能渲摆动的帧序列。
 *
 * 三点保证「导出的卡与预览里的卡是同一张」：
 * - 相机**位置**停在交互视图的基准距离（`zoom === 1` 即 {@link BASE_DISTANCE}）。全息高光依赖
 *   `uCameraPosition`，位置一致，观感才一致（见 `zoom.ts` 的说明）。
 * - 取景改用「贴合卡面」的视场角（{@link fitFov}），于是卡面正好填满画幅——没有为了让高光
 *   相同而被迫保留的余白。
 * - 材质、圆角、图层栈一律走与交互视图同一批工厂（`createBaseMaterial` / `createLayerMaterial`），
 *   常量取自 {@link ./card-scene}。两处不可能「各搭各的」。
 *
 * 时间项（`time`）只喂给图层材质：`time === 0` 时逐像素与静态预览一致，逐帧递增即得「静卡·
 * 全息流动」，供编成透明 WebM。卡面底图不随时间变化，故不给它接 `uTime`。
 */
import {
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type ShaderMaterial,
} from "three"
import {
  flattenLayers,
  isLayerVisible,
  resolveEraseMask,
  resolveImage,
  resolveImageMask,
  type CardFace,
} from "@prismwright/schema"
import type { ResolveAsset } from "./types"
import { TextureCache } from "./textures"
import { TextTextureCache } from "./text-texture"
import { createBaseMaterial } from "./materials/base-material"
import { createLayerMaterial, type AncestorMask } from "./materials/layer-material"
import {
  EDGE_BEVEL_RENDER_ORDER,
  createEdgeBevelMaterial,
} from "./materials/edge-bevel-material"
import {
  GLASS_OVERLAY_RENDER_ORDER,
  createGlassOverlayMaterial,
} from "./materials/glass-overlay-material"
import { createEnvironmentTexture } from "./environment"
import { glossMaskParams } from "./effects/gloss-mask"
import { BASE_DISTANCE } from "./zoom"
import {
  CARD_ASPECT,
  LAYER_Z_STEP,
  clampCornerRadius,
  createCardSlab,
  createPlaceholderTexture,
  fitFov,
} from "./card-scene"
import type { Tilt } from "./tilt"

/**
 * 带倾角的导出所用相机距离余量（倍率）。
 *
 * 摆动时卡面绕中心旋转，透视下近侧边缘会比平视时更贴近画幅边缘，故后退 6% 留余量。
 * **只在带倾角的导出路径上用**（`cameraMargin` 传入）；PNG 平视导出保持 `1`（零余量，
 * 与既有预览逐像素一致）。此值在实现阶段目测敲定：若实测不溢出可调回 `1`。
 */
export const EXPORT_CAMERA_MARGIN = 1.06

/** {@link createCardFrameRenderer} 的选项。 */
export interface CardFrameRendererOptions {
  /** 要渲染的卡面。 */
  card: CardFace
  /** 资源解析器（与交互视图同一份语义，见 {@link ResolveAsset}）。 */
  resolveAsset: ResolveAsset
  /** 输出位图宽度（像素）；高度按卡面宽高比推得并取整。 */
  width: number
  /** 卡面宽高比（宽/高，默认 `CARD_ASPECT` 即 5:7）。 */
  aspect?: number
  /** 圆角半径（卡高单位，默认 `0.06`，与交互视图一致；按卡宽一半夹取）。 */
  cornerRadius?: number
  /**
   * 背景：`null` / 省略 = 透明（默认，与既有预览一致）；纯色 hex 时卡面圆角之外即该底色。
   * 供导出选择「透明 / 纯色」。
   */
  background?: string | null
  /**
   * 相机距离余量（倍率，默认 `1`）：`> 1` 时相机后退，卡面四周留出空白。
   *
   * 平视渲染不需要它（卡面正好铺满画幅）；带倾角时近侧边缘在透视下可能略溢出，故导出路径
   * 传 {@link EXPORT_CAMERA_MARGIN} 留一点余量。默认 `1` 时逐像素与既有离屏渲染一致。
   */
  cameraMargin?: number
}

/** 离屏帧渲染器句柄。 */
export interface CardFrameRenderer {
  /**
   * 渲染一帧并返回 PNG 位图。
   *
   * @param time - 相位时间（秒）。`0` = 静态（与预览一致）；逐帧递增即「全息流动」。
   * @param tilt - 可选倾角（弧度）。省略 = `{ x: 0, y: 0 }`，与既有正视角渲染逐像素一致；
   *   传入即让卡面连同全部图层一起绕 X / Y 轴转动，供「摆动的导出」逐帧取姿态。
   * @returns 该帧的 PNG `Blob`。
   */
  renderPng(time: number, tilt?: Tilt): Promise<Blob>
  /** 销毁：释放 GPU 资源与纹理缓存。 */
  dispose(): void
}

/**
 * 创建离屏帧渲染器。构建是异步的（要解析卡面与各层蒙版纹理）。
 *
 * @param opts - 见 {@link CardFrameRendererOptions}。
 * @returns 帧渲染器句柄；调用方负责在结束后 {@link CardFrameRenderer.dispose}。
 */
export async function createCardFrameRenderer(
  opts: CardFrameRendererOptions,
): Promise<CardFrameRenderer> {
  const { card, resolveAsset } = opts
  const aspect = opts.aspect ?? CARD_ASPECT
  const cornerRadius = clampCornerRadius(aspect, opts.cornerRadius ?? 0.06)
  const background = opts.background ?? null
  const cameraMargin = opts.cameraMargin ?? 1
  const width = Math.max(1, Math.round(opts.width))
  const height = Math.max(1, Math.round(width / aspect))

  // 离屏画布：不挂进文档，故不参与合成。`preserveDrawingBuffer` 必需——`toBlob` 在 `render()`
  // 返回后的**另一拍**读像素，若不保留缓冲，读到的可能已是清空后的空白帧（透明 PNG）。
  const canvas = document.createElement("canvas")
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  // 背景：默认透明（导出 GIF 想抠图时的既有语义）；给了纯色就铺满清屏色，卡面圆角之外即底色。
  if (background) renderer.setClearColor(background, 1)
  else renderer.setClearAlpha(0)

  const scene = new Scene()
  // 位置钉在基准距离（预览 zoom=1 的同一处）再乘取景余量；取景角仍按基准距离的「贴合卡面」
  // 计算，于是相机后退多少、卡面四周就留多少空白（余量与观感的换算见 exportSway 的导出路径）。
  const distance = BASE_DISTANCE * cameraMargin
  const camera = new PerspectiveCamera(fitFov(1, BASE_DISTANCE), aspect, 0.1, 100)
  camera.position.set(0, 0, distance)

  const geometry = new PlaneGeometry(aspect, 1)
  // 玻璃卡的内置环境贴图（与交互视图同一份生成逻辑）。
  const envMap = createEnvironmentTexture()
  const cache = new TextureCache(resolveAsset)
  /** 文字纹理缓存：导出与预览走同一份缓存规则。 */
  const textCache = new TextTextureCache({ aspect })
  const placeholderTexture = createPlaceholderTexture()

  const baseMesh = new Mesh(geometry)
  baseMesh.renderOrder = 0
  scene.add(baseMesh)

  // 厚度（与交互视图同一块板，见 card-scene）。默认隐藏：平视导出要的是「与加厚度之前逐像素
  // 一致」的抠图，只有真的传了倾角（GIF / WebM 的摆动帧）才让它出场。
  const slab = createCardSlab(aspect, cornerRadius)
  slab.renderOrder = -1
  slab.visible = false
  scene.add(slab)

  // 边缘假倒角：与交互视图同一份材质；平视保留淡倒角，倾斜时增强。
  const edgeMat = createEdgeBevelMaterial({
    aspect,
    cornerRadius,
    lightAngle: card.frontBumpLightAngle,
  })
  const edgeMesh = new Mesh(geometry, edgeMat)
  edgeMesh.renderOrder = EDGE_BEVEL_RENDER_ORDER
  edgeMesh.raycast = () => {}
  edgeMesh.visible = true
  edgeMat.uniforms.uTilt.value = 0.25
  scene.add(edgeMesh)

  // 玻璃反射层：平视也保留，倾斜时反射随视角扫过环境图。
  const glassMat = createGlassOverlayMaterial({
    envMap,
    aspect,
    cornerRadius,
    strength: card.glassStrength,
    roughness: card.glassRoughness,
    tint: card.glassTint,
  })
  const glassMesh = new Mesh(geometry, glassMat)
  glassMesh.renderOrder = GLASS_OVERLAY_RENDER_ORDER
  glassMesh.raycast = () => {}
  glassMesh.visible = card.finish === "glass"
  scene.add(glassMesh)
  glassMat.uniforms.uCameraPosition.value.copy(camera.position)

  const layerGroup: Mesh[] = []
  const layerMats: ShaderMaterial[] = []
  let baseMat: ShaderMaterial | null = null
  let disposed = false

  try {
    // 卡面与卡面蒙版一并解析（与交互视图同构：蒙版从效果列表取得，不再是卡面专属字段）。
    // 法线贴图走 "data"（方向数据，不能 sRGB 解码），与交互视图同一口径。
    const [front, frontMask, erase, faceNormal] = await Promise.all([
      cache.get(card.front, "color"),
      cache.get(resolveImageMask(card.effects)?.path ?? "", "data"),
      // 擦除也要一起解析：漏了这条，导出结果会比预览里多出被擦掉的部分。
      cache.get(resolveEraseMask(card.effects)?.path ?? "", "data"),
      cache.get(card.frontNormalPath, "data"),
    ])
    baseMat = createBaseMaterial({
      map: front ?? placeholderTexture,
      aspect,
      cornerRadius,
      effects: card.effects,
      mask: frontMask,
      erase,
      // 与交互视图同构：无底图时按拉伸，避免占位纹理被「适应」裁掉。
      frontFit: front ? card.frontFit : "stretch",
      frontOffsetX: card.frontOffsetX,
      frontOffsetY: card.frontOffsetY,
      frontScale: card.frontScale,
      frontRotation: card.frontRotation,
      // 法线（bump）：与预览视图同构，导出画面才能和预览对上。
      frontBumpStrength: card.frontBumpStrength,
      frontBumpDetail: card.frontBumpDetail,
      frontBumpFlow: card.frontBumpFlow,
      frontBumpLight: card.frontBumpLight,
      frontBumpLightAngle: card.frontBumpLightAngle,
      frontBumpLightColor: card.frontBumpLightColor,
      frontBumpInvert: card.frontBumpInvert,
      // 法线贴图：导出与预览同源（选了就接替亮度伪法线）。
      frontNormalPath: card.frontNormalPath,
      frontNormalFlipY: card.frontNormalFlipY,
      normal: faceNormal,
      frontValid: front !== null,
    })
    baseMesh.material = baseMat
    // 相机固定不动，故位置只需写入一次（交互视图则逐帧同步）。卡面与图层都读它做高光/反射。
    baseMat.uniforms.uCameraPosition.value.copy(camera.position)

    // 树 → 线性绘制序列：深度优先、父在前子随后；禁用的层连同整棵子树一起跳过。z 与 renderOrder
    // 用过滤后的连续下标驱动（与交互视图同一套编号规则），保证图层前后关系两处一致。
    const entries = flattenLayers(card.layers).filter(isLayerVisible)
    let z = LAYER_Z_STEP
    for (let i = 0; i < entries.length; i++) {
      const { layer, ancestors } = entries[i]
      // 本层图片效果：与蒙版一并解析，走 sRGB（与交互视图同构）。
      const image = resolveImage(layer.effects)
      // 本层蒙版 + 全部祖先蒙版 + 本层图片 + 本层与祖先的擦除图一并解析（父在子前摊平，
      // 祖先纹理此时必然已就绪）。
      const [masks, imageTexture, ownErase, ancestorErases, layerNormal] = await Promise.all([
        Promise.all([
          cache.get(resolveImageMask(layer.effects)?.path ?? "", "data"),
          ...ancestors.map((a) => cache.get(resolveImageMask(a.effects)?.path ?? "", "data")),
        ]),
        cache.get(image?.path ?? "", "color"),
        cache.get(resolveEraseMask(layer.effects)?.path ?? "", "data"),
        Promise.all(
          ancestors.map((a) => cache.get(resolveEraseMask(a.effects)?.path ?? "", "data")),
        ),
        // 本层自己的法线贴图（方向数据，走 "data"）。
        cache.get(image?.normalPath ?? "", "data"),
      ])
      const ancestorMasks: AncestorMask[] = ancestors.map((a, k) => ({
        imageMask: resolveImageMask(a.effects),
        mask: masks[k + 1],
        erase: ancestorErases[k],
        // 文字蒙版向下裁切子树（与交互视图同构）。
        textMask: a.kind === "text" && a.text?.asMask ? textCache.get(a) : null,
        // 祖先的「作为蒙版」光泽（与交互视图同构）。
        glossMasks: glossMaskParams(a.effects),
      }))
      const mat = createLayerMaterial({
        layer,
        mask: masks[0],
        ancestors: ancestorMasks,
        maskPlaceholder: placeholderTexture,
        front,
        // 整卡擦除：与卡面材质同一张（与交互视图一致）。
        erase,
        // 本层自己的擦除图：与整卡那张相乘（与交互视图一致）。
        layerErase: ownErase,
        effects: layer.effects,
        // 卡面 moire 作为继承源：本层无 moire 时整体取它（与交互视图一致）。
        inheritedMoire: card.effects,
        image: imageTexture && image ? { texture: imageTexture, params: image } : null,
        // 本层文字纹理：导出与预览走同一份缓存规则。
        text: textCache.get(layer),
        // 本层自己的法线贴图 / 本面的（继承用）：导出与预览同一口径。
        normal: layerNormal,
        faceNormal,
        // 本面数据：法线继承源（与预览视图一致）。
        face: card,
        aspect,
        cornerRadius,
      })
      const mesh = new Mesh(geometry, mat)
      mesh.position.z = z
      mesh.renderOrder = i + 1
      scene.add(mesh)
      layerGroup.push(mesh)
      layerMats.push(mat)
      z += LAYER_Z_STEP
    }

    // 相机固定不动，故位置只需写入一次（交互视图则逐帧同步）。
    for (const mat of layerMats) mat.uniforms.uCameraPosition.value.copy(camera.position)
  } catch (err) {
    // 构建中途失败：把已建资源释放掉再抛出，避免半成品 canvas 与纹理泄漏。
    dispose()
    throw err
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const m of layerGroup) scene.remove(m)
    for (const mat of layerMats) mat.dispose()
    baseMat?.dispose()
    scene.remove(edgeMesh)
    edgeMat.dispose()
    scene.remove(glassMesh)
    glassMat.dispose()
    envMap.dispose()
    scene.remove(slab)
    slab.geometry.dispose()
    for (const mat of slab.material as unknown[]) (mat as { dispose(): void }).dispose()
    geometry.dispose()
    placeholderTexture.dispose()
    textCache.dispose()
    cache.dispose()
    renderer.dispose()
  }

  return {
    renderPng(time: number, tilt?: Tilt): Promise<Blob> {
      if (disposed) return Promise.reject(new Error("[card-renderer] 帧渲染器已销毁"))
      // 倾角必须连同卡面一起转：卡面与图层共用同一批网格变换，否则两者会错开（与交互视图
      // 的 `mesh.rotation.set(tilt.x, tilt.y, 0)` 同构，见 card-view.ts）。
      const t = tilt ?? { x: 0, y: 0 }
      baseMesh.rotation.set(t.x, t.y, 0)
      // 有倾角才画侧壁：平视下它本来就投不出像素，关掉则能保证平视导出与旧版逐像素一致。
      slab.visible = t.x !== 0 || t.y !== 0
      slab.rotation.set(t.x, t.y, 0)
      // 边缘倒角：平视 0.25，倾斜时升到 1。
      edgeMesh.visible = true
      edgeMat.uniforms.uTilt.value = slab.visible ? 1 : 0.25
      edgeMesh.rotation.set(t.x, t.y, 0)
      glassMesh.rotation.set(t.x, t.y, 0)
      for (const m of layerGroup) m.rotation.set(t.x, t.y, 0)
      // 只有图层随时间流动；卡面底图不含相位项，不接 uTime。
      for (const mat of layerMats) mat.uniforms.uTime.value = time
      renderer.render(scene, camera)
      // 绘制已进缓冲（`preserveDrawingBuffer` 保证 `toBlob` 仍能读到本帧），随即把网格转回正视角：
      // 每次调用结束都让渲染器停在默认姿态，不必依赖「下一帧开头会重新赋值」这一隐式假设。
      baseMesh.rotation.set(0, 0, 0)
      slab.rotation.set(0, 0, 0)
      slab.visible = false
      edgeMesh.rotation.set(0, 0, 0)
      edgeMesh.visible = true
      glassMesh.rotation.set(0, 0, 0)
      edgeMat.uniforms.uTilt.value = 0.25
      for (const m of layerGroup) m.rotation.set(0, 0, 0)
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error("[card-renderer] PNG 编码失败"))
        }, "image/png")
      })
    },
    dispose,
  }
}
