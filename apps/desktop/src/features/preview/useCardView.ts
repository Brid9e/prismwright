/**
 * 把 `createCardView` 的生命周期接到 React 上。
 *
 * 全应用只有一个预览面，因此不做全局单例或 Context——组件的挂载/卸载就是视图的
 * 创建/销毁，GPU 资源随面板消失而释放（设计文档分叉 1 的方案 A）。
 */
import { useCallback, useEffect, useRef } from "react"
import type { Texture } from "three"
import { createCardView, createDomHost, type CardView } from "@cardbara/renderer/v1"
import type { CardFace } from "@cardbara/schema"
import { createResolveAsset } from "./resolve-asset"

/** 「重置视角」事件名；派发方在 `PreviewPanel`，监听方在本模块。 */
export const RESET_TILT_EVENT = "cardbara:reset-tilt"

export interface UseCardViewOptions {
  /** three canvas 的挂载容器。 */
  container: HTMLElement | null
  /** 当前要显示的卡面；`null` 表示不显示（透出容器的棋盘底）。 */
  face: CardFace | null
  /** 系列统一的卡面宽高比（宽/高）；正反面共用，属于几何而非卡面内容。 */
  aspect: number
  /** 系列根目录；`null` 时无从解析资源。 */
  rootDir: string | null
  idleSway: boolean
  /** 缩放倍数；变化时走 `setZoom` 就地推拉相机（见下方 effect 分工）。 */
  zoom: number
  /** 资源解析失败回调。 */
  onMissing: (rel: string) => void
}

/**
 * 在容器里维护一个与 `face` 同步的卡片视图。
 *
 * 拆成两个 effect 是有意为之：
 *
 * - **创建/销毁**（依赖容器与选项）会重建 WebGL 上下文。绝不能让它随 `face`
 *   一起变——拖滑杆时 `face` 每帧都是新对象，按帧创建 GL 上下文既昂贵又会撞上
 *   浏览器的上下文数量上限。
 * - **更新**（依赖 `face`）走 `view.update(face)`，复用已建好的上下文与纹理缓存。
 *
 * `zoom` 与 `face` 同理：拖缩放滑杆时它连续变化，若进创建组就会每帧重建 WebGL
 * 上下文。所以创建时只取一次初值（经 ref，避免把它塞进依赖数组），后续变化由
 * 下面那个独立的 effect 调 `setZoom`——渲染器就地推拉相机，不动 GL 资源。
 *
 * `idleSway` 归在创建组：`CardView` 没有「就地改选项」的接口（`setZoom` 是可增量的个例，
 * 它只推拉相机），只能重建。它是偶尔切换的开关，不会连续变化，代价可接受。（拖拽倾斜已
 * 常驻开启、不再有开关，见 2026-10-14 的交互改造。）
 */
/** `useCardView` 交回给面板的少量操作（视图本身不外泄）。 */
export interface CardViewControls {
  /**
   * 客户端坐标 → 卡面 UV；没点到卡面、或视图尚未建好时返回 `null`。
   *
   * 经 ref 转发：视图会随 `idleSway` 等选项重建，而这个函数引用保持稳定，
   * 消费方不必跟着重挂事件。
   */
  pickUv: (clientX: number, clientY: number) => { u: number; v: number } | null
  /**
   * 卡面 UV → 客户端坐标（`pickUv` 的反向映射，含倾斜与透视）。
   *
   * 同样经 ref 转发：视图重建后函数引用不变。正面不可见时返回 `null`。
   * 预览里的画笔范围圈靠它量屏幕上卡面的实际大小。
   */
  uvToClient: (u: number, v: number) => { x: number; y: number } | null
  /**
   * 临时换用一张擦除图（绘画期间的即时预览）；传 `null` 回到按效果里的 `path` 解析。
   * `layerId` 为 `null` / 省略时是卡面那张（整卡擦除），否则是该图层自己的那张。
   * 与 `CardView.setEraseTexture` 同义，经 ref 转发。
   */
  setEraseTexture: (texture: Texture | null, layerId?: string | null) => void
  /** 擦除画布内容变化后调用（让 three 重新上传纹理并渲染一帧）。 */
  refreshErase: () => void
  /** 开 / 关「擦除区域底色」（绘画辅助显示，只影响这一块预览）。 */
  setErasePreview: (enabled: boolean) => void
  /** 开 / 关空闲摆动；绘画期间要关掉，否则笔尖落点会跟着卡片漂。 */
  setIdleSway: (enabled: boolean) => void
}

export function useCardView({
  container,
  face,
  aspect,
  rootDir,
  idleSway,
  zoom,
  onMissing,
}: UseCardViewOptions): CardViewControls {
  const viewRef = useRef<CardView | null>(null)

  // onMissing 与 face 都走 ref：它们每次渲染都可能换引用，进依赖数组会让视图
  // 反复重建；而它们的语义都不需要触发重建。zoom 进 ref 的理由见文件头注释。
  const missingRef = useRef(onMissing)
  missingRef.current = onMissing
  const faceRef = useRef(face)
  faceRef.current = face
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // 「有没有卡面」而不是 face 本身：从「无卡面」变为「有卡面」时必须触发创建，
  // 但后续每次内容变化不该触发。用一个布尔量把这两件事分开。
  const hasFace = face !== null
  // 宽高比是**几何**：渲染器不支持就地改几何，变了只能重建视图（故进创建组的依赖）；圆角相反，有就地接口。
  const faceCornerRadius = face?.cornerRadius

  useEffect(() => {
    // 无容器或无系列目录时无从渲染；容器尺寸由渲染器自带的 ResizeObserver 同步，
    // 这里不必自己监听。
    if (!container || !rootDir) return
    // 首帧就是「无卡面」时先不建视图，等 hasFace 翻转时这个 effect 会再跑一次。
    const initial = faceRef.current
    if (!initial) return

    const view = createCardView({
      host: createDomHost(container),
      card: initial,
      resolveAsset: createResolveAsset({ rootDir, onMissing: (rel) => missingRef.current(rel) }),
      idleSway,
      zoom: zoomRef.current,
      aspect,
      cornerRadius: initial.cornerRadius,
    })
    viewRef.current = view

    // 「重置视角」由工具条经自定义事件广播过来：工具条与视图分处不同子树，
    // 用事件比把 view 实例提成 context 更轻，也不必让工具条知道渲染器的存在。
    const onResetTilt = () => view.clearTilt()
    window.addEventListener(RESET_TILT_EVENT, onResetTilt)

    return () => {
      window.removeEventListener(RESET_TILT_EVENT, onResetTilt)
      viewRef.current = null
      view.dispose()
    }
  }, [container, rootDir, idleSway, hasFace, aspect])

  useEffect(() => {
    if (face) viewRef.current?.update(face)
  }, [face])

  // 视图尚不存在时（首帧无卡面）是空操作：上面那个创建 effect 已经读到同一个
  // zoomRef.current，等 hasFace 翻转后建出来的视图就是当前倍数，不会漏掉这次变更。
  useEffect(() => {
    viewRef.current?.setZoom(zoom)
  }, [zoom])

  // 圆角是纯几何增量（遮罩 uniform + 侧壁几何），拖滑杆时逐次落地，不重建 GL 上下文。
  useEffect(() => {
    if (faceCornerRadius !== undefined) viewRef.current?.setCornerRadius(faceCornerRadius)
  }, [faceCornerRadius])

  const pickUv = useCallback(
    (clientX: number, clientY: number) => viewRef.current?.pickUv(clientX, clientY) ?? null,
    [],
  )
  const uvToClient = useCallback(
    (u: number, v: number) => viewRef.current?.uvToClient(u, v) ?? null,
    [],
  )
  const setEraseTexture = useCallback(
    (texture: Texture | null, layerId: string | null = null) =>
      viewRef.current?.setEraseTexture(texture, layerId),
    [],
  )
  const refreshErase = useCallback(() => viewRef.current?.refreshErase(), [])
  const setErasePreview = useCallback(
    (enabled: boolean) => viewRef.current?.setErasePreview(enabled),
    [],
  )
  const setIdleSway = useCallback(
    (enabled: boolean) => viewRef.current?.setIdleSway(enabled),
    [],
  )

  return { pickUv, uvToClient, setEraseTexture, refreshErase, setErasePreview, setIdleSway }
}
