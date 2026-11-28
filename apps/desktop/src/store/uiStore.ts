/**
 * uiStore —— 纯 UI 状态（面板折叠、预览开关、对话框队列、缺失资源标记）。
 *
 * 架构位置：与 `packStore` 并列，但不含任何系列数据、不入撤销栈、不落盘（设计文档
 * §4.5）。之所以把「选中项」留在 `packStore` 而不搬到这里，见设计文档偏离 D1。
 *
 * 少数例外是跨会话保留的 UI 偏好（`language` / `editorVersion`）：它们由
 * `app/bootstrap.tsx` 经 tauri-plugin-store 读写，本 store 只持有当前值。
 */
import { create } from "zustand"
import type { EditorVersion } from "../app/editorVersions"
import type { LayoutMode } from "../app/layoutMode"
import type { InspectorTab } from "../features/cards/inspectorTabs"
import type { ExportFormat } from "../features/export/exportOptions"
import { ERASE_BRUSH_WIDTH } from "../features/preview/eraseCanvas"
import type { Language } from "../i18n/init"
import type { BundleInfo } from "../tauri/bundle"
import type { ContextMenuRequest } from "../ui/contextMenuModel"
import type { EffectTarget, FaceRef } from "./packStore"

/** 设置视图的分类清单；顺序即左侧导航的顺序。 */
export const SETTINGS_CATEGORIES = ["general", "appearance"] as const

/** 预览默认缩放倍数（200%）；「重置视角」也回到这里。 */
export const DEFAULT_PREVIEW_ZOOM = 2

/** 设置分类 id。 */
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

/** 待用户确认的破坏性操作。 */
export type PendingConfirm =
  | { kind: "delete-card"; cardId: string }
  | { kind: "delete-layer"; ref: FaceRef; layerId: string }
  | { kind: "delete-back" }

/**
 * 蒙版擦除的绘画请求：等用户在预览里把擦除图画完。
 *
 * 与其它预览交互同一套路数——存「要写回哪儿」，绘画本身由预览面板做。
 * 提交时把画好的 PNG 落盘、再经 `packStore.updateEffect` 写回 `path`，于是整次擦除
 * 是一步可撤销的历史。
 */
export interface ErasePaintRequest {
  /** 目标卡面。 */
  ref: FaceRef
  /** 目标效果列表（擦除只挂卡面，故实际恒为 `{ scope: "face" }`）。 */
  target: EffectTarget
  /** 要写回 `path` 的 maskErase 条目。 */
  effectId: string
}

/** `useUiStore` 的完整状态形状。 */
export interface UiStoreState {
  /** 当前界面语言。 */
  language: Language
  /**
   * 当前编辑器版本（编辑器 + 渲染器成套）。当前只有 v1，选择暂不改变行为，
   * 只是把「版本」这一维度立起来，供将来的 v2 分叉。
   */
  editorVersion: EditorVersion
  /**
   * 左右两栏是否**整栏隐藏**（宽度收为 0）。由顶部菜单栏的左右栏按钮驱动。
   *
   * 与 {@link folded} 的区别：`collapsed` 让整栏连同标题一起消失，`folded` 只把面板
   * **内容**折起来、标题栏仍在。两者刻意分开——标题栏常驻才能在一栏里堆叠多个面板、
   * 逐个折叠（见 `folded` 的说明）。
   */
  collapsed: { left: boolean; right: boolean }
  /**
   * 左右两栏的面板**内容**是否折叠（标题栏保留、占位不变）。由面板标题栏的箭头驱动。
   *
   * 保留标题栏是关键：一栏里可以叠放多个面板，折叠只收起各自的 body，标题仍可点开；
   * 整栏的显示/隐藏另走 {@link collapsed}。二者互不影响。
   */
  folded: { left: boolean; right: boolean }
  /** 预览显示正面还是背面。 */
  previewSide: "front" | "back"
  /** 检查器当前页签（设计 / 图层 / 效果 / 导出）；不持久化，换卡时保留。 */
  inspectorTab: InspectorTab
  /** 工作区布局模式（工作室 / 专注 / 紧凑）。 */
  layout: LayoutMode
  /** 预览是否在空闲时自动摆动（默认关闭；拖拽倾斜已常驻）。 */
  previewIdleSway: boolean
  /**
   * 预览缩放倍数。
   *
   * 这里**不夹取**：消费方 `@prismwright/renderer` 的 `zoomToCameraDistance` 会夹到
   * `[MIN_ZOOM, MAX_ZOOM]`，越界不会渲染出坏画面；而 UI 那侧滑杆与数字框都带边界。
   * 所以本字段不需要再守一道——与「8 色标上限」那条不同，那里的消费方是**拒绝**
   * （`parsePack` 直接判系列无效），越界会变成真实的故障。
   */
  previewZoom: number
  /** 预览是否显示棋盘底。 */
  showChecker: boolean
  /** 待确认的破坏性操作；`null` 表示无。 */
  pendingConfirm: PendingConfirm | null
  /**
   * 解析失败的资源相对路径。
   *
   * 由预览面板在 `resolveAsset` 失败时标记，供卡片树与图层列表打警示徽标。
   * 是「运行时观察结果」而非持久数据，故不落盘。
   */
  missingAssets: Record<string, true>
  /** 设置对话框是否打开。 */
  settingsOpen: boolean
  /**
   * 设置视图当前选中的分类。
   *
   * 放在 store 而不是组件内：发布对话框的「去设置」要能把用户直接送到「云开发」这一页
   * （见 `features/export/ExportDialog.tsx`），组件自己的 state 递不过去。同时这也让
   * 设置记住上次停留的分类，再次打开从原处继续。
   */
  settingsCategory: SettingsCategory
  /**
   * 导出对话框状态：是否打开 + 预选格式（由菜单项决定，可在对话框内切换）。
   */
  exportDialog: { open: boolean; format: ExportFormat }
  /**
   * 工程文件导出对话框：`cardId` 为 `null` 表示导出整个系列，否则导出这张卡。
   */
  bundleExport: { open: boolean; cardId: string | null }
  /**
   * 工程文件导入对话框：源路径 + 已经 `inspect` 出的清单。
   *
   * `info` 在关闭后保留：对话框淡出期间若立刻清空会闪一帧空壳。
   */
  bundleImport: { open: boolean; sourcePath: string | null; info: BundleInfo | null }
  /**
   * 当前自绘右键菜单（指针位置 + 条目）；`null` 表示没开。
   *
   * 放在 store 而不是各组件里：WebView 的默认菜单要在全局拦掉，而卡片树 / 图层树 / 文本
   * 输入框又各有各的条目。集中一处才能保证同一时刻只开一个，也让「点别处即关」只有一份实现。
   */
  contextMenu: ContextMenuRequest | null
  /**
   * 新建系列的默认目录（基路径）。新建时在其下以用户输入的名字建子目录。
   *
   * 由 `app/bootstrap.tsx` 经 tauri-plugin-store 读出并写入（同 `language` 的持久化
   * 路径，见 `app/packDir.ts`），本 store 只持有当前值；空串表示尚未解析出（非 Tauri
   * 环境），此时新建会被拦下并提示去设置里选目录。
   */
  newPackDir: string
  /**
   * 新建系列的中间态：已确定的基目录；`null` 表示无待确认的新建。
   *
   * 承载「触发新建」与「命名确认」之间的空隙——动作方置入基目录，`NewPackDialog`
   * 弹窗在用户确认名字后据此拼路径落盘。
   */
  pendingNewPack: { baseDir: string } | null
  /** 「重命名系列」对话框是否打开；名字在确认时才写回 store。 */
  pendingRenamePack: boolean
  /** 「抽卡概率」对话框是否打开；权重在确认时才写回 store。 */
  pendingProbabilities: boolean
  /** 「卡册排版」对话框是否打开；拖动落位时即时写回 store。 */
  albumOpen: boolean
  /** 「系列封面」对话框是否打开；导入成功即写回 store，没有单独的确认步骤。 */
  coverOpen: boolean
  /** 待完成的蒙版擦除绘画；`null` 表示没在画。 */
  erasePaint: ErasePaintRequest | null
  /**
   * 擦除画笔宽度（擦除画布像素，画布宽 500）。
   *
   * 进 store 而非绘画会话本地：用户调粗一次，下次再画还是这个宽度——这是偏好，不是
   * 单次会话的参数。默认值取 `ERASE_BRUSH_WIDTH`，与没有滑杆时的观感一致。
   */
  eraseBrushWidth: number
  /**
   * 擦除绘画时是否给被擦掉的区域铺一层底色。
   *
   * 默认开：擦掉的地方本来就是透明的，不铺底色分不清笔迹边界。它只影响交互视图，
   * 导出与正常浏览恒为真实结果（见 `CardView.setErasePreview`）。
   */
  erasePreview: boolean
  /**
   * 绘画会话的步进历史操作（撤销 / 重做一笔）；`null` 表示没在画。
   *
   * 由预览面板在会话存续期间注册、退出时摘除。画布与快照是纯视图资源，本不该进 store；
   * 这里只挂两个回调，好让 `edit.undo` / `edit.redo` 在绘画期间作用在画布上——否则
   * Ctrl+Z 会落到 pack 的历史上，把卡片在画笔底下改掉（甚至删掉正在画的擦除效果）。
   */
  erasePaintHistory: { undo: () => void; redo: () => void } | null

  setLanguage: (language: Language) => void
  setEditorVersion: (version: EditorVersion) => void
  toggleCollapsed: (side: "left" | "right") => void
  toggleFolded: (side: "left" | "right") => void
  setPreviewSide: (side: "front" | "back") => void
  setInspectorTab: (tab: InspectorTab) => void
  setLayout: (layout: LayoutMode) => void
  setPreviewIdleSway: (value: boolean) => void
  setPreviewZoom: (value: number) => void
  setShowChecker: (value: boolean) => void
  requestConfirm: (pending: PendingConfirm) => void
  resolveConfirm: () => void
  markMissing: (rel: string) => void
  clearMissing: (rel?: string) => void
  setSettingsOpen: (open: boolean) => void
  /** 切换设置视图的分类（发布对话框的「去设置」用它直达「云开发」）。 */
  setSettingsCategory: (category: SettingsCategory) => void
  /** 打开导出对话框并预选格式（由导出菜单项调用）。 */
  openExportDialog: (format: ExportFormat) => void
  /** 关闭导出对话框。 */
  closeExportDialog: () => void
  /** 打开工程导出对话框：`null` 导出系列，传卡片 id 导出单卡。 */
  openBundleExport: (cardId: string | null) => void
  /** 关闭工程导出对话框。 */
  closeBundleExport: () => void
  /** 打开导入对话框（源文件已检查通过）。 */
  openBundleImport: (sourcePath: string, info: BundleInfo) => void
  /** 关闭导入对话框（保留 `info`，见 {@link bundleImport}）。 */
  closeBundleImport: () => void
  /** 打开右键菜单；已开着的话直接替换（右键点了另一处）。 */
  openContextMenu: (request: ContextMenuRequest) => void
  /** 关闭右键菜单。 */
  closeContextMenu: () => void
  setNewPackDir: (dir: string) => void
  requestNewPack: (baseDir: string) => void
  resolveNewPack: () => void
  requestRenamePack: () => void
  resolveRenamePack: () => void
  /** 打开 / 关闭「抽卡概率」对话框（由文件菜单触发）。 */
  requestProbabilities: () => void
  resolveProbabilities: () => void
  /** 打开 / 关闭「卡册排版」对话框（由文件菜单触发）。 */
  setAlbumOpen: (open: boolean) => void
  /** 打开 / 关闭「系列封面」对话框（由文件菜单与编辑区右键菜单触发）。 */
  setCoverOpen: (open: boolean) => void
  /** 进入蒙版擦除绘画：预览面板据此挂上画笔层。 */
  requestErasePaint: (request: ErasePaintRequest) => void
  /** 结束绘画（提交、按 Esc、或目标消失都走这里）。 */
  resolveErasePaint: () => void
  /** 注册 / 摘除绘画会话的步进历史（见 {@link erasePaintHistory}）。 */
  setErasePaintHistory: (history: { undo: () => void; redo: () => void } | null) => void
  setEraseBrushWidth: (width: number) => void
  setErasePreview: (enabled: boolean) => void
}

export const useUiStore = create<UiStoreState>()((set) => ({
  language: "zh-CN",
  editorVersion: "v1",
  collapsed: { left: false, right: false },
  folded: { left: false, right: false },
  previewSide: "front",
  inspectorTab: "design",
  layout: "studio",
  previewIdleSway: false,
  // 默认 2 倍：卡片在 1 倍下只占中间一小块，细节看不清；2 倍能直接看到印刷文字。
  previewZoom: DEFAULT_PREVIEW_ZOOM,
  showChecker: true,
  pendingConfirm: null,
  missingAssets: {},
  settingsOpen: false,
  settingsCategory: "general",
  exportDialog: { open: false, format: "gif" },
  bundleExport: { open: false, cardId: null },
  bundleImport: { open: false, sourcePath: null, info: null },
  contextMenu: null,
  newPackDir: "",
  pendingNewPack: null,
  pendingRenamePack: false,
  pendingProbabilities: false,
  albumOpen: false,
  coverOpen: false,
  erasePaint: null,
  eraseBrushWidth: ERASE_BRUSH_WIDTH,
  erasePreview: true,
  erasePaintHistory: null,

  setLanguage: (language) => set({ language }),
  setEditorVersion: (editorVersion) => set({ editorVersion }),

  toggleCollapsed: (side) =>
    set((s) => ({ collapsed: { ...s.collapsed, [side]: !s.collapsed[side] } })),

  toggleFolded: (side) => set((s) => ({ folded: { ...s.folded, [side]: !s.folded[side] } })),

  setPreviewSide: (previewSide) => set({ previewSide }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  // 专注模式把左栏收掉；其余模式恢复两栏。可见性仍以 `collapsed` 为准（菜单的显隐与
  // 布局模式因此共用同一条路径）。
  setLayout: (layout) =>
    set({
      layout,
      collapsed: { left: layout === "focus", right: false },
    }),
  setPreviewIdleSway: (previewIdleSway) => set({ previewIdleSway }),
  setPreviewZoom: (previewZoom) => set({ previewZoom }),
  setShowChecker: (showChecker) => set({ showChecker }),

  requestConfirm: (pendingConfirm) => set({ pendingConfirm }),
  resolveConfirm: () => set({ pendingConfirm: null }),

  markMissing: (rel) =>
    set((s) => {
      // 已标记过就不动引用：预览每次重建都会重报同一批失败路径，
      // 无脑替换会让订阅方每帧重渲染一次。
      if (s.missingAssets[rel]) return s
      return { missingAssets: { ...s.missingAssets, [rel]: true } }
    }),

  clearMissing: (rel) =>
    set((s) => {
      if (rel === undefined) return { missingAssets: {} }
      if (!s.missingAssets[rel]) return s
      const next = { ...s.missingAssets }
      delete next[rel]
      return { missingAssets: next }
    }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
  openExportDialog: (format) => set({ exportDialog: { open: true, format } }),
  closeExportDialog: () => set((s) => ({ exportDialog: { ...s.exportDialog, open: false } })),
  openBundleExport: (cardId) => set({ bundleExport: { open: true, cardId } }),
  closeBundleExport: () => set({ bundleExport: { open: false, cardId: null } }),
  openBundleImport: (sourcePath, info) => set({ bundleImport: { open: true, sourcePath, info } }),
  closeBundleImport: () => set((s) => ({ bundleImport: { ...s.bundleImport, open: false } })),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  setNewPackDir: (newPackDir) => set({ newPackDir }),

  requestNewPack: (baseDir) => set({ pendingNewPack: { baseDir } }),
  resolveNewPack: () => set({ pendingNewPack: null }),

  requestRenamePack: () => set({ pendingRenamePack: true }),
  resolveRenamePack: () => set({ pendingRenamePack: false }),

  requestProbabilities: () => set({ pendingProbabilities: true }),
  resolveProbabilities: () => set({ pendingProbabilities: false }),
  setAlbumOpen: (albumOpen) => set({ albumOpen }),
  setCoverOpen: (coverOpen) => set({ coverOpen }),

  requestErasePaint: (erasePaint) => set({ erasePaint }),
  // 一并摘掉步进历史：会话已结束，残留的回调若被 Ctrl+Z 命中，只会作用在一张
  // 已经 dispose 的画布上（预览面板的 effect 清理也会再摘一次，两处幂等）。
  resolveErasePaint: () => set({ erasePaint: null, erasePaintHistory: null }),
  setErasePaintHistory: (erasePaintHistory) => set({ erasePaintHistory }),

  setEraseBrushWidth: (eraseBrushWidth) => set({ eraseBrushWidth }),
  setErasePreview: (erasePreview) => set({ erasePreview }),
}))
