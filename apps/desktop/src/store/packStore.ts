/**
 * packStore —— 系列编辑器的全局状态中枢（zustand）。
 *
 * 架构位置：位于 UI（React 组件）与数据/IO 层（`@prismwright/schema` + `pack-fs`）之间，
 * 是应用唯一的「当前系列」真相来源。组件只通过本 store 读写系列，不直接触碰文件系统，
 * 从而把「状态迁移 + 持久化时机 + 撤销历史」集中到单点，便于测试与推理。
 *
 * 职责范围（本文件分两个阶段落地）：
 * - 生命周期：新建 / 打开 / 保存（本任务）；
 * - 变更与历史：`commit()` 提交变更，及其撤销 / 重做（后续任务）。
 *
 * 状态设计要点：
 * - `pack` 是不可变替换：每次变更整体替换为新对象（结构共享由调用方 `commit` 负责深拷贝），
 *   这样 React 依赖引用比较即可精准重渲染，撤销栈也能直接保存历史引用；
 * - 撤销/重做用两个快照栈 `past` / `future` 表达，栈内元素是**旧引用**而非深拷贝；
 * - 所有写盘动作都是「先改内存、再异步落盘」，失败只标记 `error`，不丢弃内存数据，
 *   避免用户编辑成果因一次磁盘故障而丢失。
 */
import { create } from "zustand"
import {
  ancestorChain,
  createCard,
  createCardFace,
  createEmptyPack,
  createLayer,
  createTextLayer,
  detachLayer,
  exceedsNestDepth,
  findLayerById,
  findLayerLocation,
  flattenLayers,
  newId,
  parsePack,
  type Card,
  type CardFace,
  type Effect,
  type EffectKind,
  type EffectParams,
  type Layer,
  type Pack,
  type PackArtStyle,
  type TextParams,
} from "@prismwright/schema"
import { EFFECT_REGISTRY } from "@prismwright/renderer/v1"
import { join } from "../app/path"
import { prepareImportImage } from "../features/assets/compress"
import { composeGroup } from "../features/flatten/compose"
import { applyFlatten, planFlatten } from "../features/flatten/pack-flatten"
import {
  COVER_EXTENSIONS,
  coverAspectError,
  coverDirOf,
  coverFieldOf,
  type CoverKind,
} from "../features/pack/cover"
import { prepareCoverImage } from "../features/pack/cover-image"
import { measureCover } from "../features/pack/cover-measure"
import {
  sameProbabilities,
  sanitizeProbabilities,
  type TierWeights,
} from "../features/pack/probability"
import { packFs } from "../tauri/pack-fs"
import {
  defaultLayerName,
  defaultTextLayerName,
  fillDefaultLayerNames,
  nextLayerNum,
  nextTextLayerNum,
} from "./layer-naming"
import { collectCardRels, collectPackRels } from "./resources"
import { useUiStore } from "./uiStore"

/** 系列相对磁盘的保存状态机。`idle` 表示尚未绑定任何系列。 */
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error"

/** 撤销历史的最大深度。超过则丢弃最早的快照，防止长时间编辑下内存无界增长。 */
const HISTORY_LIMIT = 100

/** 合并窗口（毫秒）。相同 `mergeKey` 的连续提交若落在该窗口内则合并为一步。 */
const MERGE_WINDOW_MS = 500

/**
 * 成功打开系列后清理回收站时保留的最新条目数。
 *
 * `.trash` 只增不减会无界膨胀；打开时顺手只保留最近 N 条（与 {@link HISTORY_LIMIT}=100
 * 同样的「有界」精神，取一半量级），既为「刚删就撤销」留出恢复窗口，又能回收陈旧文件。
 * 仅在打开时清理、不在每次保存时清理，以免造成无谓的 IO 抖动。
 */
const TRASH_KEEP = 50

/**
 * `commit` 的可选参数。
 */
export interface CommitOptions {
  /** 相同 mergeKey 且在时间窗内的连续提交会被合并为一步（如拖拽滑杆产生的连续微调）。 */
  mergeKey?: string
  /** 测试可注入的当前时间（毫秒时间戳），用于确定性验证合并窗口。生产环境省略取 `Date.now()`。 */
  now?: number
}

/** 参数更新的可选参数。 */
export interface UpdateOptions {
  /** 测试可注入的当前时间（毫秒时间戳），用于确定性验证合并窗口。生产环境省略取 `Date.now()`。 */
  now?: number
}

/** 允许导入的图片扩展名（小写，不含前导点）。 */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const

/**
 * 取路径的扩展名（小写，不含前导点）；无扩展名时返回空串。
 *
 * @param path - 文件路径（可以是绝对路径或相对路径）。
 */
export function fileExtension(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path)
  return match ? match[1].toLowerCase() : ""
}

/**
 * 按 id 在系列的两份卡片列表中查找卡片。
 *
 * 普通卡与隐藏款分处两个数组（`cards` / `hiddenCards`），任何「按 id 找卡」的
 * 调用点都必须同时搜索两者：只搜 `cards` 会让隐藏款在被选中后既不显示预览、
 * 也无法编辑（而 `addCard(true)` 恰恰会自动选中新建的隐藏款）。
 */
export function findCard(pack: Pack | null, cardId: string | null): Card | null {
  if (!pack || !cardId) return null
  return (
    pack.cards.find((c) => c.id === cardId) ?? pack.hiddenCards.find((c) => c.id === cardId) ?? null
  )
}

/**
 * 资源导入的目标位置。
 *
 * - `maskEffect` 指向一条既存的 `imageMask` 效果条目（图层）；
 * - `imageEffect` 指向一条既存的 `image` 效果条目（图层）；
 * - `normalEffect` 指向同一条 `image` 效果的**法线图字段**（`params.normalPath`）。
 *
 * 后两者同指一个 `image` 效果、只是字段不同：合并成一种会把法线图写进主图（画面变、不报错）。
 * `effectId` 是该效果的 id。
 */
export type AssetTarget =
  | { kind: "maskEffect"; layerId: string; effectId: string }
  | { kind: "imageEffect"; layerId: string; effectId: string }
  | { kind: "normalEffect"; layerId: string; effectId: string }

/** 资源导入的结果。 */
export type ImportResult =
  | { ok: true; rel: string }
  | {
      ok: false
      reason: "no-pack" | "no-target" | "unsupported-format" | "copy-failed"
      message?: string
    }

/** 系列封面导入的结果。 */
export type CoverImportResult =
  | { ok: true; rel: string }
  | {
      ok: false
      reason: "no-pack" | "unsupported-format" | "measure-failed" | "aspect" | "copy-failed"
      width?: number
      height?: number
      aspect?: string
      message?: string
    }

/** 擦除图提交的结果。成功给出新落盘路径，失败给出原因（不抛异常）。 */
export type EraseCommitResult =
  | { ok: true; path: string }
  | {
      ok: false
      reason: "no-pack" | "no-target" | "write-failed"
      message?: string
    }

/**
 * 卡片面引用：卡片的可编辑内容（正面）或系列级背面。
 *
 * 图层与卡面动作统一接收本类型，使背面复用同一套编辑路径——schema 里
 * `Pack.back` 与 `Card` 共用 `CardFace`，这里保持一致（设计文档偏离 D3）。
 */
export type FaceRef = { kind: "card"; cardId: string } | { kind: "back" }

/**
 * 效果栈的目标：卡面或某个图层。
 *
 * 与 {@link FaceRef} 正交——效果列表挂在「卡面」或「某个图层」上，
 * 前者对应 `CardFace.effects`，后者对应 `Layer.effects`。
 */
export type EffectTarget = { scope: "layer"; layerId: string }

/**
 * {@link updateEffect} 可写入的一条效果的字段：启用开关 + 该 kind 的参数补丁。
 *
 * `enabled` 上提在 {@link EffectBase}、不在 `params` 里，故需与参数补丁分开收；这样沿用 store
 * 既有「更新原语接收含 `enabled` 的补丁」的惯例（{@link updateEffect} 一并收两者），面板的开关
 * 与滑块因而都走同一个原语。补丁按 `{ ...old, ...patch }` 部分合并，非整体替换。
 */
export type EffectPatch = Partial<EffectParams> & { enabled?: boolean }

/**
 * packStore 的完整状态形状：既包含数据（`pack` 等），也包含操作（各方法）。
 */
export interface PackStoreState {
  /** 当前打开的系列；`null` 表示尚未新建或打开任何系列。 */
  pack: Pack | null
  /** 当前系列所在目录的绝对路径；`null` 表示未绑定。 */
  rootDir: string | null
  /** 相对磁盘的保存状态（见 {@link SaveStatus}）。 */
  saveStatus: SaveStatus
  /** 最近一次失败的错误描述；成功或空闲时为 `null`。 */
  lastError: string | null
  /** 当前选中的卡片 ID；`null` 表示未选中。 */
  selectedCardId: string | null
  /** 当前选中的图层 ID；`null` 表示未选中。 */
  selectedLayerId: string | null
  /**
   * 图层剪贴板：`copyLayer` 存下的深拷贝快照（见 {@link PackStoreState.copyLayer}）。
   *
   * 只活在当前会话，不属于系列数据、也不进历史；`openPack` / `newPack` 会把它清空。
   * `null` 表示还没复制过图层。
   */
  layerClipboard: Layer | null
  /** 撤销栈：索引越大越新，末元素为「上一状态」。元素为历史快照引用。 */
  past: Pack[]
  /** 重做栈：索引 0 为「下一状态」，用于 undo 后的前进。 */
  future: Pack[]
  /** 上一次提交的合并键；与 `lastMergeTime` 共同决定下一次提交能否并入。 */
  lastMergeKey: string | null
  /** 上一次提交的时间戳（毫秒）；用于判断是否落在 {@link MERGE_WINDOW_MS} 窗口内。 */
  lastMergeTime: number
  /**
   * 被移入回收站的资源：相对路径 -> token。用于把「文件已删」与「撤销记录」对齐。
   * tombstone 仅存活于当前会话——`openPack` 会把它重置为空，因此跨会话无法撤销此前的
   * 删除（Phase 1 的已知取舍）。
   */
  trashTombstones: Record<string, string>
  /**
   * 已合并过、且之后被撤销回原样的图层组指纹（见 `features/flatten/flatten.ts` 的
   * `groupFingerprint`）。
   *
   * 自动保存是持续进行的：用户撤销一次合并想回到分层状态，撤销本身又会标脏，下一次
   * 自动保存若不加阻拦就会把同一组原样再合一次，撤销等于白按。这里的指纹就是那道阻拦——
   * 组一旦被改动，指纹随之变化，自然会重新参与合并。
   */
  flattenSkip: ReadonlySet<string>

  /**
   * 新建一个空系列并落盘。
   *
   * 副作用：在 `rootDir/assets` 建目录、写入 `pack.json`；成功后重置历史栈与选择态。
   *
   * @param name - 系列名（非空）。
   * @param rootDir - 系列根目录的绝对路径。
   * @returns 无（完成后 store 状态即为最新）。
   */
  newPack: (name: string, rootDir: string) => Promise<void>
  /**
   * 从磁盘打开一个已有系列。
   *
   * 读取 `pack.json` 并经 `parsePack` 迁移 + 校验；数据损坏时置 `error` 而不抛异常。
   *
   * @param rootDir - 系列根目录的绝对路径。
   * @returns 无。
   */
  openPack: (rootDir: string) => Promise<void>
  /**
   * 关闭当前系列，回到启动屏。
   *
   * 与 `openPack` 失败分支同构：整体重置回 {@link createInitialState}（历史、错误、
   * 选择态一并归零）。**不落盘**——调用方（`packActions.closePackFlow`）负责先 `save()`。
   *
   * @returns 无。
   */
  closePack: () => void
  /**
   * 把当前内存中的系列写回 `pack.json`。
   *
   * 未绑定系列时为空操作；写盘期间 `saveStatus` 为 `saving`，成功后为 `saved`，
   * 失败置 `error`（保留 `pack`）。
   *
   * @returns 无。
   */
  save: () => Promise<void>
  /**
   * 把各卡面上可合并的纯图片图层合成一张（详见 `features/flatten/`）。
   *
   * 判据、换算与合成都在 `features/flatten` 里；本动作只负责编排：算出计划 → 把被取代
   * 且再无引用的原图移入回收站（记 tombstone，撤销可还原）→ 一次 `commit` 套用计划。
   *
   * 由 {@link save} 在落盘前调用；也可以单独调用来「立刻合并」。合成失败时抛出，
   * 由调用方决定如何处置——`save` 会吞掉它，原样落盘。
   *
   * @returns 合并的组数；没有可合并的组或系列未绑定时为 0。
   */
  flattenImages: () => Promise<number>
  /**
   * 提交一次对系列的不可变变更。
   *
   * 以「recipe 就地改写深拷贝草稿」的方式表达变更：先 `structuredClone` 当前 `pack`
   * 得到独立草稿，把草稿交给 `recipe` 自由改写，再把草稿整体替换为新 `pack`，
   * 并把变更前的旧引用压入撤销栈。这样既让调用方写法直观，又保证不可变性——
   * React 能靠引用比较精准重渲染，历史栈也天然持有各版本快照。
   *
   * 合并语义：当传入 `mergeKey` 且与上一次提交相同、且两次间隔小于
   * {@link MERGE_WINDOW_MS} 时，本次不新增历史点（视作同一步的延续），
   * 用于「连续微调」场景（如拖动滑杆）避免历史被逐帧提交淹没。
   *
   * 副作用：置 `saveStatus` 为 `dirty`、清空重做栈、推进 `updatedAt`。
   *
   * @param recipe - 接收深拷贝草稿并就地改写的回调。
   * @param opts - 可选：合并键与可注入的当前时间（见 {@link CommitOptions}）。
   */
  commit: (recipe: (draft: Pack) => void, opts?: CommitOptions) => void
  /**
   * 撤销一步：把 `pack` 回退到撤销栈栈顶，当前状态移入重做栈。
   *
   * 栈空或未绑定系列时为空操作。撤销后同样置 `dirty`（内存已偏离磁盘）。
   */
  undo: () => void
  /**
   * 重做一步：把 `pack` 前进到重做栈栈顶，当前状态压回撤销栈。
   *
   * 栈空或未绑定系列时为空操作。
   */
  redo: () => void
  /**
   * 新建一张卡片并追加到普通列表或隐藏款列表，随后选中它。
   *
   * 序号取目标列表中现有卡片的最大 `num` 加一，保证展示编号不与既有卡片冲突。
   *
   * @param hidden - `true` 追加到 `hiddenCards`（隐藏款），否则追加到 `cards`。
   * @returns 新卡片的 ID；未绑定系列时返回 `null`。
   */
  addCard: (hidden: boolean) => string | null
  /**
   * 删除一张卡片：先把其引用的资源移入回收站，再从数据中移除。
   *
   * 资源移动是「尽力而为」——单个文件缺失/移动失败不阻断删除，只记录 tombstone
   * 以便撤销时恢复（见 {@link reconcileTrash}）。删除后若被删卡片正处于选中态，
   * 则改选中普通列表的第一张；无卡可选中时置 `null`。
   *
   * @param cardId - 待删除卡片的 ID；不存在时为空操作。
   * @returns 无（回收站移动为异步，完成后 store 状态即为最新）。
   */
  deleteCard: (cardId: string) => Promise<void>
  /**
   * 删除本系列自己的卡背（`pack.back` 置回 `null`）。
   *
   * 只清引用、不动素材文件——与「删除卡面图」同一约定（见 `CardFaceFields`）：
   * 原图留在系列目录里，之后发布时不再被收集。整次删除进撤销历史，可整张恢复。
   * 删除后系列回落到全系列共用的默认卡背（若有），预览与发布都生效。
   */
  deleteBack: () => void
  /**
   * 手动设置保存状态（供 UI 或测试直接干预状态机）。
   *
   * @param status - 目标状态。
   */
  setSaveStatus: (status: SaveStatus) => void
  /**
   * 选中某张卡片；同时清空图层选择（图层属于具体卡片，切换卡片后旧的图层选择失效）。
   *
   * @param id - 卡片 ID；`null` 表示取消选中。
   */
  selectCard: (id: string | null) => void
  /**
   * 选中某个图层。
   *
   * @param id - 图层 ID；`null` 表示取消选中。
   */
  selectLayer: (id: string | null) => void
  /**
   * 追加一个空图层到指定卡面，并选中它。
   *
   * @param ref - 目标卡面（卡片正面或系列级背面）。
   * @returns 新图层的 ID；目标不存在时返回 `null`。
   */
  addLayer: (ref: FaceRef) => string | null
  /**
   * 新建一个带 `image` 效果的图层，并选中它（图层列表「添加图片」的一次提交）。
   *
   * 建层与加效果同处一个 `commit`，因此一次撤销即可让整个图层消失。
   *
   * @param ref - 目标卡面。
   * @returns 新图层与图片效果的 id；目标不存在时返回 `null`。
   */
  addImageLayer: (ref: FaceRef, atBottom?: boolean) => { layerId: string; effectId: string } | null
  /**
   * 新建一个文字图层，并选中它。
   *
   * 建层与选中一次完成、只产生一个历史点——一次撤销即可让整个文字层消失。
   *
   * @param ref - 目标卡面。
   * @param content - 初始文字内容（用户可见的默认串，由调用方按当前语言提供）。
   * @returns 新图层的 ID；目标不存在时返回 `null`。
   */
  addTextLayer: (ref: FaceRef, content: string) => string | null
  /**
   * 更新文字层的排版参数。
   *
   * **深度合并**：只改传入的字段，其余保留（`stroke` / `shadow` 作为整体替换）。
   * 合并键按 `text.<字段名>` 计算——拖同一个滑块合并成一步历史，换字段各自成步。
   *
   * @param ref - 目标卡面。
   * @param layerId - 文字图层 ID；非文字层时安静空操作。
   * @param patch - 要改的文字参数。
   * @param opts - 可选：可注入的当前时间。
   */
  updateTextLayer: (
    ref: FaceRef,
    layerId: string,
    patch: Partial<TextParams>,
    opts?: UpdateOptions,
  ) => void
  /**
   * 删除指定图层。
   *
   * 被删图层正处于选中态时清空图层选择。
   *
   * @param ref - 目标卡面。
   * @param layerId - 待删除图层的 ID。
   */
  deleteLayer: (ref: FaceRef, layerId: string) => void
  /**
   * 复制一个图层，插在原图层之后。
   *
   * 深拷贝字段并分配新 ID，`effects` / `children` 等数组不共享引用。
   *
   * @param ref - 目标卡面。
   * @param layerId - 待复制图层的 ID。
   * @returns 新图层的 ID；源图层不存在时返回 `null`。
   */
  duplicateLayer: (ref: FaceRef, layerId: string) => string | null
  /**
   * 把图层 `layerId`（连同整棵子树）存进剪贴板快照，供 {@link pasteLayer} 跨卡面粘贴。
   *
   * 存的是 `structuredClone` 的深拷贝：复制之后源图层再怎么改，粘出来的仍是按下复制
   * 那一刻的样子。不写历史——复制本身不改变系列数据。
   *
   * @param ref - 源卡面。
   * @param layerId - 待复制图层的 ID。
   * @returns 图层存在时为 `true`；卡面或图层不存在时返回 `false`（剪贴板保持不变）。
   */
  copyLayer: (ref: FaceRef, layerId: string) => boolean
  /**
   * 把剪贴板里的图层粘成目标卡面的最上层图层。
   *
   * 每次粘贴都从快照重新深拷贝并整棵重编 ID，因此连粘两次得到两层互不共享 id 的图层。
   * 名字沿用源层（复制语义），不像 {@link duplicateLayer} 那样另取默认名。整个粘贴是一次
   * 提交：`Ctrl+Z` 一步撤掉。
   *
   * @param ref - 目标卡面（可以是别的卡片，也可以是系列背面）。
   * @returns 新图层 ID；剪贴板为空或目标卡面不存在时返回 `null`。
   */
  pasteLayer: (ref: FaceRef) => string | null
  /**
   * 把图层 `layerId` 重挂到 `targetParentId` 之下（`null` 表示顶层），并插到同级第 `targetIndex` 位。
   *
   * 一次调用同时完成「换父级」与「同级重排」。以下情形安静空操作（不入历史）：
   * - 图层 / 目标父不存在；
   * - 目标父是被移动图层自身或其后代（会形成环）；
   * - 落位后深度超过 {@link MAX_NEST_DEPTH}；
   * - 落位结果与当前位置相同。
   *
   * @param ref - 目标卡面。
   * @param layerId - 待移动图层的 ID。
   * @param targetParentId - 落位后的父层 ID；`null` 表示顶层。
   * @param targetIndex - 在目标父（或顶层）子数组中的插入下标。
   */
  moveLayer: (
    ref: FaceRef,
    layerId: string,
    targetParentId: string | null,
    targetIndex: number,
  ) => void
  /**
   * 设置图层启用位。
   *
   * @param ref - 目标卡面。
   * @param layerId - 图层 ID。
   * @param enabled - 是否启用。
   */
  setLayerEnabled: (ref: FaceRef, layerId: string, enabled: boolean) => void
  /**
   * 更新卡片的元信息字段。
   *
   * @param cardId - 卡片 ID。
   * @param patch - 要改的字段（名称 / 备注 / 稀有度）。
   * @param opts - 可选：可注入的当前时间。
   */
  updateCard: (
    cardId: string,
    patch: Partial<Pick<Card, "name" | "notes" | "rarity">>,
    opts?: UpdateOptions,
  ) => void
  /**
   * 写入系列的抽卡权重表（`pack.rarityProbabilities`）。
   *
   * 五档权重在写入前经 {@link sanitizeProbabilities} 整理：负数 / NaN 归 0，权重为 0
   * 的档位直接不落进记录——空记录正是服务端「按卡数均匀、隐藏款抽不到」的现状语义，
   * 于是「全部清 0」能回到与新系列完全一致的 `pack.json`。
   *
   * 与现状等价（服务端眼里五档都没变）时空操作，不产生撤销点：面板点「确定」而没动
   * 任何数字，不该在历史里留下一步。
   *
   * @param weights - 五档权重（未在记录里的档位按 0 处理）。
   */
  setRarityProbabilities: (weights: TierWeights) => void
  /**
   * 写入系列的卡面宽高比（`pack.aspect`）。
   *
   * 比例是系列级的：整个系列的所有卡片与系列级卡背共用这一个值，改一次即全体生效，
   * 撤销也只回退一步。与现状等价（值没变）时空操作，不产生撤销点。
   *
   * @param aspect - 宽 / 高；调用方负责夹进合法区间（见 `clampAspect`）。
   * @param opts - 可选：可注入的当前时间。
   */
  setSeriesAspect: (aspect: number, opts?: UpdateOptions) => void
  /**
   * 更新卡包图的合成样式（`pack.packArtStyle`）。
   *
   * 只改 `patch` 里给出的字段，其余保持原值。滑杆拖动时连续调用；同一批字段在
   * 合并窗口内只留一个撤销点。
   *
   * @param patch - 要改的样式字段。
   * @param opts - 可选：可注入的当前时间。
   */
  updatePackArtStyle: (patch: Partial<PackArtStyle>, opts?: UpdateOptions) => void
  /**
   * 更新卡面字段（底色 / 圆角 / 表面材质）。图片与法线都在图层效果里。
   *
   * @param ref - 目标卡面。
   * @param patch - 要改的字段。
   * @param opts - 可选：可注入的当前时间。
   */
  updateFace: (
    ref: FaceRef,
    patch: Partial<
      Pick<
        CardFace,
        | "baseColor"
        | "finish"
        | "glassStrength"
        | "glassRoughness"
        | "glassTint"
        | "cornerRadius"
      >
    >,
    opts?: UpdateOptions,
  ) => void
  /**
   * 向目标的效果栈追加一条效果。
   *
   * 该 `kind` 的槽位（{@link EFFECT_REGISTRY}`[kind].maxPerTarget`）已满、或目标 / 图层
   * 不存在时**静默拒绝**：列表不增、也不入历史（判定发生在 `commit` 之前）。
   * 新条目 `enabled` 默认为 `true`，参数取注册表的 `defaultParams()`（每次全新对象）。
   *
   * @param ref - 目标卡面。
   * @param target - 效果挂载位置（卡面或某图层）。
   * @param kind - 效果种类；种类决定参数形状与槽位上限。
   * @param opts - 可选：可注入的当前时间。
   */
  addEffect: (ref: FaceRef, target: EffectTarget, kind: EffectKind, opts?: UpdateOptions) => void
  /**
   * 从目标的效果栈按 id 删除一条效果。
   *
   * id 在目标上不存在时静默拒绝（列表不变、不入历史）。
   *
   * @param ref - 目标卡面。
   * @param target - 效果挂载位置。
   * @param effectId - 效果条目 id。
   * @param opts - 可选：可注入的当前时间。
   */
  removeEffect: (ref: FaceRef, target: EffectTarget, effectId: string, opts?: UpdateOptions) => void
  /**
   * 局部更新目标上某条效果的启用开关与 / 或参数。
   *
   * 合并键为 `effect.<id>.<field>`：同一条效果的**同一字段**连续拖动合并为一步历史，
   * 换字段（或换条目）即产生新的历史点。补丁为空对象时无内容可写，不入历史。
   *
   * @param ref - 目标卡面。
   * @param target - 效果挂载位置。
   * @param effectId - 效果条目 id；不存在时静默拒绝。
   * @param patch - 启用开关与参数的部分更新（{@link EffectPatch}）。
   * @param opts - 可选：可注入的当前时间。
   */
  updateEffect: (
    ref: FaceRef,
    target: EffectTarget,
    effectId: string,
    patch: EffectPatch,
    opts?: UpdateOptions,
  ) => void
  /**
   * 在同一目标的效果栈内重排某条效果。
   *
   * 仅在同列表内移动（不跨目标）。`toIndex` 会被夹取到 `[0, list.length]`，越界不抛错。
   * id 不存在时静默拒绝（不入历史）。
   *
   * @param ref - 目标卡面。
   * @param target - 效果挂载位置。
   * @param effectId - 要移动的效果条目 id。
   * @param toIndex - 目标下标（移动前口径，落在删除该条后的列表上）。
   * @param opts - 可选：可注入的当前时间。
   */
  moveEffect: (
    ref: FaceRef,
    target: EffectTarget,
    effectId: string,
    toIndex: number,
    opts?: UpdateOptions,
  ) => void
  /**
   * 更新图层的着色器参数与展示字段。
   *
   * `id` 不可改——它是跨会话稳定引用，改掉会让选择态与历史快照失联。
   *
   * @param ref - 目标卡面。
   * @param layerId - 图层 ID。
   * @param patch - 要改的字段（不含 `id`）。
   * @param opts - 可选：可注入的当前时间。
   */
  updateLayer: (
    ref: FaceRef,
    layerId: string,
    patch: Partial<Omit<Layer, "id">>,
    opts?: UpdateOptions,
  ) => void
  /**
   * 导入一张图片到系列内，并把相对路径写回目标字段。
   *
   * 目标路径一律是唯一的 `assets/<uuid>.<ext>`：渲染器的纹理缓存以路径为键且
   * 永久有效（直到视图销毁），同名覆盖会让预览继续显示旧图，是隐蔽且难查的问题。
   * 唯一路径从根上消除该失效链路。代价是替换图片会留下孤儿文件——本阶段刻意
   * 不做自动清理（在用户数据上自动删文件的风险远大于垃圾文件的代价）。
   *
   * @param ref - 目标卡面。
   * @param target - 写到卡面图还是某个图层的蒙版。
   * @param srcAbsPath - 源文件绝对路径（通常来自 `packFs.pickFile`）。
   * @returns 导入结果；失败时给出原因，不抛异常。
   */
  importAsset: (ref: FaceRef, target: AssetTarget, srcAbsPath: string) => Promise<ImportResult>
  /**
   * 导入系列封面：**原始字节**写到 `covers/<uuid>.<ext>`，并把路径 commit 进 `pack.coverLarge` /
   * `pack.coverSmall`。
   *
   * 与 {@link importAsset} 的关键差别：不压缩、不转格式——GIF 的动画与 PNG 的透明通道
   * 都必须原样保留。比例不合就整体失败，不落盘、不改数据。
   *
   * @param kind - `large` 写系列头图，`small` 写列表缩略。
   * @param srcAbsPath - 源文件绝对路径（通常来自 `packFs.pickFile`）。
   * @returns 导入结果；失败时给出原因，不抛异常。
   */
  importCover: (kind: CoverKind, srcAbsPath: string) => Promise<CoverImportResult>
  /**
   * 把**已经裁剪好**的封面字节直接落盘。
   *
   * 裁剪在渲染进程里按封面比例完成，所以这里不再量尺寸、不再校验比例、也不再降采样；
   * 与 {@link importCover} 共用「唯一路径 + commit 进撤销栈」的落盘约定。
   *
   * @param kind - `large` 写系列头图，`small` 写列表缩略。
   * @param bytes - 裁剪后的图片字节（通常是画布导出的 WebP）。
   * @param ext - 扩展名（小写、不含前导点），决定落盘文件名。
   * @returns 导入结果；失败时给出原因，不抛异常。
   */
  importCoverBytes: (kind: CoverKind, bytes: Uint8Array, ext: string) => Promise<CoverImportResult>
  /**
   * 提交一次擦除绘画：把 PNG 字节写成**新**的 `assets/<uuid>.png`，并把路径写回目标 `maskErase` 效果。
   *
   * 每次都落到新路径，绝不复用上一次那张：渲染器的纹理缓存以路径为键且永久有效（直到视图
   * 销毁），历史快照也只存路径字符串。原地覆盖会让提交后的预览继续显示旧纹理（新笔迹不
   * 生效），撤销也会回到同一路径上的新像素（等于撤销失效）。代价与 {@link importAsset}
   * 同一取舍：旧擦除图成为孤儿文件，本阶段刻意不做自动清理。
   *
   * @param ref - 目标卡面。
   * @param target - 擦除效果挂在哪（卡面记录或某个图层）。
   * @param effectId - 该 `maskErase` 效果的 id。
   * @param bytes - PNG 文件字节。
   * @returns 结果；失败时给出原因，不抛异常——失败不写入任何数据，调用方可保持绘画态。
   */
  commitEraseImage: (
    ref: FaceRef,
    target: EffectTarget,
    effectId: string,
    bytes: Uint8Array,
  ) => Promise<EraseCommitResult>
  /**
   * 复制一张卡片（含全部图层与卡面图引用），插入在原卡片之后。
   *
   * 图层走深拷贝并重编 ID：卡片之间的图层必须是独立对象，否则改 A 卡会连带改 B 卡。
   * 卡面图与蒙版只复制**路径**不复制文件——同一份资源被两张卡引用是合理的，
   * 复制文件既浪费空间，也会让「换图」变成一件需要同步多处的事。
   *
   * @param cardId - 待复制的卡片 ID。
   * @returns 新卡片的 ID；源卡片不存在时返回 `null`。
   */
  duplicateCard: (cardId: string) => string | null
  /**
   * 导入一张外来卡片（单卡工程）。
   *
   * 与 {@link duplicateCard} 同一条路：深拷贝、重编卡片与图层的 ID、追加到目标列表末尾，
   * 然后按列表位置重编号。区别只在于新卡片来自外部文件而非当前系列，因此插入点取末尾
   * （源卡片不存在，没有「插在它后面」的语义），并且**不**复制资源文件——素材落盘由
   * `features/bundle/importCard.ts` 在调用本方法前完成。
   *
   * @param card - 已解析并改写过资源路径的卡片。
   * @param hidden - `true` 追加到隐藏列表，`false` 追加到常规列表。
   * @returns 新卡片的 ID；当前没有打开系列时返回 `null`。
   */
  importCard: (card: Card, hidden: boolean) => string | null
}

/**
 * `PackStoreState` 中「数据」部分的形状（不含各操作方法）。
 *
 * 操作方法与数据同宿一个 store，但初始状态只描述数据；把数据形状单独抽出来，
 * 既能让工厂函数精确返回，也避免误把操作方法写进初始状态。
 */
type PackStoreData = Pick<
  PackStoreState,
  | "pack"
  | "rootDir"
  | "saveStatus"
  | "lastError"
  | "selectedCardId"
  | "selectedLayerId"
  | "layerClipboard"
  | "past"
  | "future"
  | "lastMergeKey"
  | "lastMergeTime"
  | "trashTombstones"
  | "flattenSkip"
>

/**
 * 深拷贝一棵图层子树，并为**每一个**节点重编 id。
 *
 * 复制卡片 / 复制图层都要整棵拷贝：子层的 id 也必须重发，否则复制体与被复制体会共享同一批
 * id，`findLayerById` 会命中先出现的那一棵，改一个连带改另一个。
 *
 * @param layer - 子树根。
 * @param name - 根的图层名（复制体取一个新的默认名）；子层沿用各自原名。
 */
function cloneLayerDeep(layer: Layer, name: string): Layer {
  return {
    ...structuredClone(layer),
    id: newId(),
    name,
    children: layer.children.map((c) => cloneLayerDeep(c, c.name)),
  }
}

/**
 * 构造一份全新的初始（空）状态。
 *
 * 之所以是**工厂**而非模块级常量：`past` / `future` / `trashTombstones` 是可变引用，
 * 若共享同一个常量实例，后续任何就地修改（如 Task 15 的 `tombstones[rel] = token`）
 * 都会污染该常量，使「重置」拿到被改脏的数组/对象。工厂保证每次调用都产出全新的
 * `[]` / `{}`。用途：作为 `create` 的种子，并被生命周期方法复用——
 * `newPack` / `openPack` 成功后以 `{ ...createInitialState(), ... }` 重置，
 * 保证切换系列时历史栈、错误、选择态全部归零，不留上一个系列的残留。
 *
 * @returns 一份全新的初始数据状态。
 */
function createInitialState(): PackStoreData {
  return {
    pack: null,
    rootDir: null,
    saveStatus: "idle",
    lastError: null,
    selectedCardId: null,
    selectedLayerId: null,
    layerClipboard: null,
    past: [],
    future: [],
    lastMergeKey: null,
    lastMergeTime: 0,
    trashTombstones: {},
    flattenSkip: new Set<string>(),
  }
}

/**
 * 拼接系列内 `pack.json` 的绝对路径。
 *
 * 拼接交给 {@link join}：盘符目录（`C:\Users\me\MyPacks`）拼出来必须仍是 `\`，不能混进
 * `/`；末尾斜杠与空段也由它一并处理。
 *
 * @param root - 系列根目录的绝对路径。
 * @returns `pack.json` 的绝对路径。
 */
const packJsonPath = (root: string) => join(root, "pack.json")

/**
 * 写盘串行化队列的队尾。
 *
 * 所有 `save()` 依次挂到这条链上，保证写盘严格按「发起顺序」落盘；否则两次并发写盘的
 * 完成顺序可能颠倒（旧快照后完成），把较新的数据覆盖回旧版本，且置为 `saved` 后再无补写，
 * 用户的编辑会静默丢失。
 */
let saveQueue: Promise<void> = Promise.resolve()

/**
 * 全局唯一的 packStore 实例。
 *
 * 通过 zustand 的 `create` 生成：组件用 `usePackStore(selector)` 订阅，
 * 非 React 代码用 `usePackStore.getState()` 读写。
 */
export const usePackStore = create<PackStoreState>()((set, get) => ({
  ...createInitialState(),

  newPack: async (name, rootDir) => {
    try {
      // 记录创建时的编辑器版本（编辑器 + 渲染器成套）；打开 / 保存时不改写它。
      // 旧系列缺该字段时由 schema 默认补 "v1"，下次保存会把补出的值写回文件。
      const pack = createEmptyPack(name, useUiStore.getState().editorVersion)
      await packFs.ensureDir(join(rootDir, "assets"))
      await packFs.writeTextAtomic(packJsonPath(rootDir), JSON.stringify(pack, null, 2))
      set({
        ...createInitialState(),
        pack,
        rootDir,
        saveStatus: "saved",
        // 新系列可能预置卡片；默认选中第一张，让编辑器打开即有可编辑目标。
        selectedCardId: pack.cards[0]?.id ?? null,
      })
    } catch (e) {
      set({ saveStatus: "error", lastError: String(e) })
    }
  },

  openPack: async (rootDir) => {
    try {
      const text = await packFs.readText(packJsonPath(rootDir))
      const pack = parsePack(JSON.parse(text))
      // 「创建时写名」之前建出的图层，名字都是空串。按位置补上默认名，使打开前后的显示
      // 一致；而此后再拖拽重排，名字就不会跟着位置跑了。改的是内存里的对象，下次保存落盘。
      fillDefaultLayerNames(pack)
      set({
        ...createInitialState(),
        pack,
        rootDir,
        saveStatus: "saved",
        selectedCardId: pack.cards[0]?.id ?? null,
      })
      // 打开成功即顺手清理回收站（保留最近 TRASH_KEEP 条），防止 `.trash` 无界增长。
      // 纯旁路、best-effort：purge 失败（如目录缺失）不得影响打开结果，故吞掉异常。
      void packFs.purgeTrash(rootDir, TRASH_KEEP).catch(() => {})
    } catch (e) {
      // 读取失败或 JSON 损坏：清空系列并置错误态，但不抛出——
      // 让调用方（UI）能统一走「展示错误」分支，而不是处理异常。
      set({ ...createInitialState(), saveStatus: "error", lastError: String(e) })
    }
  },

  closePack: () => set(createInitialState()),

  flattenImages: async () => {
    const { pack, rootDir } = get()
    if (!pack || !rootDir) return 0

    // 合成要读图、要写 PNG，是个漫长的 await：期间用户还能继续编辑。故计划只读入 pack，
    // 套用之前重新核对系列是否还是同一个。
    const plan = await planFlatten(
      pack,
      (layers, aspect) => composeGroup(layers, { packRoot: rootDir, aspect }),
      get().flattenSkip,
    )
    if (!plan) return 0
    if (get().pack !== pack) return 0

    // 先试算一遍套用后的系列：只有「合并后确实没人引用」的原图才值得进回收站。
    const preview = structuredClone(pack)
    applyFlatten(preview, plan)
    const still = new Set(collectPackRels(preview))

    // 先入回收站、再提交（与 deleteCard 同序）：撤销回到合并前的快照时，reconcileTrash
    // 能凭 tombstone 把原图取回来，于是「合并」对撤销完全透明。
    const newEntries: Record<string, string> = {}
    for (const rel of plan.superseded) {
      if (still.has(rel)) continue
      try {
        newEntries[rel] = await packFs.moveToTrash(rootDir, rel)
      } catch {
        // 文件缺失或移动失败：合并不因此中断，这次只是没省下那张原图。
      }
    }
    // 移文件期间系列可能又被改过（撤销 / 换了系列）：此时最新 pack 也许还要用这些原图，
    // 原样放回去、整次合并作废。放不回去的只能留在回收站（尽力而为，与 deleteCard 同口径）。
    const latest = get()
    if (latest.pack !== pack) {
      for (const [rel, token] of Object.entries(newEntries)) {
        try {
          await packFs.restoreFromTrash(rootDir, token, rel)
        } catch {
          // 放不回去：文件留在回收站，本次不记 tombstone。
        }
      }
      return 0
    }
    // 记 tombstone 与提交之间没有 await，撤销插不进来：此后撤销回到合并前的快照时，
    // reconcileTrash 能凭 tombstone 把原图取回来，于是「合并」对撤销完全透明。
    if (Object.keys(newEntries).length > 0) {
      usePackStore.setState((s) => ({ trashTombstones: { ...s.trashTombstones, ...newEntries } }))
    }
    latest.commit((d) => applyFlatten(d, plan))
    // 记住这几组的原样：撤销回分层状态后，下一次自动保存不会把它们又合回去。
    set({ flattenSkip: new Set([...latest.flattenSkip, ...plan.ops.map((o) => o.fingerprint)]) })

    // 选中层被合并掉时，选中态转到取而代之的合并层——否则属性面板会空掉。
    const selected = get().selectedLayerId
    if (selected) {
      const op = plan.ops.find((o) => o.layerIds.includes(selected))
      if (op) set({ selectedLayerId: op.layer.id })
    }
    return plan.ops.length
  },

  save: async () => {
    // 入口判空：未绑定系列时无盘可写，直接返回（也不占用写盘队列）。
    const { pack, rootDir } = get()
    if (!pack || !rootDir) return

    // 串行化：接到上一条写盘之后，确保「后发起的写」一定「后落盘」（见 saveQueue 说明）。
    const run = saveQueue.then(async () => {
      // 落盘前先把可合并的图片层烤平，让盘上只有一张图而不是 N 张（见 flattenImages）。
      // 合并失败（图缺失 / 画布不可用 / 磁盘满）绝不能连累保存：原样写盘，下次再试。
      try {
        await get().flattenImages()
      } catch {
        // 吞掉；pack 未被改动，接下来的写盘与原行为完全一致。
      }
      // 执行时重新读取最新状态：排队期间若有新提交，这里写的就是最新数据。
      const cur = get()
      if (!cur.pack || !cur.rootDir) return
      set({ saveStatus: "saving" })
      try {
        await packFs.writeTextAtomic(packJsonPath(cur.rootDir), JSON.stringify(cur.pack, null, 2))
        // 写盘期间若又发生提交（pack 引用已变），不能据这次已过时的结果置 saved；
        // 保持 dirty，交由随后那次防抖写盘把最新数据落盘。
        if (get().pack === cur.pack) {
          set({ saveStatus: "saved", lastError: null })
        } else {
          set({ saveStatus: "dirty" })
        }
      } catch (e) {
        // 失败时只改状态、保留内存中的 pack，避免一次磁盘故障丢失编辑成果。
        set({ saveStatus: "error", lastError: String(e) })
      }
    })
    // 推进队尾；吞掉异常以免一次失败卡死后续写盘（错误已在上方通过 set 体现）。
    saveQueue = run.then(
      () => {},
      () => {},
    )
    await run
  },

  commit: (recipe, opts) => {
    const state = get()
    // 未绑定系列时无可变更对象，安全空操作（recipe 也不应被调用）。
    if (!state.pack) return

    // 先取提交时间：既用于合并窗口判定，也作为本次 updatedAt 的基准。
    const now = opts?.now ?? Date.now()

    // 深拷贝草稿：让 recipe 的就地改写与历史快照、订阅方持有的旧对象彻底隔离，
    // 从而保证每次提交都产出全新的不可变快照（引用比较即能识别变化）。
    const draft = structuredClone(state.pack)
    recipe(draft)

    // updatedAt 严格单调递增：直接把 `now` 与 `previous.updatedAt` 比较并由较大者 +1ms 定值，
    // 这样即使注入的 `now` 落后于上一条（时钟回拨 / 测试注入的历史时间戳）也不会倒退，
    // 保证「新提交的 updatedAt 一定严格大于旧值」，不依赖墙钟单调。
    const prevMs = Date.parse(state.pack.updatedAt)
    const ms = Number.isFinite(prevMs) ? Math.max(now, prevMs + 1) : now
    draft.updatedAt = new Date(ms).toISOString()

    const mergeKey = opts?.mergeKey ?? null
    // 仅当显式给出 mergeKey、与上次相同、且落在时间窗内时才合并：
    // 合并意味着本次不新增历史点，撤销时会直接回到窗口开始前的状态。
    const canMerge =
      mergeKey !== null &&
      state.lastMergeKey === mergeKey &&
      now - state.lastMergeTime < MERGE_WINDOW_MS

    // 不可合并时把旧引用入栈；slice(-HISTORY_LIMIT) 截断保证栈深有界，丢弃最早的快照。
    const past = canMerge ? state.past : [...state.past, state.pack].slice(-HISTORY_LIMIT)

    set({
      pack: draft,
      past,
      future: [],
      lastMergeKey: mergeKey,
      lastMergeTime: now,
      saveStatus: "dirty",
    })
  },

  undo: () => {
    const state = get()
    // 未绑定系列或没有历史时无可回退，保持原状。
    if (!state.pack || state.past.length === 0) return
    const previous = state.past[state.past.length - 1]
    set({
      pack: previous,
      past: state.past.slice(0, -1),
      // 当前状态压入重做栈头部（索引 0 即「下一状态」），并截断保持有界。
      future: [state.pack, ...state.future].slice(0, HISTORY_LIMIT),
      saveStatus: "dirty",
      // 回退后合并链已断裂，清空 mergeKey 以防后续提交误并入历史窗口。
      lastMergeKey: null,
    })
    // 回退可能让被删卡片「复活」，其资源或仍在回收站——尝试还原（见 reconcileTrash）。
    void reconcileTrash()
  },

  redo: () => {
    const state = get()
    // 未绑定系列或没有可重做项时保持原状。
    if (!state.pack || state.future.length === 0) return
    const next = state.future[0]
    set({
      pack: next,
      past: [...state.past, state.pack].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      saveStatus: "dirty",
      lastMergeKey: null,
    })
    // 与 undo 同理：重做也可能重新引入此前删除的卡片及其资源。
    void reconcileTrash()
  },

  addCard: (hidden) => {
    const state = get()
    // 未绑定系列时无可追加对象。
    if (!state.pack) return null
    // 序号基于目标列表现有最大值 +1，避免与既有卡片编号冲突（列表为空则为 1）。
    const list = hidden ? state.pack.hiddenCards : state.pack.cards
    const nextNum = list.reduce((m, c) => Math.max(m, c.num), 0) + 1
    // 预置的首个图层直接带上默认名（「图层 1」）：名字是数据，创建时就写定。
    const card = createCard(nextNum, defaultLayerName(1))
    // 经 commit 入历史，使「新增卡片」可被撤销。
    state.commit((d) => {
      ;(hidden ? d.hiddenCards : d.cards).push(card)
    })
    // 新增后直接选中它，并默认选中其预置的首个图层，让用户即刻可编辑。
    set({ selectedCardId: card.id, selectedLayerId: card.layers[0]?.id ?? null })
    return card.id
  },

  deleteCard: async (cardId) => {
    const state = get()
    // 无系列或未绑定目录（无回收站）时无法删除，静默返回。
    if (!state.pack || !state.rootDir) return
    const all = [...state.pack.cards, ...state.pack.hiddenCards]
    const card = all.find((c) => c.id === cardId)
    // 目标卡片不存在时为空操作。
    if (!card) return

    // 先尽力把卡片引用的资源移入回收站，再改数据；这样即使随后数据变更被撤销，
    // 也能凭 tombstone 把文件还原（见 reconcileTrash）。
    const rels = collectCardRels(card)
    const root = state.rootDir
    // 只收集「本次成功移入回收站」的条目；写回时用函数式更新并入最新 map，
    // 而非用 pre-await 快照整体替换，避免与并发 deleteCard / reconcileTrash 互相覆盖。
    const newEntries: Record<string, string> = {}
    for (const rel of rels) {
      try {
        const token = await packFs.moveToTrash(root, rel)
        newEntries[rel] = token
      } catch {
        // 文件可能不存在或移动失败：删除操作不因此中断，仅本次不记录 tombstone。
      }
    }
    // 合并写入：把本次新增条目并入「当前」map（而非 await 前的旧快照），
    // 使两个并发的删除操作各自保留对方的 tombstone。无新增时跳过 set，避免无谓的引用替换。
    if (Object.keys(newEntries).length > 0) {
      usePackStore.setState((s) => ({ trashTombstones: { ...s.trashTombstones, ...newEntries } }))
    }
    state.commit((d) => {
      d.cards = d.cards.filter((c) => c.id !== cardId)
      d.hiddenCards = d.hiddenCards.filter((c) => c.id !== cardId)
      // 卡册里原来的位置留空，而不是留着已删卡的 id：位置仍然属于这个系列，
      // 小程序会把后面的未归档卡补进这个空格。撤销删除时位置一并回来。
      d.album.pages = d.album.pages.map((slots) =>
        slots.map((id) => (id === cardId ? null : id)),
      )
    })
    // 若被删的正是当前选中卡片，改选普通列表首张（无则清空选择）。
    if (get().selectedCardId === cardId) {
      set({ selectedCardId: get().pack?.cards[0]?.id ?? null, selectedLayerId: null })
    }
  },

  deleteBack: () => {
    const { pack } = get()
    // 没有卡背（或压根没打开系列）时为空操作：不写一条什么都没改的历史。
    if (!pack?.back) return
    // 选中的图层来自这张将被删掉的卡背时一并清空，避免右栏挂着一个已不存在的图层。
    const selected = get().selectedLayerId
    const selectedInBack = selected ? findLayerById(pack.back.layers, selected) !== null : false

    get().commit((d) => {
      d.back = null
    })
    if (selectedInBack) set({ selectedLayerId: null })
  },

  setSaveStatus: (status) => set({ saveStatus: status }),
  selectCard: (id) => set({ selectedCardId: id, selectedLayerId: null }),
  selectLayer: (id) => set({ selectedLayerId: id }),

  addLayer: (ref) => {
    const { pack } = get()
    if (!pack || !canWriteFace(pack, ref)) return null
    // 新层取「第一个没被占用的默认名」。背面可能尚不存在（首次写入才懒创建），故用 `?.`。
    const existing = flattenLayers(findFace(pack, ref)?.layers ?? []).map((e) => e.layer)
    const layer = createLayer(defaultLayerName(nextLayerNum(existing)))
    get().commit((d) => {
      withFace(d, ref, (f) => f.layers.push(layer))
    })
    set({ selectedLayerId: layer.id })
    return layer.id
  },

  addImageLayer: (ref, atBottom = false) => {
    const { pack } = get()
    if (!pack || !canWriteFace(pack, ref)) return null
    // 与 addLayer 同一套默认名规则：新层取「第一个没被占用的默认名」。
    const existing = flattenLayers(findFace(pack, ref)?.layers ?? []).map((e) => e.layer)
    const layer = createLayer(defaultLayerName(nextLayerNum(existing)))
    const effect = {
      id: newId(),
      enabled: true,
      kind: "image",
      params: EFFECT_REGISTRY.image.defaultParams(),
    } as Effect
    layer.effects.push(effect)
    // 建层 + 加效果放在同一个 commit 里：一次撤销即可完整消失。
    get().commit((d) => {
      withFace(d, ref, (f) => (atBottom ? f.layers.unshift(layer) : f.layers.push(layer)))
    })
    set({ selectedLayerId: layer.id })
    return { layerId: layer.id, effectId: effect.id }
  },

  addTextLayer: (ref, content) => {
    const { pack } = get()
    if (!pack || !canWriteFace(pack, ref)) return null
    // 文字层有自己的编号池，避免与普通图层抢号。
    const existing = flattenLayers(findFace(pack, ref)?.layers ?? []).map((e) => e.layer)
    const layer = createTextLayer(defaultTextLayerName(nextTextLayerNum(existing)), content)
    get().commit((d) => {
      withFace(d, ref, (f) => f.layers.push(layer))
    })
    set({ selectedLayerId: layer.id })
    return layer.id
  },

  deleteLayer: (ref, layerId) => {
    const { pack } = get()
    const face = pack ? findFace(pack, ref) : null
    if (!face || !findLayerById(face.layers, layerId)) return
    get().commit((d) => {
      withFace(d, ref, (f) => {
        // 摘除即删除：连同整棵子树一起消失（确认框已告知子层数量，见 InspectorPanel）。
        detachLayer(f.layers, layerId)
      })
    })
    if (get().selectedLayerId === layerId) set({ selectedLayerId: null })
  },

  duplicateLayer: (ref, layerId) => {
    const { pack } = get()
    if (!pack) return null
    const face = findFace(pack, ref)
    const source = face ? findLayerById(face.layers, layerId) : null
    if (!source || !face) return null
    // 整棵子树深拷贝并重编所有 id；根另取一个新默认名（沿用原名会让列表里出现两行同名）。
    const existing = flattenLayers(face.layers).map((e) => e.layer)
    const copy = cloneLayerDeep(source, defaultLayerName(nextLayerNum(existing)))
    get().commit((d) => {
      withFace(d, ref, (f) => {
        const located = findLayerLocation(f.layers, layerId)
        if (located) located.siblings.splice(located.index + 1, 0, copy)
      })
    })
    set({ selectedLayerId: copy.id })
    return copy.id
  },

  copyLayer: (ref, layerId) => {
    const { pack } = get()
    const face = pack ? findFace(pack, ref) : null
    const source = face ? findLayerById(face.layers, layerId) : null
    if (!source || !face) return false
    // 快照而不是引用：复制之后用户继续改源层（甚至删掉它），粘出来的仍是这一刻的样子，
    // 而且不会和源层共享 effects / children 的引用。
    set({ layerClipboard: structuredClone(source) })
    return true
  },

  pasteLayer: (ref) => {
    const { pack, layerClipboard } = get()
    if (!pack || !layerClipboard || !canWriteFace(pack, ref)) return null
    // 每次粘贴都从快照重新深拷贝、整棵重编 id：连粘两次得到两层完全独立的图层。
    // 名字沿用源层——用户要的是「同样的效果」，换个默认名反而认不出是哪一层。
    const copy = cloneLayerDeep(layerClipboard, layerClipboard.name)
    get().commit((d) => {
      withFace(d, ref, (f) => {
        // 追加到顶层末尾 = 最上层，粘上去立刻看得见，不会藏在别的图层底下。
        f.layers.push(copy)
      })
    })
    set({ selectedLayerId: copy.id })
    return copy.id
  },

  moveLayer: (ref, layerId, targetParentId, targetIndex) => {
    const { pack } = get()
    const face = pack ? findFace(pack, ref) : null
    if (!face) return
    const moved = findLayerById(face.layers, layerId)
    if (!moved) return

    // 目标父必须存在，且不能是被移动子树自身或其后代（否则会把子树挂进自己里面形成环）。
    if (targetParentId !== null) {
      if (!findLayerById(face.layers, targetParentId)) return
      if (targetParentId === layerId || findLayerById(moved.children, targetParentId)) return
    }

    // 深度上限：落位后该根的祖先数 = 目标父的祖先数 + 1（顶层为 0）。
    const ancestorCount =
      targetParentId === null ? 0 : (ancestorChain(face.layers, targetParentId)?.length ?? 0) + 1
    if (exceedsNestDepth(moved, ancestorCount)) return

    // 原地不动则安静返回：空提交会让历史栈长出一个无意义的点。
    const current = flattenLayers(face.layers).find((e) => e.layer.id === layerId)
    if (current && current.parentId === targetParentId && current.indexInParent === targetIndex)
      return

    get().commit((d) => {
      withFace(d, ref, (f) => {
        const located = findLayerLocation(f.layers, layerId)
        if (!located) return
        const [subtree] = located.siblings.splice(located.index, 1)
        const siblings =
          targetParentId === null
            ? f.layers
            : (findLayerById(f.layers, targetParentId)?.children ?? f.layers)
        // 摘除发生在插入点之前（同一数组内重排）时，插入下标要左移一位。
        let index = targetIndex
        if (located.siblings === siblings && located.index < index) index -= 1
        index = Math.max(0, Math.min(index, siblings.length))
        siblings.splice(index, 0, subtree)
      })
    })
  },

  setLayerEnabled: (ref, layerId, enabled) => {
    const { pack } = get()
    const layer = pack ? findLayerById(findFace(pack, ref)?.layers ?? [], layerId) : null
    if (!layer || layer.enabled === enabled) return
    get().commit((d) => {
      withFace(d, ref, (f) => {
        const target = findLayerById(f.layers, layerId)
        if (target) target.enabled = enabled
      })
    })
  },

  updateCard: (cardId, patch, opts) => {
    commitFace(
      { kind: "card", cardId },
      null,
      Object.keys(patch),
      (face) => Object.assign(face, patch),
      opts,
    )
  },

  setRarityProbabilities: (weights) => {
    const { pack } = get()
    if (!pack) return
    const next = sanitizeProbabilities(weights)
    // 与现状等价时不入历史：对话框按「确定」没改数字，不该多出一个撤销点。
    if (sameProbabilities(pack.rarityProbabilities, next)) return
    get().commit((d) => {
      d.rarityProbabilities = next
    })
  },

  setSeriesAspect: (aspect, opts) => {
    const { pack } = get()
    // 值没变就不入历史：滑杆复位回原值不该多出一个撤销点。
    if (!pack || pack.aspect === aspect) return
    get().commit(
      (d) => {
        d.aspect = aspect
      },
      { mergeKey: "pack.aspect", now: opts?.now },
    )
  },

  updatePackArtStyle: (patch, opts) => {
    const { pack } = get()
    if (!pack) return
    // 值没变就不入历史：滑杆复位回原值不该多出一个撤销点。
    const changed = Object.entries(patch).some(
      ([key, value]) => pack.packArtStyle[key as keyof PackArtStyle] !== value,
    )
    if (!changed) return
    get().commit(
      (d) => {
        d.packArtStyle = { ...d.packArtStyle, ...patch }
      },
      { mergeKey: `pack.packArtStyle.${Object.keys(patch).sort().join(",")}`, now: opts?.now },
    )
  },

  updateFace: (ref, patch, opts) => {
    commitFace(
      ref,
      null,
      Object.keys(patch),
      (face) => {
        Object.assign(face, patch)
      },
      opts,
    )
  },

  addEffect: (ref, target, kind, opts) => {
    // 槽位判满在 commit 之前：`commit` 无条件记一个历史点，留到 recipe 里 return 会留下空撤销步。
    const list = currentEffects(ref, target)
    if (!list || list.filter((e) => e.kind === kind).length >= EFFECT_REGISTRY[kind].maxPerTarget)
      return
    commitFace(
      ref,
      effectLayerId(target),
      [`effect.add.${kind}`],
      (face) => {
        const l = effectsArray(face, target)
        if (!l) return
        // `kind` 是运行期值，其 `params` 与 `Effect` 各分支的对应关系 TS 证不出来，故此处收窄。
        l.push({
          id: newId(),
          enabled: true,
          kind,
          params: EFFECT_REGISTRY[kind].defaultParams(),
        } as Effect)
      },
      opts,
    )
  },

  removeEffect: (ref, target, effectId, opts) => {
    // id 不在目标上时落空：同样须在 commit 之前拦下，避免空撤销步。
    const list = currentEffects(ref, target)
    if (!list?.some((e) => e.id === effectId)) return
    commitFace(
      ref,
      effectLayerId(target),
      [`effect.remove.${effectId}`],
      (face) => {
        const l = effectsArray(face, target)
        if (!l) return
        const i = l.findIndex((e) => e.id === effectId)
        if (i >= 0) l.splice(i, 1)
      },
      opts,
    )
  },

  updateEffect: (ref, target, effectId, patch, opts) => {
    const list = currentEffects(ref, target)
    if (!list?.some((e) => e.id === effectId)) return
    // `enabled` 上提在 EffectBase（在 `params` 之外），故先摘出来单独写，其余才是参数补丁。
    const { enabled, ...paramsPatch } = patch
    // 合并键按 `effect.<id>.<field>`：同一条效果的同一字段连续拖动合并为一步历史，换字段即新点。
    // patch 为空对象时 fields 为空，commitFace 会直接早退，不留空历史点。
    commitFace(
      ref,
      effectLayerId(target),
      Object.keys(patch).map((k) => `effect.${effectId}.${k}`),
      (face) => {
        const e = effectsArray(face, target)?.find((x) => x.id === effectId)
        if (!e) return
        if (enabled !== undefined) e.enabled = enabled
        // `colors`（palette）是 `EffectParams` 里唯一的数组字段：逐项拷贝色标对象后再入 state，
        // 隔断与调用方所持数组及元素的共享引用（否则调用方原地改 `stop.at` 会绕过 commit 静默
        // 改写 state）。合并键仍为 `effect.<id>.<field>`，连续拖动色标合并成一步历史。
        // `EffectPatch` 是判别式联合的部分补丁，须先用 `in` 收窄到 palette 分支才取得到 `colors`。
        if ("colors" in paramsPatch && paramsPatch.colors)
          paramsPatch.colors = paramsPatch.colors.map((s) => ({ color: s.color, at: s.at }))
        // 参数补丁是按判别式联合收窄的部分字段，与具体 `params` 分支的对应关系 TS 证不出来，故收窄。
        e.params = { ...e.params, ...paramsPatch } as EffectParams
      },
      opts,
    )
  },

  moveEffect: (ref, target, effectId, toIndex, opts) => {
    const list = currentEffects(ref, target)
    const from = list ? list.findIndex((e) => e.id === effectId) : -1
    if (!list || from < 0) return
    // 夹取口径是「移除该条之后」的列表长（-1）；落回原位即无变化——在 commit 之前拦下，
    // 否则会留下一个「拖了却没动」的空撤销步。
    const to = Math.max(0, Math.min(toIndex, list.length - 1))
    if (to === from) return
    commitFace(
      ref,
      effectLayerId(target),
      [`effect.move.${effectId}`],
      (face) => {
        const l = effectsArray(face, target)
        if (!l) return
        const i = l.findIndex((e) => e.id === effectId)
        if (i < 0) return
        const [item] = l.splice(i, 1)
        // 先删后插：此时 `l.length` 即「移除该条之后」的长度，与前置判定的夹取口径一致。
        l.splice(Math.max(0, Math.min(toIndex, l.length)), 0, item)
      },
      opts,
    )
  },

  updateLayer: (ref, layerId, patch, opts) => {
    commitFace(
      ref,
      layerId,
      Object.keys(patch),
      (face) => {
        const layer = findLayerById(face.layers, layerId)
        if (!layer) return
        Object.assign(layer, patch)
      },
      opts,
    )
  },

  updateTextLayer: (ref, layerId, patch, opts) => {
    const fields = Object.keys(patch)
    // 空 patch 不入历史；目标必须是真实的文字层，否则 recipe 会空转却仍记一个历史点。
    if (fields.length === 0) return
    const { pack } = get()
    const layer = pack ? findLayerById(findFace(pack, ref)?.layers ?? [], layerId) : null
    if (!layer || layer.kind !== "text" || !layer.text) return
    commitFace(
      ref,
      layerId,
      // 合并键带 `text.` 前缀，与图层级字段（name / blend / opacity）区分开。
      fields.map((field) => `text.${field}`),
      (face) => {
        const target = findLayerById(face.layers, layerId)
        if (!target?.text) return
        Object.assign(target.text, patch)
      },
      opts,
    )
  },

  importAsset: async (ref, target, srcAbsPath) => {
    const { pack, rootDir } = get()
    if (!pack || !rootDir) return { ok: false, reason: "no-pack" }

    /**
     * 校验效果型资源目标仍在：图层（`layerId` 非 null 时）与目标效果都要存在，且 kind
     * 与目标种类匹配（`maskEffect` → `imageMask`，`imageEffect` / `normalEffect` → `image`）。
     *
     * `front` / `faceNormal` 写的是卡面自身字段，无需额外校验，恒返回 true。前置校验与拷贝后的
     * 竞态复查共用这一份判定，保证两处条件逐字一致——否则复查会放过前置已挡下的情况，
     * 写入落到不存在的效果上。
     */
    const effectTargetOk = (p: Pack): boolean => {
      const face = findFace(p, ref)
      if (!face) return false
      const list = findLayerById(face.layers, target.layerId)?.effects
      if (!list) return false
      const expected = target.kind === "maskEffect" ? "imageMask" : "image"
      return list.some((e) => e.id === target.effectId && e.kind === expected)
    }

    // 先验目标再拷文件：反过来的话，目标已不存在的导入会在 assets/ 里留下
    // 一个永远不被引用的孤儿图片，而用户看到的只是一次「没反应」的点击。
    if (!canWriteFace(pack, ref)) return { ok: false, reason: "no-target" }
    if (!effectTargetOk(pack)) return { ok: false, reason: "no-target" }

    const ext = fileExtension(srcAbsPath)
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      return { ok: false, reason: "unsupported-format" }
    }

    // 读出源图并按需压缩（≤ 2 MB 原样返回，不重编码）。读不出来时退回 Rust 侧原样拷贝：
    // 压缩是增强，不该成为导入的新失败点。
    let prepared: { ext: string; bytes: Uint8Array } | null = null
    try {
      prepared = await prepareImportImage(srcAbsPath, ext)
    } catch {
      prepared = null
    }

    // 压缩可能换格式（如 PNG → JPEG），落盘扩展名要跟着字节走，否则渲染器会按错格式解码。
    const rel = `assets/${crypto.randomUUID()}.${prepared ? prepared.ext : ext}`
    try {
      if (prepared) await packFs.writeBytesAtomic(rootDir, rel, prepared.bytes)
      else await packFs.copyAsset(srcAbsPath, rootDir, rel)
    } catch (e) {
      return { ok: false, reason: "copy-failed", message: String(e) }
    }

    // 拷贝是异步的：await 期间目标可能已被删除（用户在图层面板里删掉该图层）。这里用
    // **最新**的 pack 重查一次目标（与上面的前置判定同一组条件），并与随后的 commit 同处
    // 一个没有 await 的同步块——任何状态变更都无法插进两者之间，竞态窗口就此闭合。
    // 目标已消失则直接返回，不 commit：否则这次注定落空的写入会往撤销栈里推一个「按了
    // 没反应」的空点，而且动作仍会返回 ok，UI 会报告成功、字段却是空的。
    // 已经落盘的那张图刻意保留：系列目录里多一个不被引用的文件无害，本阶段不做自动清理。
    const fresh = get().pack
    if (!fresh || !canWriteFace(fresh, ref) || !effectTargetOk(fresh)) {
      return { ok: false, reason: "no-target" }
    }

    // 拷贝成功后先刷新「缺失」标记：替换本该存在的资源时，旧标记会一直挂在行上。
    useUiStore.getState().clearMissing(rel)

    // 不走 commitFace：导入是离散动作，不该与任何东西合并，因此不传 mergeKey
    // （无 mergeKey 的 commit 必定新开一个历史点）。
    get().commit((d) => {
      withFace(d, ref, (face) => {
        const list = findLayerById(face.layers, target.layerId)?.effects
        const effect = list?.find((e) => e.id === target.effectId)
        if (target.kind === "maskEffect" && effect?.kind === "imageMask") effect.params.path = rel
        if (target.kind === "imageEffect" && effect?.kind === "image") effect.params.path = rel
        if (target.kind === "normalEffect" && effect?.kind === "image") {
          if (!effect.params.normalPath && effect.params.bumpStrength <= 0) effect.params.bumpStrength = 1
          effect.params.normalPath = rel
        }
      })
    })
    return { ok: true, rel }
  },

  importCover: async (kind, srcAbsPath) => {
    const { pack, rootDir } = get()
    if (!pack || !rootDir) return { ok: false, reason: "no-pack" }

    const ext = fileExtension(srcAbsPath)
    if (!COVER_EXTENSIONS.includes(ext)) {
      return { ok: false, reason: "unsupported-format" }
    }

    // 封面不复用 `prepareImportImage`：那里按体积选档，带透明的图会被转成 PNG 或 JPEG，
    // 而封面在手机上只需要「看得清」——尺寸档位固定，统一压成 WebP，GIF 与动图 WebP 原样保留。
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await packFs.readFileBytes(srcAbsPath))
    } catch (e) {
      return { ok: false, reason: "copy-failed", message: String(e) }
    }

    // 解码只为取宽高做比例校验；失败时整体放弃，不产生半写文件。
    let size: { width: number; height: number }
    try {
      size = await measureCover(bytes, ext)
    } catch (e) {
      return { ok: false, reason: "measure-failed", message: String(e) }
    }

    const aspectError = coverAspectError(kind, size.width, size.height)
    if (aspectError) return { ok: false, reason: "aspect", ...aspectError }

    // 缩到档位再落盘：原图 4000px 的封面既占云存储，又拖慢首页 banner 的首屏。
    const prepared = await prepareCoverImage(bytes, ext, kind)

    // 唯一路径：与 importAsset 同一口径，换图不覆盖旧文件，撤销才能回到旧路径。
    const rel = `${coverDirOf(kind)}/${crypto.randomUUID()}.${prepared.ext}`
    try {
      await packFs.writeBytesAtomic(rootDir, rel, prepared.bytes)
    } catch (e) {
      return { ok: false, reason: "copy-failed", message: String(e) }
    }

    // 封面目标就是系列本身，没有图层被异步删除的可能，因此不做落盘后的竞态复查。
    get().commit((d) => {
      d[coverFieldOf(kind)] = rel
    })
    return { ok: true, rel }
  },

  importCoverBytes: async (kind, bytes, ext) => {
    const { pack, rootDir } = get()
    if (!pack || !rootDir) return { ok: false, reason: "no-pack" }

    // 裁剪已经保证比例与档位，这里只负责「唯一路径 + 写盘 + 进撤销栈」。
    const rel = `${coverDirOf(kind)}/${crypto.randomUUID()}.${ext}`
    try {
      await packFs.writeBytesAtomic(rootDir, rel, bytes)
    } catch (e) {
      return { ok: false, reason: "copy-failed", message: String(e) }
    }
    get().commit((d) => {
      d[coverFieldOf(kind)] = rel
    })
    return { ok: true, rel }
  },

  commitEraseImage: async (ref, target, effectId, bytes) => {
    const { pack, rootDir } = get()
    if (!pack || !rootDir) return { ok: false, reason: "no-pack" }

    /**
     * 目标效果仍在、且就是 `maskErase`：前置判定与落盘后的竞态复查共用这一份条件。
     * 与 importAsset 一样，两处必须逐字一致，否则复查会放过前置已挡下的情况。
     */
    const eraseTargetOk = (p: Pack): boolean => {
      const face = findFace(p, ref)
      if (!face) return false
      const list = findLayerById(face.layers, target.layerId)?.effects
      return list?.some((e) => e.id === effectId && e.kind === "maskErase") ?? false
    }

    // 先验目标再落盘：目标已消失时写入，只会得到一个永远不被引用的孤儿文件。
    if (!canWriteFace(pack, ref)) return { ok: false, reason: "no-target" }
    if (!eraseTargetOk(pack)) return { ok: false, reason: "no-target" }

    // 唯一路径：见接口文档——复用旧路径会同时废掉纹理缓存与撤销。
    const path = `assets/${crypto.randomUUID()}.png`
    try {
      await packFs.writeBytesAtomic(rootDir, path, bytes)
    } catch (e) {
      return { ok: false, reason: "write-failed", message: String(e) }
    }

    // 落盘期间目标可能被删：用最新 pack 复查，并与随后的 commit 同处一个同步块。
    // 已落盘的那张刻意保留（与 importAsset 同一口径：本阶段不做自动清理）。
    const fresh = get().pack
    if (!fresh || !canWriteFace(fresh, ref) || !eraseTargetOk(fresh)) {
      return { ok: false, reason: "no-target" }
    }

    // 不走 updateEffect：擦除提交是离散动作，不该与任何东西合并，故不传 mergeKey
    // （无 mergeKey 的 commit 必定新开一个历史点）。
    get().commit((d) => {
      withFace(d, ref, (face) => {
        const list = findLayerById(face.layers, target.layerId)?.effects
        const effect = list?.find((e) => e.id === effectId)
        if (effect?.kind === "maskErase") effect.params.path = path
      })
    })
    return { ok: true, path }
  },

  duplicateCard: (cardId) => {
    const { pack } = get()
    if (!pack) return null
    const hidden = pack.hiddenCards.some((c) => c.id === cardId)
    const list = hidden ? pack.hiddenCards : pack.cards
    const index = list.findIndex((c) => c.id === cardId)
    if (index === -1) return null

    // 图层逐个深拷贝并重编 ID。structuredClone 保证 effects / children 等数组不共享引用。
    const source = list[index]
    const copy: Card = {
      ...structuredClone(source),
      id: newId(),
      // 每棵子树都要整棵重编 id（见 cloneLayerDeep）：只换顶层 id 会让子层与源卡片共享 id。
      layers: source.layers.map((layer) => cloneLayerDeep(layer, layer.name)),
    }

    get().commit((d) => {
      const target = hidden ? d.hiddenCards : d.cards
      target.splice(index + 1, 0, copy)
      // 插入后重编号：展示编号恒等于列表位置。
      target.forEach((card, i) => {
        card.num = i + 1
      })
    })
    set({ selectedCardId: copy.id, selectedLayerId: null })
    return copy.id
  },

  importCard: (card, hidden) => {
    const { pack } = get()
    if (!pack) return null

    // 与 duplicateCard 同样的理由：外来卡片可能与当前系列共享 id（比如导入的是本系列
    // 之前的备份），不重编会让 findCard / 撤销栈认错对象。
    const copy: Card = {
      ...structuredClone(card),
      id: newId(),
      layers: card.layers.map((layer) => cloneLayerDeep(layer, layer.name)),
    }

    get().commit((d) => {
      const target = hidden ? d.hiddenCards : d.cards
      target.push(copy)
      // 展示编号恒等于列表位置：外来卡片的 num 没有参考价值，追加后统一重排。
      target.forEach((c, i) => {
        c.num = i + 1
      })
    })
    set({ selectedCardId: copy.id, selectedLayerId: null })
    return copy.id
  },
}))

/**
 * 并发守卫：`reconcileTrash` 由 `undo` / `redo` 以 `void` 触发，可能重入。
 *
 * 若两次运行并行，第二个 `restoreFromTrash` 会撞上 Rust 侧「目标已存在」的保护而失败，
 * 其 tombstone 将永久残留（每轮都失败）。Phase 1 采用最简单的「跳过重入」策略——
 * 在飞的那一次会读取最新状态完成协调，无需更复杂的合并。
 */
let reconciling = false

/**
 * 把当前 pack 引用到、但曾被移入回收站的资源恢复回来。
 *
 * 场景：删除卡片会把其资源移入回收站；若随后 `undo` / `redo` 让该卡片重新出现在
 * pack 中，这些文件仍躺在回收站里、卡面会「裂图」。本函数以「当前 pack 需要哪些路径」
 * 为准，把命中 tombstone 的文件逐一从回收站还原，并从 tombstone 表中移除。
 *
 * 容错：单个文件恢复失败（如 token 失效 / 目标已存在）只保留其 tombstone 待下次再试，
 * 不抛出、不阻断循环——恢复是尽力而为的旁路动作，不应影响撤销/重做本身。
 *
 * 之所以是模块级函数而非 store 方法：它是「读 store → 做 IO → 回写 tombstone」的
 * 一次性协调逻辑，不需要进入状态形状，也不该暴露给 UI。
 */
async function reconcileTrash(): Promise<void> {
  // 已有一次协调在进行：直接跳过，让在飞的那次基于最新状态完成，避免双重恢复。
  if (reconciling) return
  reconciling = true
  try {
    const { pack, rootDir, trashTombstones } = usePackStore.getState()
    // 无系列或未绑定目录（无回收站）时无可协调。
    if (!pack || !rootDir) return
    const needed = new Set(collectPackRels(pack))
    // 只记录「本次成功恢复」的路径，稍后按 key 从「当前」map 删除（而非整体替换）。
    const restored: string[] = []
    for (const [rel, token] of Object.entries(trashTombstones)) {
      // 只处理「当前 pack 又需要」的路径；其余文件仍留在回收站（待最终 purge）。
      if (needed.has(rel)) {
        try {
          await packFs.restoreFromTrash(rootDir, token, rel)
          restored.push(rel)
        } catch {
          // 恢复失败：保留 tombstone，下次 reconcile 再试。
        }
      }
    }
    // 合并写入：仅从「当前」map 删除本次恢复成功的 key，避免用 await 前的旧快照整体替换、
    // 覆盖掉并发操作在此期间新增的 tombstone。无成功项时跳过 set，避免无谓的引用替换。
    if (restored.length > 0) {
      usePackStore.setState((s) => {
        const next = { ...s.trashTombstones }
        for (const rel of restored) delete next[rel]
        return { trashTombstones: next }
      })
    }
  } finally {
    reconciling = false
  }
}

/**
 * 卡面引用在合并键与调试信息里的字符串形式。
 *
 * @param ref - 卡面引用。
 * @returns 卡片为 `card:<id>`，背面为 `back`。
 */
export function faceKey(ref: FaceRef): string {
  return ref.kind === "back" ? "back" : `card:${ref.cardId}`
}

/**
 * 在一个系列草稿上定位指定卡面。
 *
 * 背面不存在时**不会**自动创建——需要写入（而非读取）的调用方自行决定是否懒创建，
 * 以免纯读取路径（如 moveLayer 的前置校验）留下副作用。
 *
 * @param pack - 草稿系列。
 * @param ref - 卡面引用。
 * @returns 命中的 `CardFace`；卡片不存在时返回 `null`。
 */
function findFace(pack: Pack, ref: FaceRef): CardFace | null {
  if (ref.kind === "back") return pack.back
  const card = [...pack.cards, ...pack.hiddenCards].find((c) => c.id === ref.cardId)
  return card ?? null
}

/**
 * 目标卡面是否可写。背面总是可写（不存在时懒创建），卡片则要求确实存在。
 *
 * 动作在 `commit` **之前**用它做前置判断：`commit` 会推入一个历史快照，
 * 对一次落空的写入调用它会在撤销栈里留下一个「按了没反应」的空点。
 *
 * @param pack - 当前系列。
 * @param ref - 卡面引用。
 */
function canWriteFace(pack: Pack, ref: FaceRef): boolean {
  return ref.kind === "back" || findFace(pack, ref) !== null
}

/**
 * 在草稿系列上就地改写指定卡面；背面不存在时懒创建一个空背面。
 *
 * @param pack - 草稿系列。
 * @param ref - 卡面引用。
 * @param fn - 接收卡面并就地改写的回调；目标卡片不存在时**不会**被调用。
 * @returns 是否真的改写了内容。
 */
function withFace(pack: Pack, ref: FaceRef, fn: (face: CardFace) => void): boolean {
  if (ref.kind === "back") {
    // 懒创建：背面是系列级可选结构，首次编辑它的任一字段时才需要存在。
    // 用 createCardFace() 而非手写字面量：`effects` / `layers` 是嵌套默认值，手写会与 schema 兜底漂移。
    if (!pack.back) pack.back = createCardFace()
    fn(pack.back)
    return true
  }
  const card = [...pack.cards, ...pack.hiddenCards].find((c) => c.id === ref.cardId)
  if (!card) return false
  fn(card)
  return true
}

/**
 * 由「卡面 + 被改字段」推导合并键。
 *
 * 同一字段的连续更新（拖动滑杆、连续输入）落在同一合并键上，被 `commit` 的
 * 时间窗合并为一步历史；换字段即换键，自然产生新的历史点。
 *
 * @param ref - 目标卡面。
 * @param layerId - 图层 ID；卡面级更新传 `null`。
 * @param fields - 本次改动的字段名。
 * @returns 合并键字符串。
 */
function mergeKeyOf(ref: FaceRef, layerId: string | null, fields: string[]): string {
  // 字段名排序：一次 patch 里字段顺序不同不应产生不同的合并键。
  const suffix = [...fields].sort().join(",")
  return layerId === null ? `${faceKey(ref)}:${suffix}` : `${faceKey(ref)}:${layerId}:${suffix}`
}

/**
 * 把一次「可能落空的卡面写入」包成 commit。
 *
 * 统一处理两件事：用显式前置判定（系列存在 / patch 非空 / 目标可写 / 图层存在）在
 * `commit` 之前拦下注定落空的写入，使其不留下无意义的历史点；以及自动推导合并键
 * （`layerId` 与字段名由调用方给出）。
 *
 * @param ref - 目标卡面。
 * @param layerId - 图层 ID；卡面级更新传 `null`。
 * @param fields - 本次改动的字段名（用于推导合并键）。
 * @param fn - 就地改写回调。
 * @param opts - 可选：可注入的当前时间。
 */
function commitFace(
  ref: FaceRef,
  layerId: string | null,
  fields: string[],
  fn: (face: CardFace) => void,
  opts?: UpdateOptions,
): void {
  const { pack, commit } = usePackStore.getState()
  // 字段为空说明 patch 是空对象：无内容可写，不入历史（否则每次滑动都会留下空点）。
  if (!pack || fields.length === 0) return
  if (!canWriteFace(pack, ref)) return
  if (layerId !== null) {
    const face = findFace(pack, ref)
    if (!face || !findLayerById(face.layers, layerId)) return
  }
  commit((d) => withFace(d, ref, fn), {
    mergeKey: mergeKeyOf(ref, layerId, fields),
    now: opts?.now,
  })
}

/**
 * 取目标持有的效果数组（就地引用）；目标 / 图层不存在时返回 null。
 *
 * @param face - 草稿卡面。
 * @param target - 效果挂载位置（卡面或某图层）。
 */
function effectsArray(face: CardFace, target: EffectTarget): Effect[] | null {
  const layer = findLayerById(face.layers, target.layerId)
  return layer ? layer.effects : null
}

/** 效果目标的图层 id；卡面级为 `null`（与 {@link commitFace} 的 `layerId` 参数同义）。 */
function effectLayerId(target: EffectTarget): string {
  return target.layerId
}

/**
 * 取**当前状态**下目标的效果数组（活引用），供提交前的「注定落空」判定。
 *
 * {@link commitFace} 会无条件记一个历史点，故凡是不改内容的调用都要在 commit 之前拦下——
 * 这里给出判定所依据的活引用：它可能为 `null`（系列未打开 / 目标或图层不存在）。
 *
 * 背面按语义可写（`commitFace` → `withFace` 会懒创建它），故尚不存在的背面在**卡面级**目标下
 * 视为空列表——否则首次写入背面效果会被这里的空判定误拦，与「其余写入都能懒建背面」不一致。
 * 图层级目标则仍需真实卡面：背面尚不存在时它没有图层可挂。
 *
 * @param ref - 目标卡面。
 * @param target - 效果挂载位置。
 */
function currentEffects(ref: FaceRef, target: EffectTarget): Effect[] | null {
  const { pack } = usePackStore.getState()
  if (!pack) return null
  const face = findFace(pack, ref)
  return face ? effectsArray(face, target) : null
}
