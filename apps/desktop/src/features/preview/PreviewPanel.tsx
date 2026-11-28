/**
 * 中栏：实时预览。
 *
 * 负责三件事：把当前选中的卡面交给 `useCardView`、提供正/背面与视角工具条、
 * 以及棋盘底（画的容器的背景上，canvas 本身透明——渲染器以 alpha: true 清屏）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Eye, EyeOff, Paintbrush, Redo2, RotateCcw, SquareDashed, Undo2, Waves } from "lucide-react"
import { CanvasTexture, NoColorSpace } from "three"
import { findLayerById, type CardFace } from "@prismwright/schema"
import { CARD_ASPECT, MAX_ZOOM, MIN_ZOOM } from "@prismwright/renderer/v1"
import { useDefaultBackStore } from "../../store/defaultBackStore"
import { isDefaultBackPack } from "../default-back/default-back"
import { findCard, usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { Segmented } from "../../ui/Segmented"
import { Slider } from "../../ui/Slider"
import { ToolbarButton } from "../../ui/Toolbar"
import { faceRefMatches } from "./faceRefMatches"
import {
  eraseCanvasSize,
  brushColor,
  canvasToScreenScale,
  isRestoreStroke,
  uvToCanvasPoint,
} from "./eraseCanvas"
import { loadAssetImage } from "./frontImage"
import {
  IDLE_GESTURE,
  inkTo,
  startGesture,
  takeSnapshot,
  type PaintGesture,
} from "./paintGesture"
import {
  emptyStrokeHistory,
  pushStroke,
  redoStroke,
  undoStroke,
  type StrokeHistory,
} from "./strokeHistory"
import { RESET_TILT_EVENT, useCardView } from "./useCardView"

/**
 * 一次擦除绘画的会话：一张白底画布 + 它的 three 纹理。
 *
 * 画布是「还没落盘的那张擦除图」——纹理直接挂到视图上，每画一笔就刷一次，用户即时看到
 * 效果；提交时才编码成 PNG，经 store 的 `commitEraseImage` 落到一张**新**擦除图并写回路径。
 */
interface EraseSession {
  canvas: HTMLCanvasElement
  texture: CanvasTexture
  /**
   * 会话开始时那张擦除图的路径，只用于**读出**已有画面继续画；提交不会写回它
   * （每次提交落到新路径，见 `commitEraseImage`）。空串表示从全白开始。
   */
  path: string
}

export function PreviewPanel() {
  const { t } = useTranslation("editor")
  // 吸管的提示文案归 `effect` 命名空间（与效果栈那个按钮同一个 key）。
  const { t: tEffect } = useTranslation("effect")
  // 容器用 state 而非 ref 持有：ref 的赋值不会触发重渲染，`useCardView` 的
  // 创建 effect 便永远看不到容器元素，预览会一直空白。回调 ref 会 setState，
  // 从而在挂载的那一帧把元素送进依赖数组。
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), [])

  const pack = usePackStore((s) => s.pack)
  const rootDir = usePackStore((s) => s.rootDir)
  const selectedCardId = usePackStore((s) => s.selectedCardId)

  const side = useUiStore((s) => s.previewSide)
  const setSide = useUiStore((s) => s.setPreviewSide)
  const idleSway = useUiStore((s) => s.previewIdleSway)
  const setIdleSway = useUiStore((s) => s.setPreviewIdleSway)
  const zoom = useUiStore((s) => s.previewZoom)
  const setZoom = useUiStore((s) => s.setPreviewZoom)
  const showChecker = useUiStore((s) => s.showChecker)
  const setShowChecker = useUiStore((s) => s.setShowChecker)
  const markMissing = useUiStore((s) => s.markMissing)
  const erasePaint = useUiStore((s) => s.erasePaint)
  const resolveErasePaint = useUiStore((s) => s.resolveErasePaint)
  const eraseBrushWidth = useUiStore((s) => s.eraseBrushWidth)
  const setEraseBrushWidth = useUiStore((s) => s.setEraseBrushWidth)
  const erasePreview = useUiStore((s) => s.erasePreview)
  const setErasePreview = useUiStore((s) => s.setErasePreview)
  const commitEraseImage = usePackStore((s) => s.commitEraseImage)
  const setErasePaintHistory = useUiStore((s) => s.setErasePaintHistory)

  // 系列没有自己的卡背时显示**全系列共用的默认卡背**（见 `features/default-back`）。
  // 它的素材在自己的工程目录里，不在当前系列下，故两者要一起取。
  const defaultBack = useDefaultBackStore((s) => s.face)
  const defaultBackRoot = useDefaultBackStore((s) => s.rootDir)

  const showingDefaultBack = side === "back" && pack !== null && pack.back === null && defaultBack !== null

  // 正在编辑默认卡背工程时没有「正面」可言：隐藏正/背切换，免得切到一份永远空着的正面。
  const editingDefaultBack = isDefaultBackPack(rootDir, defaultBackRoot)

  const face: CardFace | null = useMemo(() => {
    if (!pack) return null
    if (side === "back") return pack.back ?? defaultBack
    return findCard(pack, selectedCardId)
  }, [pack, side, selectedCardId, defaultBack])

  // 卡背来自默认工程时，资源也要从那个目录读——否则它的图全部解析失败。
  const faceRoot = showingDefaultBack ? defaultBackRoot : rootDir

  // 比例是系列级的：正反面共用同一个框；未打开系列时退回渲染器的缺省 5:7。
  const aspect = pack?.aspect ?? CARD_ASPECT

  const {
    pickUv,
    uvToClient,
    setEraseTexture,
    refreshErase,
    setErasePreview: setViewErasePreview,
    setIdleSway: setViewIdleSway,
  } = useCardView({
    container,
    face,
    aspect,
    rootDir: faceRoot,
    idleSway,
    zoom,
    onMissing: markMissing,
  })

  // —— 蒙版擦除：在卡上涂抹，白 = 保留、黑 = 擦掉 ——
  //
  // 只在「请求的卡面 == 正在显示的那一面」时有效。对话状态由预览面板本地持有，
  // 因为画布与纹理是纯粹的视图资源，进 store 只会让撤销栈与持久化多一堆无意义状态。
  const paintActive = erasePaint !== null && faceRefMatches(erasePaint.ref, side, selectedCardId)
  const [eraseSession, setEraseSession] = useState<EraseSession | null>(null)
  // 会话创建只该发生在「进入绘画」那一刻：画的过程中 face 会因撤销 / 外部编辑而变，
  // 但重建画布会把用户画的东西抹掉，故最新值经 ref 读取，不进创建 effect 的依赖。
  const faceLatest = useRef(face)
  faceLatest.current = face
  // 比例同理：擦除画布只在会话开始时按它定型，会话中途换比例不该重建画布（会把用户画的抹掉）。
  const aspectLatest = useRef(aspect)
  aspectLatest.current = aspect
  const idleSwayLatest = useRef(idleSway)
  idleSwayLatest.current = idleSway
  /**
   * 当前笔画：是否按下、上一落点、是否恢复笔，以及这一笔的撤销快照记过没有。
   * 快照挂在「第一次落墨」而不是「按下」上（见 `paintGesture.ts`）。
   */
  const stroke = useRef<PaintGesture>(IDLE_GESTURE)
  /**
   * 本次会话是否落下过笔。没画过就点「完成」不该提交：否则每次只是打开画笔再关掉，
   * 都会多一张与旧图相同的擦除图和一格「撤销了也看不出变化」的历史。
   */
  const erasedSinceOpen = useRef(false)
  /** 会话内步进历史（一次按下→抬起记一步）；退出会话即清空，与 pack 的撤销栈无关。 */
  const paintHistory = useRef<StrokeHistory<ImageData>>(emptyStrokeHistory())
  /** 会话画布；撤销 / 重做经它在 ref 里取，不必把会话对象塞进回调依赖。 */
  const paintCanvas = useRef<HTMLCanvasElement | null>(null)
  /**
   * 画笔范围圈：跟着指针走的虚线圆。位置与大小都是**直接写 DOM**（不经 React state）。
   *
   * 指针每移动一次就换一次位置，走 state 会把整个面板（含 canvas 与工具条）重渲染一遍，
   * 而画笔层恰恰要求落笔期间尽量不掉帧。故只留一个空的 div，尺寸与位移由 `placeBrushCursor` 写进 style。
   */
  const brushCursor = useRef<HTMLDivElement | null>(null)
  // 按钮的可用态：历史本身在 ref 里，不会触发重渲染，故另存两个布尔量。
  const [canUndoStroke, setCanUndoStroke] = useState(false)
  const [canRedoStroke, setCanRedoStroke] = useState(false)
  /**
   * 「恢复笔」开关：打开后整支笔改为画白（把擦掉的区域复原），右键 / Alt 反向为擦除。
   *
   * 会话级状态、不跨会话记忆：重开画笔默认仍是擦除——上次切到恢复就记住，会让下一次
   * 顺手一画变成「什么都没擦，还把之前的擦除复原了」。
   */
  const [restoreMode, setRestoreMode] = useState(false)

  /** 把一份快照写回画布，并按「已生效笔画数」刷新可用态与「有没有内容要提交」。 */
  const restoreStrokeSnapshot = useCallback(
    (snapshot: ImageData) => {
      const canvas = paintCanvas.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      ctx.putImageData(snapshot, 0, 0)
      erasedSinceOpen.current = paintHistory.current.past.length > 0
      setCanUndoStroke(paintHistory.current.past.length > 0)
      setCanRedoStroke(paintHistory.current.future.length > 0)
      refreshErase()
    },
    [refreshErase],
  )

  /** 撤销一笔（Ctrl+Z / 浮条按钮）；绘画期间替换掉 pack 的撤销。 */
  const undoStrokePaint = useCallback(() => {
    const canvas = paintCanvas.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const snapshot = undoStroke(
      paintHistory.current,
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    )
    if (snapshot) restoreStrokeSnapshot(snapshot)
  }, [restoreStrokeSnapshot])

  /** 重做一笔（Ctrl+Shift+Z / 浮条按钮），与撤销成对。 */
  const redoStrokePaint = useCallback(() => {
    const canvas = paintCanvas.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const snapshot = redoStroke(
      paintHistory.current,
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    )
    if (snapshot) restoreStrokeSnapshot(snapshot)
  }, [restoreStrokeSnapshot])

  // 会话存续期间把撤销 / 重做借给全局快捷键（见 uiStore.erasePaintHistory 与
  // menuActions 的 edit.undo / edit.redo）；退出时摘除，回到 pack 的历史。
  useEffect(() => {
    if (!paintActive) return
    setErasePaintHistory({ undo: undoStrokePaint, redo: redoStrokePaint })
    return () => setErasePaintHistory(null)
  }, [paintActive, setErasePaintHistory, undoStrokePaint, redoStrokePaint])

  // 请求与画面脱节（切了正/背面、换了卡）时直接作废——否则会留一个没有落点的画笔层。
  useEffect(() => {
    if (erasePaint && !paintActive) resolveErasePaint()
  }, [erasePaint, paintActive, resolveErasePaint])

  useEffect(() => {
    if (!paintActive || !erasePaint) return
    const current = faceLatest.current
    // 擦除挂在卡面还是某一层：目标决定去哪个效果列表里找那条 maskErase。
    const targetLayerId = erasePaint.target.layerId
    const effects = findLayerById(current?.layers ?? [], targetLayerId)?.effects
    const effect = effects?.find((e) => e.id === erasePaint.effectId)
    // 已有擦除图就在它上面继续画；没有则从一张全白的画布开始（全白 = 什么都不擦）。
    const path = effect?.kind === "maskErase" ? effect.params.path : ""
    const canvas = document.createElement("canvas")
    // 画布与卡面同比例：UV 才等比映射；换比例后已有的擦除图会被拉伸，这是换形状的自然结果。
    const { width: canvasWidth, height: canvasHeight } = eraseCanvasSize(aspectLatest.current)
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "white"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const texture = new CanvasTexture(canvas)
    // 擦除图是**数据**（亮度 = 保留度），不是颜色：与渲染器里 "data" 纹理同色彩空间。
    texture.colorSpace = NoColorSpace
    // 新会话从「没按下」开始：上一轮若在按下态被取消，残留的 drawing 会让下一次移动直接落笔。
    stroke.current = IDLE_GESTURE
    erasedSinceOpen.current = false
    // 步进历史是会话级的：换一次会话（含重开同一条效果）就从零开始。
    paintHistory.current = emptyStrokeHistory()
    paintCanvas.current = canvas
    setCanUndoStroke(false)
    setCanRedoStroke(false)
    // 每次会话都从「擦除笔」起步（见 restoreMode 的注释）。
    setRestoreMode(false)
    setEraseSession({ canvas, texture, path })
    // 落到目标那一条：图层擦除不能覆盖卡面那张，两张是相乘关系。
    setEraseTexture(texture, targetLayerId)
    // 卡片自己在动时笔尖落点会跟着漂，画画期间先停摆（退出时恢复用户在工具栏的选择）。
    setViewIdleSway(false)

    let alive = true
    if (path && faceRoot) {
      void loadAssetImage(faceRoot, path).then((img) => {
        if (!alive || !img) return
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        texture.needsUpdate = true
        refreshErase()
      })
    }

    return () => {
      alive = false
      stroke.current = IDLE_GESTURE
      paintHistory.current = emptyStrokeHistory()
      paintCanvas.current = null
      setEraseSession(null)
      // 回到按效果里的 path 解析（提交后那条路径已指向刚写入的 PNG）。
      setEraseTexture(null, targetLayerId)
      // 辅助底色是绘画期的显示手段：退出时关掉，回到真实输出。
      setViewErasePreview(false)
      setViewIdleSway(idleSwayLatest.current)
      texture.dispose()
    }
  }, [paintActive, erasePaint, faceRoot, setEraseTexture, refreshErase, setViewErasePreview, setViewIdleSway])

  // 辅助底色随开关实时生效（会话中途也可切）；进入 / 退出会话的那次由上面那个 effect 负责。
  useEffect(() => {
    if (!paintActive) return
    setViewErasePreview(erasePreview)
  }, [paintActive, erasePreview, setViewErasePreview])

  useEffect(() => {
    if (!paintActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveErasePaint()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [paintActive, resolveErasePaint])

  /** 客户端坐标 → 擦除画布像素；没打中卡面时 `null`。 */
  function erasePointAt(e: React.PointerEvent): { x: number; y: number } | null {
    const canvas = eraseSession?.canvas
    if (!canvas) return null
    const uv = pickUv(e.clientX, e.clientY)
    if (!uv) return null
    return uvToCanvasPoint(uv.u, uv.v, canvas.width, canvas.height)
  }

  /** 指针在画笔层里的位置（相对覆盖层的 CSS 像素）；`null` 表示指针不在层上。 */
  const brushPos = useRef<{ x: number; y: number } | null>(null)

  /**
   * 画笔范围圈的半径（屏幕 CSS 像素）。
   *
   * 由卡面两条中线在屏幕上的投影长度推得：`uvToClient` 把 UV 投回客户端坐标，量出卡面此刻
   * 实际占多大——缩放、倾斜、透视都算在里面。`null` 表示卡面不可见（已翻到背面）。
   */
  function brushRadiusPx(): number | null {
    const left = uvToClient(0, 0.5)
    const right = uvToClient(1, 0.5)
    const bottom = uvToClient(0.5, 0)
    const top = uvToClient(0.5, 1)
    if (!left || !right || !bottom || !top) return null
    const screenWidth = Math.hypot(right.x - left.x, right.y - left.y)
    const screenHeight = Math.hypot(top.x - bottom.x, top.y - bottom.y)
    const canvas = eraseSession?.canvas
    if (!canvas) return null
    const scale = canvasToScreenScale(screenWidth, screenHeight, canvas.width, canvas.height)
    if (scale === null) return null
    // `eraseBrushWidth` 是直径（画布像素）；圈画的正是笔触落下的范围。
    return (eraseBrushWidth / 2) * scale
  }

  /** 按当前指针位置与笔宽重画范围圈；指针不在层上或卡面不可见时隐藏。 */
  function placeBrushCursor() {
    const el = brushCursor.current
    if (!el) return
    const pos = brushPos.current
    const radius = brushRadiusPx()
    if (!pos || radius === null) {
      el.style.opacity = "0"
      return
    }
    el.style.width = `${radius * 2}px`
    el.style.height = `${radius * 2}px`
    // 写 transform 而不是 left/top：不触发布局，指针每移动一次改它也很便宜。
    el.style.transform = `translate3d(${pos.x - radius}px, ${pos.y - radius}px, 0)`
    el.style.opacity = "1"
  }

  /** 记住指针位置并同步范围圈（指针移动 / 按下时调用）。 */
  function trackBrushCursor(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    brushPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    placeBrushCursor()
  }

  // 拖画笔宽度滑杆时指针是静止的，靠这个 effect 在参数变化后重画一次；缩放变了卡面在屏幕上
  // 的大小也跟着变，同样要重算。
  useEffect(() => {
    if (paintActive) placeBrushCursor()
  }, [paintActive, eraseBrushWidth, zoom])

  /** 从 `from` 画到 `to`（`from` 为 null 时只点一个圆点），随即刷新预览。 */
  function paintStroke(from: { x: number; y: number } | null, to: { x: number; y: number }, restore: boolean) {
    const canvas = eraseSession?.canvas
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const color = brushColor(restore)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    // 笔宽取工具栏当前值：调粗后立刻生效，不必重开会话。
    ctx.lineWidth = eraseBrushWidth
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    if (from) {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
    // 圆点：单点按下与快速拖动都靠它保证笔迹连续（零长度线段在部分浏览器不渲染）。
    ctx.beginPath()
    ctx.arc(to.x, to.y, eraseBrushWidth / 2, 0, Math.PI * 2)
    ctx.fill()
    erasedSinceOpen.current = true
    refreshErase()
  }

  /**
   * 落墨到 `point`（`handlePaintPointerDown/Move` 共用）。
   *
   * 快照在这里记而不是在按下处：按下那一点可能落在卡面之外（`erasePointAt` 返回
   * `null`），用户拖进卡面才真正画出东西。若只在按下时记，这种笔画了却进不了撤销栈，
   * 左箭头一直是灰的；反过来，同一笔里也只记一次（`takeSnapshot` 记账）。
   */
  function paintSegment(point: { x: number; y: number }) {
    const snap = takeSnapshot(stroke.current)
    if (snap.snapshot) {
      const canvas = eraseSession?.canvas
      const ctx = canvas?.getContext("2d")
      if (canvas && ctx) {
        pushStroke(paintHistory.current, ctx.getImageData(0, 0, canvas.width, canvas.height))
        setCanUndoStroke(true)
        setCanRedoStroke(false)
      }
    }
    const ink = inkTo(snap.gesture, point)
    stroke.current = ink.gesture
    paintStroke(ink.from, point, ink.gesture.restore)
  }

  function handlePaintPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!eraseSession) return
    trackBrushCursor(e)
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const point = erasePointAt(e)
    stroke.current = startGesture(isRestoreStroke(restoreMode, e), point)
    // 按下即落一个点：单击也能擦 / 恢复，不必拖一下。
    if (point) paintSegment(point)
  }

  function handlePaintPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // 范围圈跟着指针走，不论是否按下（未按下时只是预览笔触大小）。
    trackBrushCursor(e)
    if (!stroke.current.drawing) return
    const point = erasePointAt(e)
    if (!point) return
    paintSegment(point)
  }

  function handlePaintPointerUp(e: React.PointerEvent) {
    if (!stroke.current.drawing) return
    stroke.current = IDLE_GESTURE
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  /**
   * 提交：把画布编码成 PNG，经 `commitEraseImage` 落到一张**新**擦除图并写回效果参数——
   * 整次擦除是一步可撤销的历史。
   *
   * 落盘交给 store 而不是就地覆盖旧路径：渲染器的纹理缓存以路径为键且永不过期，历史快照
   * 也只存路径字符串——复用旧路径会让提交后的预览停在旧纹理上（新笔迹不生效），撤销也回到
   * 已被覆盖的新像素（等于没撤销）。写失败就保持绘画态，用户看到的是「没保存」而不是
   * 「保存了但画面没变」。
   */
  async function commitErase() {
    if (!eraseSession || !erasePaint) return
    // 一笔没画就点了完成：没有要保存的内容，直接退出，不产生文件与空历史点。
    if (!erasedSinceOpen.current) {
      resolveErasePaint()
      return
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      eraseSession.canvas.toBlob(resolve, "image/png"),
    )
    if (!blob) return
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const result = await commitEraseImage(
      erasePaint.ref,
      erasePaint.target,
      erasePaint.effectId,
      bytes,
    )
    if (!result.ok) {
      console.error("[prismwright] 擦除图写入失败", result)
      return
    }
    resolveErasePaint()
  }

  function cancelErase() {
    resolveErasePaint()
  }

  // 「重置视角」= 缩放归 1 + 倾斜角清回原位——相机本身不做轨道控制，没有别的状态要复位。
  // 倾斜那半由 `useCardView` 监听事件并调 `clearTilt()`，缩放这半是 store 状态，直接改。
  const resetView = () => {
    setZoom(1)
    window.dispatchEvent(new CustomEvent(RESET_TILT_EVENT))
  }

  return (
    // 舞台直铺应用底色：不再套背景面板，工具栏与视图胶囊浮在画面上。
    // 父级（分栏中心面板）不是 flex 容器：这里必须自带 `h-full`，只写 `flex-1` 的话
    // 高度会塌成内容高（画布是绝对定位，内容高为 0），整张卡就看不见了。
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
        {!editingDefaultBack && (
          <Segmented
            value={side}
            onChange={(value) => setSide(value as "front" | "back")}
            ariaLabel={t("panel.preview")}
            options={[
              { value: "front", label: t("preview.front") },
              { value: "back", label: t("preview.back") },
            ]}
          />
        )}
      </div>

        {/* 渲染容器与拾色层是**兄弟**而非父子：拾色层盖在上面拦截指针事件，事件不会冒泡到
            渲染容器的拖拽倾斜监听上（那是渲染器挂在 canvas 容器上的，不是 React 树）。 */}
        {/* 背景不在这里铺：网格底挂在整个窗口上（见 App 的 workspace-grid），画布直接透出。 */}
        <div className="relative min-h-0 flex-1">
          <div ref={containerRef} className="absolute inset-0" />
          {!face && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-body text-disabled">
              {side === "back" ? t("preview.backNotSet") : t("preview.noCard")}
            </div>
          )}
          {/* 擦除画笔层：整块盖住预览拦截指针（与拾色层同理，事件不会冒到渲染器的拖拽倾斜上）。
              顶部浮条说明操作方式并提供「取消 / 完成」——浮条自身要吞掉 pointerdown，
              否则点按钮会顺带落成一个笔点。 */}
          {paintActive && eraseSession && (
            <div
              role="application"
              aria-label={tEffect("maskErase.paint")}
              title={tEffect("maskErase.paint")}
              className="absolute inset-0 cursor-crosshair touch-none"
              onPointerDown={handlePaintPointerDown}
              onPointerMove={handlePaintPointerMove}
              onPointerUp={handlePaintPointerUp}
              onPointerCancel={handlePaintPointerUp}
              onPointerLeave={() => {
                brushPos.current = null
                placeBrushCursor()
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {/* 画笔范围圈：直径即笔触实际落下的范围（随缩放与倾斜变化），位置由
                  `placeBrushCursor` 直接写 style——见 `brushCursor` 的说明。 */}
              <div
                ref={brushCursor}
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 rounded-full border border-dashed border-white/90 opacity-0 ring-1 ring-black/50"
              />
              <div
                className="popover-shadow absolute left-1/2 top-2 flex w-[min(480px,calc(100%-1rem))] -translate-x-1/2 flex-col gap-1 rounded-card border border-line-soft bg-panel/95 px-2 py-1 text-label text-muted"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap">{tEffect("maskErase.brushSize")}</span>
                  <div className="w-40 min-w-0 shrink-0">
                    <Slider
                      value={eraseBrushWidth}
                      onChange={setEraseBrushWidth}
                      min={4}
                      max={160}
                      step={1}
                      precision={0}
                      ariaLabel={tEffect("maskErase.brushSize")}
                    />
                  </div>
                  <ToolbarButton
                    icon={erasePreview ? Eye : EyeOff}
                    label={tEffect("maskErase.showErase")}
                    active={erasePreview}
                    onClick={() => setErasePreview(!erasePreview)}
                  />
                  {/* 反向笔：打开后整支笔改为画白复原，右键 / Alt 反向为擦除（见 isRestoreStroke）。 */}
                  <ToolbarButton
                    icon={Paintbrush}
                    label={tEffect("maskErase.restore")}
                    active={restoreMode}
                    onClick={() => setRestoreMode(!restoreMode)}
                  />
                  {/* 会话内步进撤销：只回退笔画，不碰 pack 的历史（Ctrl+Z 走同一条路）。 */}
                  <ToolbarButton
                    icon={Undo2}
                    label={tEffect("maskErase.undo")}
                    disabled={!canUndoStroke}
                    onClick={undoStrokePaint}
                  />
                  <ToolbarButton
                    icon={Redo2}
                    label={tEffect("maskErase.redo")}
                    disabled={!canRedoStroke}
                    onClick={redoStrokePaint}
                  />
                  <button
                    type="button"
                    onClick={cancelErase}
                    className="ml-auto h-6 shrink-0 rounded-control px-2 text-label text-muted hover:bg-elevated hover:text-foreground"
                  >
                    {tEffect("maskErase.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void commitErase()}
                    className="h-6 shrink-0 rounded-control bg-accent-soft px-2 text-label text-accent hover:bg-accent-soft/70"
                  >
                    {tEffect("maskErase.done")}
                  </button>
                </div>
                {/* 提示可能较长（含快捷键与反向笔说明），允许换行而不是撑破浮条。 */}
                <span className="leading-tight text-num text-disabled">
                  {tEffect("maskErase.hint")}
                </span>
              </div>
            </div>
          )}
        </div>
        {/* 底部视图胶囊：缩放与视图开关。浮在舞台上，不占据画面高度。 */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex h-button items-center gap-0.5 rounded-full border border-line-soft bg-panel/90 px-1.5 popover-shadow backdrop-blur">
            {/* 绘画期间禁用空闲摆动：`idleSway` 是 `useCardView` 创建 effect 的依赖，
                切换它会销毁并重建整个 CardView——绘画中的擦除图（挂在旧视图上的内存纹理）
                随之丢失，笔迹「看不见但确实画上了」。 */}
            <ToolbarButton
              icon={Waves}
              label={t("previewToggle.idleSway")}
              active={idleSway}
              disabled={paintActive}
              onClick={() => setIdleSway(!idleSway)}
            />
            <ToolbarButton
              icon={SquareDashed}
              label={t("preview.toggleChecker")}
              active={showChecker}
              onClick={() => setShowChecker(!showChecker)}
            />
            <ToolbarButton icon={RotateCcw} label={t("preview.resetView")} onClick={resetView} />
            <span className="mx-1 h-4 w-px bg-line-soft" aria-hidden />
            <button
              type="button"
              aria-label={t("preview.zoomOut")}
              onClick={() => setZoom(Math.max(MIN_ZOOM, Math.round((zoom - 0.1) * 100) / 100))}
              className="flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-elevated hover:text-foreground"
            >
              −
            </button>
            <span className="w-10 text-center font-mono text-num text-muted">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label={t("preview.zoomIn")}
              onClick={() => setZoom(Math.min(MAX_ZOOM, Math.round((zoom + 0.1) * 100) / 100))}
              className="flex h-7 w-7 items-center justify-center rounded-control text-muted hover:bg-elevated hover:text-foreground"
            >
              +
            </button>
          </div>
        </div>
      </div>
    )
}
