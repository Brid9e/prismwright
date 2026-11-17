/**
 * @cardbara/renderer 的公共类型。
 */
import type { CardFace, Layer } from "@cardbara/schema"
import type { Texture } from "three"
import type { CardViewHost } from "./host"

/**
 * 资源解析器：把系列内相对路径解析为可用的 three 纹理。
 *
 * 由调用方注入，是 renderer 与运行环境解耦的关键——浏览器环境可用 URL 直载，
 * Tauri 环境则经文件系统读字节再建纹理。renderer 不关心图片来源。
 */
export type ResolveAsset = (relPath: string, opts?: { signal?: AbortSignal }) => Promise<Texture>

/** {@link createCardView} 的选项。 */
export interface CardViewOptions {
  /** 视图宿主：canvas、尺寸、指针与帧调度由调用方注入。 */
  host: CardViewHost
  /** 主卡面（正面）；初始朝哪面由 `face` 决定。 */
  card: CardFace
  /** 卡背。给了才是双面卡：可以绕竖直轴翻到背面去看。 */
  back?: CardFace | null
  /** 初始朝向，默认 `"front"`；`"back"` 时进入翻面交互（只在给了 `back` 时生效）。 */
  face?: "front" | "back"
  /** 资源解析器。 */
  resolveAsset: ResolveAsset
  /** 空闲是否自动摆动（默认 `true`）。 */
  idleSway?: boolean
  /**
   * 全息图案是否随时间自己流动（默认 `false`）。
   *
   * 只推进全息层的 `uTime`，不改倾斜角；牌堆里只给最上面一张打开，
   * 划走后下一张接上，其余层保持静止。
   */
  autoFlow?: boolean
  /** 初始缩放倍数（默认 `1`）；超出 `[MIN_ZOOM, MAX_ZOOM]` 会被夹取。 */
  zoom?: number
  /**
   * 卡面宽高比（宽/高，默认 `CARD_ASPECT` 即 5:7）。
   *
   * 宽高比属于「几何」，改了要重建视图：调用方换卡时按新值重建（见 desktop 的 useCardView）。
   */
  aspect?: number
  /**
   * 卡片圆角半径（卡高单位，默认 `0.06`；0.5 = 完全圆头）。
   *
   * 窄卡的可用上限受半宽限制，渲染时按 `min(值, 宽/2, 0.5)` 夹取。可在运行中经
   * {@link CardView.setCornerRadius} 调整（几何与着色器一起换）。
   */
  cornerRadius?: number
}

/** 翻面状态（见 {@link CardView.onFlip}）。 */
export interface FlipState {
  /** 进度 0–1：0 = 完整卡背，1 = 完整主卡面。 */
  progress: number
  /** 已落到主卡面；落到后只回调一次 `true`。 */
  revealed: boolean
}

/** 视图句柄，供调用方在数据/尺寸变化与销毁时驱动。 */
export interface CardView {
  /** 数据变更后就地更新（尽量增量，避免整场重建）。 */
  update(card: CardFace): void
  /** 复位倾斜角并清空角速度（「重置视角」用）；随后回到空闲摆动 / 静止驱动。 */
  clearTilt(): void
  /** 设置缩放倍数（推拉相机）；超出 `[MIN_ZOOM, MAX_ZOOM]` 会被夹取。 */
  setZoom(zoom: number): void
  /**
   * 设置圆角半径（卡高单位，0–0.5；会按卡宽一半夹取）。
   *
   * 与 `update(card)` 的分工：这是纯几何参数，只影响圆角遮罩与侧壁，不重建图层；
   * 拖动「圆角」滑杆时逐次调用即可。
   */
  setCornerRadius(cornerRadius: number): void
  /** 重设相机与 viewport 至容器当前尺寸。 */
  resize(): void
  /**
   * 把客户端坐标（`clientX` / `clientY`）投到卡面原图上，返回几何 UV。
   *
   * 只测卡面本身，不理会图层（吸管要取的是卡面原画的颜色）。没打中卡面时返回 `null`
   * ——指针在卡片外，或卡面转过一个角度后该处已不在正面。
   *
   * 返回的是**卡面 UV**（texture 坐标），不含底图的填充 / 位移变换；调用方要取原图像素时
   * 再经 `frontUvTransform()` 换算。
   */
  pickUv(clientX: number, clientY: number): { u: number; v: number } | null
  /**
   * 卡面 UV → 客户端坐标，`pickUv` 的反向映射（含倾斜与透视）。
   *
   * 不做可见性裁剪：UV 在 [0, 1] 之外也返回外推位置。调用方（预览里的画笔范围圈）用它量
   * 屏幕上两点的距离，求「卡面像素 → 屏幕像素」的比例——缩放、倾斜都算在里面。
   * 正面不可见（已翻到背面）时返回 `null`。
   */
  uvToClient(u: number, v: number): { x: number; y: number } | null
  /**
   * 临时换用一张擦除图（绘画期间的即时预览）；传 `null` 回到按效果里的 `path` 解析。
   *
   * 与 `update(card)` 的分工：`update` 改的是**数据**（画完落盘后写回 path），本方法改的是
   * **画面**（还没落盘的那张）。绘画结束提交后用 `null` 还原，免得覆盖掉数据里的那一份。
   *
   * @param texture - 新纹理；`null` 表示撤销覆盖。
   * @param layerId - 落在哪张擦除图上：省略 / `null` = 卡面那张（整卡擦除）；图层 id =
   *   该层**自己**的那张。两张图是相乘关系，互不替代。
   */
  setEraseTexture(texture: Texture | null, layerId?: string | null): void
  /** 擦除画布内容变化后调用：让 three 重新上传纹理并渲染一帧。 */
  refreshErase(): void
  /**
   * 开 / 关「擦除区域底色」：被擦掉的地方铺一层半透明红色，方便看清笔迹边界。
   *
   * 只是**显示辅助**，不改输出：离屏导出与正常浏览恒为关，只有绘画会话里才打开。
   */
  setErasePreview(enabled: boolean): void
  /**
   * 开 / 关空闲摆动。绘画期间要关掉——卡片自己在动时，笔尖落点会跟着漂。
   *
   * 与构造选项 `idleSway` 同义，但可随时切换（构造选项只在建视图时生效）。
   */
  setIdleSway(enabled: boolean): void
  /** 开 / 关全息自流动；只在需要“静卡也在流”的页面打开。 */
  setAutoFlow(enabled: boolean): void
  /**
   * 订阅翻面进度。按 1% 量化，只在量化值或 `revealed` 变化时回调；返回取消订阅。
   *
   * 订阅时**不**立即回调（翻面页的初值就是 0）。
   */
  onFlip(cb: (state: FlipState) => void): () => void
  /** 销毁：停止渲染、释放 GPU 资源与事件监听。 */
  dispose(): void
}

export type { CardFace, Layer }
