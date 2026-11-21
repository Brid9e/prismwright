/**
 * 视图装配与生命周期：把参数化的 card-view 原型收敛为一个可增量更新的 WebGL 视图。
 *
 * 场景：透视相机 + 一个 `cardGroup`，里面依次是正面组、侧壁、背面组。每面是「圆角卡面平面 +
 * 逐图层叠加的平面」，背面组预转半圈（绕 Y 轴 π）、再后移一个卡厚。倾斜与翻面角只写在
 * `cardGroup` 上。图层可嵌套：绘制序列由图层树深度优先摊平而来（父在前、子随后），每个图层的
 * alpha 再被其**祖先**蒙版之积软裁切。相机置于 +Z、看向原点，轻微透视产生视差；卡片绕 X/Y 轴的
 * 旋转由倾斜驱动（见 {@link ./tilt}），翻面角由 {@link ./flip} 的纯函数驱动。
 *
 * 角度口径（全文统一）：`flip`（即 `tilt.y`）= 0 是主卡面朝外，= π 是卡背朝外。没有卡背时
 * 恒为 0，行为与加双面之前完全一致。
 *
 * 渲染循环：`requestAnimationFrame` 常驻，但仅在需要时真正 `render()`（dirty flag），
 * 空闲时省电。容器尺寸由 `ResizeObserver` 同步。
 *
 * 倾斜为「按住拖拽 + 欠阻尼弹簧回弹」模型：按下拖动时角随指针位移就地累积（见
 * {@link dragTilt}），松手后由弹簧把角拉回空闲摆动 / 静止位，残余角速度让它晃几下才停。
 * 指针**未按下时不动**——悬停不再触发生效。翻面态（卡背朝外）只用横向拖拽改 `flip`，
 * 松手过阈值即切自由态落向主卡面（见 {@link ./flip}）。
 */
import {
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type ShaderMaterial,
  type Texture,
} from "three"
import {
  flattenLayers,
  isLayerVisible,
  resolveEraseMask,
  resolveImage,
  resolveImageMask,
  type CardFace,
} from "@cardbara/schema"
import type { CardView, CardViewOptions, FlipState } from "./types"
import { clampPixelRatio } from "./host"
import {
  CAMERA_FOV,
  CARD_ASPECT,
  CARD_THICKNESS,
  LAYER_Z_STEP,
  clampCornerRadius,
  createCardSlab,
  createPlaceholderTexture,
} from "./card-scene"
import { TextureCache } from "./textures"
import { TextTextureCache, scopedLayerId } from "./text-texture"
import { disposeRenderer } from "./renderer-dispose"
import { clientToNdc, ndcToClient, type PickRect } from "./pick"
import { createBaseMaterial } from "./materials/base-material"
import { createLayerMaterial, type AncestorMask } from "./materials/layer-material"
import {
  EDGE_BEVEL_RENDER_ORDER,
  createEdgeBevelMaterial,
} from "./materials/edge-bevel-material"
import { glossMaskParams } from "./effects/gloss-mask"
import { createMysteryFace, type MysteryFace } from "./mystery-face"
import { capVelocity, dragTilt, idleSway, springStep, type Tilt } from "./tilt"
import {
  FLIP_START,
  dragFlip,
  dragSpin,
  flipLands,
  flipProgress,
  flipSettled,
  frontVisible,
  landedFlip,
} from "./flip"
import { fitCameraDistance, zoomToCameraDistance } from "./zoom"

/** 静止位的零角（未开空闲摆动时弹簧以此为平衡点）。 */
const ZERO_TILT: Tilt = { x: 0, y: 0 }

/** 松手时距最后一次指针移动超过此时长，视为「停住后松手」→ 不发惯性（毫秒）。 */
const STALE_MOVE_MS = 120

/** 每帧步长上限（秒）：切后台再回来时 `dt` 会很大，夹住以免弹簧积分炸开。 */
const MAX_FRAME_DT = 0.05

/** 角速度采样时的最小时间间隔（秒），避免同一时刻的多次移动导致除以过小值。 */
const MIN_VELOCITY_DT = 0.008

/** 归位判定阈值：角与角速度都小于它即认为静止（弧度 / 弧度每秒）。 */
const TILT_EPSILON = 1e-4

/**
 * 创建一个卡片视图。
 *
 * @param opts - 见 {@link CardViewOptions}。
 * @returns 视图句柄。
 */
export function createCardView(opts: CardViewOptions): CardView {
  const { host, resolveAsset } = opts
  let swayEnabled = opts.idleSway ?? true
  /** 静卡全息自流动：只推进图层 uTime，不碰倾斜角。 */
  let flowEnabled = opts.autoFlow ?? false
  /** 缩放倍数；与取景下限一起决定相机距离（见 {@link applyCameraDistance}）。 */
  let zoom = opts.zoom ?? 1
  /** 圆角半径（卡高单位，已按卡宽一半夹取）；可经 `setCornerRadius` 在运行中改。 */
  let cornerRadius = opts.cornerRadius ?? 0.06
  /** 卡背；为 `null` 即单面卡，不进入翻面交互。 */
  const back: CardFace | null = opts.back ?? null

  const renderer = new WebGLRenderer({
    canvas: host.canvas as unknown as HTMLCanvasElement,
    antialias: true,
    alpha: true,
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(clampPixelRatio(host.pixelRatio()))

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
  const aspect = opts.aspect ?? CARD_ASPECT
  // 圆角与几何同一条夹取规则：着色器的圆角遮罩必须与侧壁轮廓重合，否则圆角处露白边。
  cornerRadius = clampCornerRadius(aspect, cornerRadius)

  const geometry = new PlaneGeometry(aspect, 1)

  const cache = new TextureCache(resolveAsset)
  /** 文字纹理缓存：按「面 + 图层 id」+ 参数键复用，删层时经 `retain` 释放。 */
  const textCache = new TextTextureCache({ aspect })
  /** 无底图时的占位纯色纹理；整场共用一份，避免逐次重建产生泄漏。 */
  const placeholderTexture = createPlaceholderTexture()

  let card: CardFace = opts.card
  /**
   * 绘画中的擦除图覆盖：非 null 时整卡用它，不再读效果里的 `path`。
   *
   * 画一笔就要看得到效果，等落盘 + `update` 再接回来太慢，故允许外部把一张
   * `CanvasTexture` 直接挂上来；画完提交后传 `null` 回到按效果解析。
   *
   * 只作用于主卡面——绘画会话只发生在正面上。
   */
  let liveErase: Texture | null = null
  /**
   * 绘画中的**图层**擦除图覆盖（按图层 id）。与 {@link liveErase} 同义，只是作用在某一层
   * 自己的擦除图上——卡面那张仍归 `liveErase`。同样只作用于主卡面。
   */
  const liveLayerErase = new Map<string, Texture>()
  /**
   * 是否把擦除区域铺一层辅助底色（见 `CardView.setErasePreview`）。
   *
   * 它是**显示**开关而非数据：关着时输出与正常浏览完全一致。材质参数在 rebuild 时
   * 一次性写入，故切换时要重建一次材质（纹理不重建）。
   */
  let erasePreviewEnabled = false

  /** 一面卡建好但尚未换入的材料与网格。 */
  interface FaceParts {
    baseMat: ShaderMaterial
    meshes: Mesh[]
    mats: ShaderMaterial[]
  }

  /** 一面的场景挂载点：组里放底色网格与图层网格，`rebuild` 时整体换入。 */
  interface FaceStack {
    group: Group
    baseMesh: Mesh
    baseMat: ShaderMaterial | null
    layers: Mesh[]
    layerMats: ShaderMaterial[]
  }

  // 场景：一个 cardGroup 承载两面与侧壁，旋转（倾斜 + 翻面）只写在它身上。
  const cardGroup = new Group()
  const frontGroup = new Group()
  const backGroup = new Group()
  // 背面组预转半圈并后移一个卡厚：cardGroup 转到 π 时它正好面向相机。
  backGroup.rotation.y = Math.PI
  backGroup.position.z = -CARD_THICKNESS

  // 两面各自一个 baseMesh；图层网格在 rebuild 时换入。
  const frontBaseMesh = new Mesh(geometry)
  frontBaseMesh.renderOrder = 0
  frontGroup.add(frontBaseMesh)

  const backBaseMesh = new Mesh(geometry)
  backBaseMesh.renderOrder = 0
  backGroup.add(backBaseMesh)

  // 边缘假倒角：盖在全部图层之上的透明平面，只在圆角窄带出像素（见 edge-bevel-material）。
  // 两面各一份，随各自的面组翻转；正视角 uTilt = 0 完全隐藏，保持平视画面不变。
  const frontEdgeMat = createEdgeBevelMaterial({
    aspect,
    cornerRadius,
    lightAngle: card.frontBumpLightAngle,
  })
  const frontEdgeMesh = new Mesh(geometry, frontEdgeMat)
  frontEdgeMesh.renderOrder = EDGE_BEVEL_RENDER_ORDER
  frontEdgeMesh.raycast = () => {}
  frontGroup.add(frontEdgeMesh)

  const backEdgeMat = createEdgeBevelMaterial({
    aspect,
    cornerRadius,
    lightAngle: back?.frontBumpLightAngle,
  })
  const backEdgeMesh = new Mesh(geometry, backEdgeMat)
  backEdgeMesh.renderOrder = EDGE_BEVEL_RENDER_ORDER
  backEdgeMesh.raycast = () => {}
  backGroup.add(backEdgeMesh)

  const frontStack: FaceStack = {
    group: frontGroup,
    baseMesh: frontBaseMesh,
    baseMat: null,
    layers: [],
    layerMats: [],
  }
  const backStack: FaceStack = {
    group: backGroup,
    baseMesh: backBaseMesh,
    baseMat: null,
    layers: [],
    layerMats: [],
  }

  // 厚度：只画侧壁的挤出板，夹在两面之间。正视角看不见，倾斜时露出那条边（见 card-scene）。
  // `setCornerRadius` 会整块换掉它（几何与遮罩一起换）。
  let slab = createCardSlab(aspect, cornerRadius)
  slab.renderOrder = -1

  cardGroup.add(frontGroup, slab, backGroup)
  scene.add(cardGroup)
  // 没有卡背时背面组永久隐藏（applyTilt 每帧按朝向再判一次）。
  backGroup.visible = false
  // 初始取景：缩放推拉 + 「整张卡进画幅」下限（见 applyCameraDistance）。
  applyCameraDistance()

  /** 当前所处状态：`"back"` = 翻面态（卡背朝外），`"front"` = 自由态（主卡面朝外）。 */
  let phase: "back" | "front" = opts.face === "back" && back !== null ? "back" : "front"
  /** 落定后的主卡面角：0 或 2π（从卡背翻过来时按拖拽方向决定）。 */
  let landed = 0
  /** 倾斜角；`y` 同时就是翻面角 `flip`（0 = 主卡面朝外，π = 卡背朝外）。 */
  let tilt: Tilt = { x: 0, y: phase === "back" ? FLIP_START : 0 }
  let tiltVel: Tilt = { x: 0, y: 0 }
  let dragging = false
  let lastPointerX = 0
  let lastPointerY = 0
  let lastMoveAt = 0
  const now = host.now ?? (() => performance.now())
  const requestFrame = host.requestFrame ?? ((cb: (t: number) => void) => requestAnimationFrame(cb))
  const cancelFrame = host.cancelFrame ?? ((id: number) => cancelAnimationFrame(id))
  let lastFrameAt = now()
  let dirty = true
  let disposed = false

  /** 松手后已翻过阈值、等弹簧落到主卡面时回调一次 `revealed: true`。 */
  let revealPending = false
  /** 已回调过 `revealed: true`（每个视图只翻真一次）。 */
  let revealed = false
  /**
   * 未揭晓底纹：翻面落定前盖住主卡面，落定那一帧换成真卡面并释放。
   *
   * 只有「起始就以卡背朝外」的视图才有这一段（抽卡页）。卡牌详情 / 编辑器一上来就看着正面，
   * 没有揭晓过程，底纹恒为 `null`。拿不到 2D 画布时也是 `null`，退化成直接显示真卡面。
   */
  let mystery: MysteryFace | null =
    phase === "back" ? createMysteryFace({ aspect, cornerRadius }) : null
  /**
   * 正面图层（整棵图层树）是否放行绘制。
   *
   * 双面卡从背面起步时，翻面落定（与 `revealed` 同一刻）前不画：卡片还在背面，提前画这套
   * 图层既白付绘制成本（混合模式图层很多），又会在真正转过来之前露出卡面。单面卡与起始
   * 就在正面的双面卡没有这段翻面，恒为 `true`。
   */
  let frontLayersShown = phase === "front"
  /** 上一次已回调的进度（1% 量化）；-1 保证首次必回调。 */
  let lastPercent = -1
  /** 翻面进度订阅者；`onFlip` 增删。 */
  const flipSubs = new Set<(state: FlipState) => void>()

  /** 重建代际：仅让最新一次 rebuild 落地，丢弃被取代的那一次（防并发叠加图层）。 */
  let rebuildGen = 0

  /**
   * 建一面卡的全部材质与网格（卡面 / 蒙版 / 擦除、底色材质、逐图层材质）。
   *
   * 与视图状态无关，被 {@link rebuild} 对正反两面并行调用。踩到被更新的重建取代或视图
   * 已销毁时，释放本轮已建材料并返回 `null`，由调用方丢弃，避免半成品入场景与材质泄漏。
   *
   * @param face - 这一面的数据。
   * @param gen - 重建代际；与 {@link rebuildGen} 不一致即作废。
   * @param scope - 面作用域（`""` = 主卡面，`"back"` = 卡背）：文字纹理按它分域；
   *   绘画中的擦除覆盖只作用于主卡面（`scope === ""`）。
   */
  async function buildFace(
    face: CardFace,
    gen: number,
    scope: string,
  ): Promise<FaceParts | null> {
    // 卡面图蒙版改从效果列表解析（不再是卡面专属字段）。
    const faceMaskPath = resolveImageMask(face.effects)?.path ?? ""
    // 蒙版擦除也挂在卡面上（整卡一张），绘画期间优先用内存里的那一张。
    const erasePath = resolveEraseMask(face.effects)?.path ?? ""
    // 底图与卡面蒙版一并解析：二者独立，放同一个批次里省一次 await 往返。
    // 法线贴图走 "data"：它是方向数据，不能被 sRGB 解码。
    const [faceTexture, faceMask, erase, faceNormal] = await Promise.all([
      cache.get(face.front, "color"),
      cache.get(faceMaskPath, "data"),
      cache.get(erasePath, "data"),
      cache.get(face.frontNormalPath, "data"),
    ])
    if (gen !== rebuildGen || disposed) return null
    // 绘画中的覆盖优先：它比磁盘上的那份新（刚画的还没落盘）。但只属于主卡面。
    const eraseTexture = scope === "" ? liveErase ?? erase : erase

    // 底图 / 圆角 / 效果列表均在重建时一次性写入材质，参数级变化也走重建（见 update）。
    const nextBaseMat = createBaseMaterial({
      map: faceTexture ?? placeholderTexture,
      aspect,
      cornerRadius,
      effects: face.effects,
      mask: faceMask,
      erase: eraseTexture,
      // 绘画辅助底色：只影响交互视图；导出走另一条路径，不经过这个视图。
      erasePreview: erasePreviewEnabled,
      // 没有底图时占位纹理只有 1×1：填充方式无意义，按拉伸处理，免得「适应」把整张卡裁成空白。
      frontFit: faceTexture ? face.frontFit : "stretch",
      frontOffsetX: face.frontOffsetX,
      frontOffsetY: face.frontOffsetY,
      frontScale: face.frontScale,
      frontRotation: face.frontRotation,
      // 法线（bump）：卡面底图自身亮度差生成的伪法线；没有真底图时材质侧会整体关掉。
      frontBumpStrength: face.frontBumpStrength,
      frontBumpDetail: face.frontBumpDetail,
      frontBumpFlow: face.frontBumpFlow,
      frontBumpLight: face.frontBumpLight,
      frontBumpLightAngle: face.frontBumpLightAngle,
      frontBumpLightColor: face.frontBumpLightColor,
      frontBumpInvert: face.frontBumpInvert,
      // 法线贴图：选了就整体接替底图的亮度伪法线；路径写了但没载入时材质退回亮度通路。
      frontNormalPath: face.frontNormalPath,
      frontNormalFlipY: face.frontNormalFlipY,
      normal: faceNormal,
      // 颜色源蒙版要采样真原图：没有卡面图时它必须整体关掉（否则会去采 1×1 占位纹理）。
      frontValid: faceTexture !== null,
    })

    // 树 → 线性绘制序列：深度优先、父在前子随后；被禁用的层连同整棵子树一起跳过。
    // 索引 i 驱动 z 与 renderOrder，故过滤后的序列必须连续编号（用 entries 的下标，而非原数组下标）。
    const entries = flattenLayers(face.layers).filter(isLayerVisible)
    const nextMeshes: Mesh[] = []
    const nextMats: ShaderMaterial[] = []
    let z = LAYER_Z_STEP
    for (let i = 0; i < entries.length; i++) {
      const { layer, ancestors } = entries[i]
      // 本层与祖先的图蒙版路径都从各自的效果列表解析（不再是一等字段）。
      const layerMaskPath = resolveImageMask(layer.effects)?.path ?? ""
      // 本层图片效果（若有）：与蒙版一并解析，纹理走 sRGB（卡面内容，不是蒙版数据）。
      const image = resolveImage(layer.effects)
      // 本层蒙版 + 全部祖先蒙版 + 本层图片 + 本层与祖先的擦除图一并解析（父在子前摊平，
      // 祖先纹理必然已就绪）。
      const [masks, imageTexture, ownErase, ancestorErases, layerNormal] = await Promise.all([
        Promise.all([
          cache.get(layerMaskPath, "data"),
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
      if (gen !== rebuildGen || disposed) {
        nextBaseMat.dispose()
        for (const mat of nextMats) mat.dispose()
        return null
      }
      const ancestorMasks: AncestorMask[] = ancestors.map((a, k) => ({
        imageMask: resolveImageMask(a.effects),
        mask: masks[k + 1],
        // 绘画中的覆盖优先（正画的那一层还没落盘）；否则用磁盘上那份。只属于主卡面。
        erase: scope === "" ? liveLayerErase.get(a.id) ?? ancestorErases[k] : ancestorErases[k],
        // 祖先作为文字蒙版时，它的字形纹理由同一个缓存提供（祖先在摊平序列里先处理，
        // 纹理此时通常已就绪；缓存让这次重复取用没有开销）。
        textMask: a.kind === "text" && a.text?.asMask ? textCache.get(a, scope) : null,
        // 祖先的「作为蒙版」光泽（光带场 → 覆盖率，子层参数化重算，故传参数而非纹理）。
        glossMasks: glossMaskParams(a.effects),
      }))
      const mat = createLayerMaterial({
        layer,
        mask: masks[0],
        ancestors: ancestorMasks,
        // 未使用的祖先槽位复用同一份占位纹理（hasMask=0，采样值不被采用）。
        maskPlaceholder: placeholderTexture,
        // 卡面原图：颜色源蒙版（本层与祖先）按它采样。
        front: faceTexture,
        // 整卡擦除：与卡面材质同一张（见 shaders/common.ts 的 eraseWeight）。
        erase: eraseTexture,
        // 本层自己的擦除图：绘画中的覆盖优先，与整卡那张相乘（见 shaders/layer.ts）。
        layerErase: scope === "" ? liveLayerErase.get(layer.id) ?? ownErase : ownErase,
        // 绘画辅助底色只在本层自己的擦除图上起作用（整卡的由卡面材质负责）。
        erasePreview: erasePreviewEnabled,
        // 本层效果 + 卡面的 moire 集合。后者作为**继承源**：本层无 moire 时整体取它，
        // 于是「卡面统一调摩尔纹」仍能透传到未自定的图层（见 toEffectUniforms）。
        effects: layer.effects,
        inheritedMoire: face.effects,
        // 图片只在纹理与参数都在场时启用；缺图时材质置 uHasImage = 0。
        image: imageTexture && image ? { texture: imageTexture, params: image } : null,
        // 本层文字纹理（非文字层 / 空内容时为 null，材质置 uHasText = 0）。
        text: textCache.get(layer, scope),
        // 本层自己的法线贴图 / 本面的（继承用）。材质按解析结果只绑其中一张。
        normal: layerNormal,
        faceNormal,
        // 本面数据：法线继承源（本层没自己的图片法线时沿用卡面底图那份）。
        face,
        aspect,
        cornerRadius,
      })
      const mesh = new Mesh(geometry, mat)
      mesh.position.z = z
      mesh.renderOrder = i + 1
      nextMeshes.push(mesh)
      nextMats.push(mat)
      z += LAYER_Z_STEP
    }

    return { baseMat: nextBaseMat, meshes: nextMeshes, mats: nextMats }
  }

  /** 释放一份尚未换入的构建结果（重建被取代 / 另一面失败时）。 */
  function disposeParts(parts: FaceParts): void {
    parts.baseMat.dispose()
    for (const mat of parts.mats) mat.dispose()
  }

  /** 原子换入一面：先摘旧网格、释放旧材质，再挂新。 */
  function swapFace(stack: FaceStack, parts: FaceParts): void {
    for (const m of stack.layers) stack.group.remove(m)
    for (const mat of stack.layerMats) mat.dispose()
    stack.baseMat?.dispose()

    stack.baseMat = parts.baseMat
    stack.baseMesh.material = parts.baseMat
    for (const m of parts.meshes) stack.group.add(m)
    stack.layers.length = 0
    stack.layers.push(...parts.meshes)
    stack.layerMats = parts.mats
  }

  /**
   * 按揭晓状态决定主卡面平面挂哪份材质：未揭晓挂底纹，揭晓后（或本来就没有揭晓过程）挂真卡面。
   *
   * 真卡面的材质始终留在 `frontStack.baseMat` 里——它可能还没建好（首帧之前），此时不动，
   * 等 rebuild 落地后再由这里接管。每次换入都调一次，否则重建会把底纹顶掉。
   */
  function syncFrontBaseMaterial(): void {
    const mat = mystery && !revealed ? mystery.material : frontStack.baseMat
    if (mat) frontStack.baseMesh.material = mat
  }

  /**
   * 用当前 card / back 重建整场（图层数量/顺序变化时调用）。
   *
   * 采用「先建后台、再原子换入」：两面的新材质都建好后才替换旧场景；中途若被更新的重建
   * 取代、视图已销毁或任一面构建失败，则丢弃本轮已建材质，保持旧场景不变。
   */
  async function rebuild(): Promise<void> {
    const gen = ++rebuildGen

    // 正反两面走同一条管线、并行构建；没有卡背时背面留空（不是失败）。
    const [frontParts, backParts] = await Promise.all([
      buildFace(card, gen, ""),
      back ? buildFace(back, gen, "back") : null,
    ])
    if (disposed || gen !== rebuildGen) {
      if (frontParts) disposeParts(frontParts)
      if (backParts) disposeParts(backParts)
      return
    }
    // 任一面失败（buildFace 已就地释放自己的部分）：释放另一份，保持旧场景。
    if (frontParts === null || (back !== null && backParts === null)) {
      if (frontParts) disposeParts(frontParts)
      if (backParts) disposeParts(backParts)
      return
    }

    swapFace(frontStack, frontParts)
    if (backParts) swapFace(backStack, backParts)
    // swapFace 会把真卡面材质挂上去；未揭晓时再盖回底纹。
    syncFrontBaseMaterial()

    // 释放已删除 / 已改成普通层的文字纹理。用**未过滤**的图层树：关掉眼睛的层仍保留纹理，
    // 免得反复开关时重画。两面的 id 都带上面作用域后取并集（同 id 的正反层互不覆盖）。
    const ids = new Set(flattenLayers(card.layers).map((e) => scopedLayerId("", e.layer.id)))
    if (back) {
      for (const e of flattenLayers(back.layers)) ids.add(scopedLayerId("back", e.layer.id))
    }
    textCache.retain(ids)

    dirty = true
  }

  /**
   * 逐帧同步相机位置到材质（视线/反射计算依赖它）。
   *
   * 材质参数（光泽、摩尔纹、渐变空间等）不在此处更新，而是统一由 {@link rebuild} 一次性写入；
   * update 走重建路径保证参数落地。这里只负责每帧都变、且与几何无关的相机位置。
   */
  function updateUniforms(): void {
    for (const stack of [frontStack, backStack]) {
      if (stack.baseMat) {
        stack.baseMat.uniforms.uCameraPosition.value.copy(camera.position)
      }
      for (const mat of stack.layerMats) {
        mat.uniforms.uCameraPosition.value.copy(camera.position)
      }
    }
  }

  function applyTilt(): void {
    // 倾斜与翻面角只写在 cardGroup 上：两面与侧壁一起转，背面组预转的半圈随之生效。
    cardGroup.rotation.set(tilt.x, tilt.y, 0)
    // 边缘倒角：平视保留一层很淡的厚度，转起来再增强。
    const edgeTilt = 0.25 + 0.75 * Math.min(1, (Math.abs(tilt.x) + Math.abs(tilt.y)) / 0.45)
    frontEdgeMat.uniforms.uTilt.value = edgeTilt
    backEdgeMat.uniforms.uTilt.value = edgeTilt
    // 材质是 DoubleSide，两面同时在场会透出对面的镜像图层；按朝向只画朝观察者的那一面。
    // 单面卡没有「另一面」可换：正面组必须常显——弹簧回弹会甩过 ±90°，若按朝向隐藏，
    // 卡片与图层会空白两三帧（桌面编辑器 / 卡牌详情会看到）。背面组仍恒藏。
    const front = frontVisible(tilt.y)
    frontGroup.visible = back === null || front
    backGroup.visible = back !== null && !front
    // 正面图层（蒙版 / 擦除 / 文字 / 图片都在各自的图层网格上）只在翻面落定后放行；
    // 卡面那一张仍按上面的朝向规则常显，免得落定过程中出现空白卡。单面卡恒显。
    const showFrontLayers = back === null || frontLayersShown
    for (const m of frontStack.layers) m.visible = showFrontLayers
  }

  /**
   * 相机距离：缩放推拉与「整张卡都进画幅」的下限取大者。
   *
   * 宽高比可调的卡可以很宽，窄画幅（编辑器预览侧栏）下固定距离会把左右边缘裁掉；
   * 下限只在大卡 / 窄画幅时才高于基准距离，5:7 的既有取景不受影响。
   */
  function applyCameraDistance(): void {
    const { width, height } = host.size()
    const viewportAspect = (width || 1) / (height || 1)
    const distance = Math.max(
      zoomToCameraDistance(zoom),
      fitCameraDistance(aspect, viewportAspect, CAMERA_FOV),
    )
    camera.position.set(0, 0, distance)
    // 高光/反射着色读的是 uCameraPosition，推拉后必须同步，否则高光停在旧视角。
    updateUniforms()
  }

  function resize(): void {
    if (disposed) return
    const { width, height } = host.size()
    const w = width || 1
    const h = height || 1
    // 小程序节点没有真实的 style，传 false 免去无意义的样式写入。
    renderer.setSize(w, h, host.updateStyle ?? true)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    applyCameraDistance()
    dirty = true
  }

  const stopResize = host.onResize(resize)

  const stopPointer = host.onPointer({
    down(x, y) {
      dragging = true
      lastPointerX = x
      lastPointerY = y
      lastMoveAt = now()
      tiltVel = { x: 0, y: 0 }
    },
    move(x, y) {
      if (!dragging) return
      const t = now()
      const dx = x - lastPointerX
      const dy = y - lastPointerY
      // 翻面态只认横向位移（纵向完全不参与）；自由态的双面卡可绕 Y 转满 360°，
      // 单面卡沿用旧的夹幅版本，行为与改造前一致。
      const next =
        phase === "back"
          ? { x: 0, y: dragFlip(tilt.y, dx) }
          : back
            ? dragSpin(tilt, dx, dy)
            : dragTilt(tilt, dx, dy)
      // 角速度由「角增量 / 时间」推得，作松手后的初速度继续回弹。
      // 距上次移动太久（停住后再拖）则不记速度，免得把上一段的旧速度带进来。
      const dt = (t - lastMoveAt) / 1000
      tiltVel =
        dt <= STALE_MOVE_MS / 1000
          ? capVelocity({
              x: (next.x - tilt.x) / Math.max(dt, MIN_VELOCITY_DT),
              y: (next.y - tilt.y) / Math.max(dt, MIN_VELOCITY_DT),
            })
          : { x: 0, y: 0 }
      tilt = next
      lastPointerX = x
      lastPointerY = y
      lastMoveAt = t
      dirty = true
    },
    up() {
      if (!dragging) return
      dragging = false
      // 两态在**松手**这一刻切换：过阈值就落向拖拽方向的主卡面，否则弹回卡背。
      if (phase === "back" && flipLands(tilt.y)) {
        landed = landedFlip(tilt.y)
        phase = "front"
        revealPending = true
      }
      // 停住后才松手 → 不发惯性；否则保留上一帧角速度，让卡片甩出去再晃回。
      if (now() - lastMoveAt > STALE_MOVE_MS) tiltVel = { x: 0, y: 0 }
      dirty = true
    },
  })

  // 拾色射线：只测卡面本身。图层贴在卡面前方，若一并参与会先命中图层——而吸管要取的是
  // 卡面原画的颜色。复用同一对对象，避免每次拾取都新建（拾取是低频操作，但没理由制造垃圾）。
  const raycaster = new Raycaster()
  const pickNdc = new Vector2()

  /** 客户端坐标 → 卡面几何 UV；没打中卡面时返回 `null`。 */
  function pickUv(clientX: number, clientY: number): { u: number; v: number } | null {
    if (disposed) return null
    // `CanvasLike` 不含 getBoundingClientRect（小程序节点没有它），拿不到就退到宿主尺寸
    // （DOM 宿主里 canvas 铺满容器，只有容器有边距时才对不上，而拾取只发生在桌面端）。
    const el = renderer.domElement as unknown as { getBoundingClientRect?: () => PickRect }
    const rect = el.getBoundingClientRect?.() ?? { left: 0, top: 0, ...host.size() }
    const ndc = clientToNdc(clientX, clientY, rect)
    if (ndc === null) return null
    pickNdc.set(ndc.x, ndc.y)
    raycaster.setFromCamera(pickNdc, camera)
    // 仍只测正面组的卡面（背面组只是同一几何的镜像，拾取只服务于正面绘制）。
    const uv = raycaster.intersectObject(frontBaseMesh, false)[0]?.uv
    return uv ? { u: uv.x, v: uv.y } : null
  }

  // 反投影的复用向量：每帧（指针移动时）调几次，不该每次 new。
  const projected = new Vector3()

  /**
   * 卡面 UV → 客户端坐标（`pickUv` 的反向映射，含倾斜与透视）。
   *
   * 只做投影，不做可见性裁剪：UV 落在 [0, 1] 之外也会给出（外推的）屏幕位置。调用方用它
   * 量屏幕上两点的距离来求「卡面像素 → 屏幕像素」的比例——例如预览里画笔范围圈的大小。
   * 正面不可见（翻到背面）时返回 `null`：那时投出来的是卡背的位置，没有意义。
   */
  function uvToClient(u: number, v: number): { x: number; y: number } | null {
    if (disposed || !frontVisible(tilt.y)) return null
    const el = renderer.domElement as unknown as { getBoundingClientRect?: () => PickRect }
    const rect = el.getBoundingClientRect?.() ?? { left: 0, top: 0, ...host.size() }
    // 卡面平面自带的局部坐标：几何是 PlaneGeometry(aspect, 1)，UV 的 0.5 在中心。
    frontBaseMesh.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()
    projected
      .set((u - 0.5) * aspect, v - 0.5, 0)
      .applyMatrix4(frontBaseMesh.matrixWorld)
      .project(camera)
    return ndcToClient({ x: projected.x, y: projected.y }, rect)
  }

  /** 角与角速度都已在阈值内 → 认为弹簧已归位。 */
  function settled(a: Tilt, v: Tilt, r: Tilt): boolean {
    return (
      Math.abs(a.x - r.x) < TILT_EPSILON &&
      Math.abs(a.y - r.y) < TILT_EPSILON &&
      Math.abs(v.x) < TILT_EPSILON &&
      Math.abs(v.y) < TILT_EPSILON
    )
  }

  /** 弹簧平衡点：翻面态静止在卡背；自由态是落定角 + 空闲摆动（或零）。 */
  function restTilt(seconds: number): Tilt {
    if (phase === "back") return { x: 0, y: FLIP_START }
    const sway = swayEnabled ? idleSway(seconds) : ZERO_TILT
    return { x: sway.x, y: landed + sway.y }
  }

  /**
   * 把当前翻面进度（1% 量化）推给订阅者。
   *
   * 进度取自**翻面角** `tilt.y`：翻面态没有摆动混入；松手后的落定弹簧期间给出 0.5 → 1 的
   * 连续爬升（光晕要按转角线性亮起）。落定之后进度钉在 1：自由态的空闲摆动会让角度继续
   * 变化，但 `percent` 恒为 100、与 `lastPercent` 相同，不再产生任何回调。单面卡没有翻面，
   * 进度恒 1，倾斜同样不回报；起始就在正面的双面卡同理（它没有落定这回事）。
   *
   * 量化值未变、且本帧没有刚把 `revealed` 翻真时直接跳过——一次完整翻牌最多 100 次回调。
   */
  function notifyFlip(revealedNow: boolean): void {
    // 只有「正在翻面」才按角度算进度：卡背朝外，或松手后正落向主卡面。
    const flipping = phase === "back" || revealPending
    const percent =
      back === null || revealed || !flipping ? 100 : Math.round(flipProgress(tilt.y) * 100)
    if (percent === lastPercent && !revealedNow) return
    lastPercent = percent
    const state: FlipState = { progress: percent / 100, revealed }
    for (const cb of flipSubs) cb(state)
  }

  let raf = 0
  function loop(t: number): void {
    if (disposed) return
    raf = requestFrame(loop)

    const dt = Math.min((t - lastFrameAt) / 1000, MAX_FRAME_DT)
    lastFrameAt = t

    // 自流动只推进全息层的 uTime；相位自己走，卡面不晃。牌堆里只有当前张打开。
    if (flowEnabled) {
      const seconds = t / 1000
      for (const stack of [frontStack, backStack]) {
        if (stack.baseMat && stack.baseMat.uniforms.uTime) stack.baseMat.uniforms.uTime.value = seconds
        for (const mat of stack.layerMats) {
          if (mat.uniforms.uTime) mat.uniforms.uTime.value = seconds
        }
      }
      dirty = true
    }

    // 拖拽中角度由指针事件就地设值，循环不插手；松手后才交给弹簧。
    if (!dragging) {
      const rest = restTilt(t / 1000)
      // 空闲摆动只在自由态（主卡面朝外）生效 → 此时每帧都动、恒置脏；
      // 其余情况先判是否已归位，归位即停手（省电）。
      const useSway = phase === "front" && swayEnabled
      if (useSway || !settled(tilt, tiltVel, rest)) {
        const next = springStep(tilt, tiltVel, rest, dt)
        tilt = next.angle
        tiltVel = next.vel
        dirty = true
      }
    }

    if (dirty) {
      // 落定判定先做：applyTilt 的正面图层闸门与 notifyFlip 都读它，同一帧才能一起生效；
      // 仍在 render 之前，`revealed` 随本帧的通知一起带出去。
      let revealedNow = false
      if (revealPending && flipSettled(tilt.y, landed)) {
        revealPending = false
        revealed = true
        frontLayersShown = true
        revealedNow = true
        // 真卡面上场：底纹让位并立刻释放（一张 480×672 的 RGBA 纹理，留着纯占显存）。
        syncFrontBaseMaterial()
        mystery?.dispose()
        mystery = null
      }
      applyTilt()
      updateUniforms()
      notifyFlip(revealedNow)
      renderer.render(scene, camera)
      dirty = false
    }
  }

  resize()
  void rebuild()
    .then(() => {
      if (!disposed) raf = requestFrame(loop)
    })
    .catch((err) => {
      console.error("[card-renderer] 初次构建失败", err)
      if (!disposed) raf = requestFrame(loop)
    })

  /** 侧壁网格的几何与两块材质一起释放（换圆角、销毁都走这里）。 */
  function disposeSlab(mesh: Mesh): void {
    mesh.geometry.dispose()
    for (const mat of mesh.material as unknown[]) (mat as { dispose(): void }).dispose()
  }

  return {
    update(next: CardFace) {
      // 参数级更新可增量；图层数量/顺序变化则重建（此处简化：始终重建，正确优先）。
      card = next
      frontEdgeMat.uniforms.uLightAngle.value = next.frontBumpLightAngle
      // 与初次构建一致地兜住失败，避免资源解析异常变成未处理的 rejection。
      void rebuild().catch((err) => console.error("[card-renderer] 重建失败", err))
    },
    clearTilt() {
      // 复位到「当前朝向的静止位」，不会把卡翻过去。
      if (phase === "back") tilt = { x: 0, y: FLIP_START }
      else if (back !== null) tilt = { x: 0, y: landed }
      else tilt = { x: 0, y: 0 }
      tiltVel = { x: 0, y: 0 }
      dirty = true
    },
    setZoom(next) {
      zoom = next
      applyCameraDistance()
      dirty = true
    },
    setCornerRadius(next) {
      const radius = clampCornerRadius(aspect, next)
      if (radius === cornerRadius) return
      cornerRadius = radius
      // 遮罩是逐材质的 uniform：两面与全部图层一起换，免得圆角处新旧两套轮廓并存。
      for (const stack of [frontStack, backStack]) {
        if (stack.baseMat) stack.baseMat.uniforms.uCornerRadius.value = radius
        for (const mat of stack.layerMats) mat.uniforms.uCornerRadius.value = radius
      }
      frontEdgeMat.uniforms.uCornerRadius.value = radius
      backEdgeMat.uniforms.uCornerRadius.value = radius
      if (mystery) mystery.material.uniforms.uCornerRadius.value = radius
      // 侧壁是几何：整块重建。旧的那块立刻释放，滑杆连续拖动不至于堆积。
      const nextSlab = createCardSlab(aspect, radius)
      nextSlab.renderOrder = slab.renderOrder
      const previous = slab
      cardGroup.remove(previous)
      disposeSlab(previous)
      slab = nextSlab
      cardGroup.add(slab)
      dirty = true
    },
    resize,
    pickUv,
    uvToClient,
    onFlip(cb: (state: FlipState) => void) {
      flipSubs.add(cb)
      return () => {
        flipSubs.delete(cb)
      }
    },
    setEraseTexture(next: Texture | null, layerId: string | null = null) {
      if (layerId === null) liveErase = next
      else if (next) liveLayerErase.set(layerId, next)
      else liveLayerErase.delete(layerId)
      // 重建材质以换绑 sampler（纹理对象本身不重建，故开销只在材质构造与一次渲染）。
      void rebuild().catch((err) => console.error("[card-renderer] 擦除图切换失败", err))
    },
    refreshErase() {
      // 画布内容变了：让 three 重新上传这张纹理，并请求一帧。绘画期间调用方逐笔调用。
      if (liveErase) liveErase.needsUpdate = true
      for (const tex of liveLayerErase.values()) tex.needsUpdate = true
      dirty = true
    },
    setIdleSway(enabled: boolean) {
      swayEnabled = enabled
      dirty = true
    },
    setAutoFlow(enabled: boolean) {
      flowEnabled = enabled
      dirty = true
    },
    setErasePreview(enabled: boolean) {
      if (erasePreviewEnabled === enabled) return
      erasePreviewEnabled = enabled
      // 与 setEraseTexture 同理：uniform 在材质构造时写入，改开关要重建材质。
      void rebuild().catch((err) => console.error("[card-renderer] 擦除辅助显示切换失败", err))
    },
    dispose() {
      disposed = true
      cancelFrame(raf)
      stopResize()
      stopPointer()
      for (const stack of [frontStack, backStack]) {
        for (const m of stack.layers) stack.group.remove(m)
        for (const mat of stack.layerMats) mat.dispose()
        stack.baseMat?.dispose()
      }
      flipSubs.clear()
      frontGroup.remove(frontEdgeMesh)
      backGroup.remove(backEdgeMesh)
      frontEdgeMat.dispose()
      backEdgeMat.dispose()
      cardGroup.remove(slab)
      disposeSlab(slab)
      geometry.dispose()
      placeholderTexture.dispose()
      // 还没揭晓就销毁视图（抽卡中途离开页面）时，底纹也得放掉。
      mystery?.dispose()
      textCache.dispose()
      cache.dispose()
      // 走兜底版本：小程序里 three 的 dispose 末行会空指针（见 renderer-dispose.ts）。
      // 这里不兜住的话，调用方（组件 detached / 页面重建）的后续清理会被整个中断。
      disposeRenderer(renderer)
      host.canvas.remove()
    },
  }
}
