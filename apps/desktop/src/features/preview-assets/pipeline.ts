/**
 * 预览资产生成流水线。
 *
 * 架构位置：与 `store/autosave.ts` 同构的「旁挂订阅器」——store 只管把状态标脏、把数据落盘，
 * 「落了盘之后顺手为变更过的卡生成预览资产」这一横切关注点由本模块承担，不污染 store 本体。
 *
 * 产物（每张卡两份，落在系列内的 `.previews/`，见 {@link ./paths}）：
 * - `<cardId>.png`：确定性正视角、带透明通道的静态卡面（时间项取 0，与交互预览逐像素一致）；
 * - `<cardId>.webm`：同一张静卡、全息随时间流动的透明视频，供「最近打开」与以后移动端集卡展示。
 *
 * 视频可由 {@link GENERATE_VIDEO_PREVIEW} 关掉（「先不存视频」）：关闭时只产出 PNG，跳过帧序列
 * 与 ffmpeg 编码。该开关折进了内容哈希，故切换后既有卡会失配重算——详见 `./card-hash`。
 *
 * 触发时机：`packStore` 的 `saveStatus` 落到 `saved` 的那一刻（既覆盖「编辑后自动保存」，也覆盖
 * 「打开 / 新建即置 saved」）。是否真要生成由**内容哈希**决定（见 {@link ./card-hash}）：只有当某张卡
 * 自上次生成以来渲染相关内容变过时才重算，故反复保存同一张未改动的卡不会白白重渲 60 帧。
 *
 * 串行与关闭：批处理严格串行（一次只跑一张卡），期间新落盘的保存会**合并**为紧随其后的一轮重扫，
 * 不会并行抢占 GPU。窗口关闭前调用方应 `await handle.idle()` 等队列跑空，以免产物写到一半被腰斩。
 */
import type { Card } from "@cardbara/schema"
import {
  createCardFrameRenderer,
  type CardFrameRenderer,
  type ResolveAsset,
} from "@cardbara/renderer/v1"
import { join } from "../../app/path"
import { usePackStore } from "../../store/packStore"
import { ffmpeg } from "../../tauri/ffmpeg"
import { packFs } from "../../tauri/pack-fs"
import { createResolveAsset } from "../preview/resolve-asset"
import { GENERATE_VIDEO_PREVIEW, cardRenderHash, staleCards } from "./card-hash"
import { frameRel, framesDirRel, MANIFEST_REL, previewPngRel, previewWebmRel } from "./paths"

/**
 * 输出位图宽度（像素）；高度由卡面比例推得（720 / (2.5/3.5) ≈ 1008）。
 *
 * 与 {@link FPS} / {@link FRAME_COUNT} 同属「渲染规格」：改动其中任一项都会改变产物字节，
 * 故必须同步升 {@link RENDER_SPEC_VERSION}（`./card-hash.ts`）——否则清单里的旧哈希仍会命中，
 * 已有卡不会重生成。
 */
export const FRAME_WIDTH = 720

/** 视频帧率。与 {@link FRAME_WIDTH} 同为渲染规格，改动须升 {@link RENDER_SPEC_VERSION}。 */
export const FPS = 24

/** 视频帧数（60 帧 @ 24fps = 2.5 秒）。同为渲染规格，改动须升 {@link RENDER_SPEC_VERSION}。 */
export const FRAME_COUNT = 60

/** 生成进度：`total` 为本轮待生成卡数，`done` 为已完成数（含失败）。用于关闭前的进度弹窗。 */
export interface PreviewProgress {
  /** 本轮已处理完的卡数（成功与失败都计入）。 */
  done: number
  /** 本轮待生成的卡总数。 */
  total: number
}

/** {@link attachPreviewAssets} 返回的控制句柄。 */
export interface PreviewAssetsHandle {
  /** 取消订阅并释放内部状态（组件卸载 / 测试收尾时调用）。 */
  detach: () => void
  /** 等待当前与已排队的生成任务全部跑空；无任务时立即兑现。关闭窗口前 `await` 它。 */
  idle: () => Promise<void>
  /** 是否有生成任务在进行（含已排队待跑的后续轮次）。 */
  isBusy: () => boolean
  /** 读取当前进度快照。 */
  getProgress: () => PreviewProgress
  /**
   * 订阅进度变化。订阅瞬间不会立刻回放当前值——初次渲染请自行 `getProgress()` 取快照，
   * 之后靠本回调增量更新。
   *
   * @param listener - 进度变化回调。
   * @returns 取消订阅函数。
   */
  subscribe: (listener: (progress: PreviewProgress) => void) => () => void
}

/**
 * 订阅 `packStore`，在每次「保存完成」后为变更过的卡生成预览资产。
 *
 * 状态全部封装在本函数闭包内（与 `attachAutosave` 同构）：每次调用都是一个独立实例，
 * 便于测试与卸载清理，也避免模块级单例在多次 `attach` 之间串味。
 *
 * @returns 控制句柄（见 {@link PreviewAssetsHandle}）。
 */
export function attachPreviewAssets(): PreviewAssetsHandle {
  /** 上次读入的清单缓存，按 `rootDir` 归属；换系列即自然失效（读盘时比对 `rootDir`）。 */
  let manifestCache: { rootDir: string; data: Record<string, string> } | null = null

  /** 是否有一轮生成正在进行。 */
  let active = false
  /** 进行中又收到了新的保存：跑完当前轮后再追一轮（重扫最新状态）。 */
  let queued = false
  /** 等待队列跑空的 `idle()` 兑现器。 */
  let idleResolvers: Array<() => void> = []

  /** 最新进度快照。 */
  let progress: PreviewProgress = { done: 0, total: 0 }
  /** 进度订阅者。 */
  const listeners = new Set<(progress: PreviewProgress) => void>()

  /**
   * 更新进度并广播给订阅者。
   *
   * @param next - 新进度快照。
   */
  function setProgress(next: PreviewProgress): void {
    progress = next
    for (const listener of listeners) listener(next)
  }

  /**
   * 读取系列内清单（`cardId → 内容哈希`）。
   *
   * 命中缓存（同一 `rootDir`）直接返回；否则读盘解析，文件缺失或损坏一律**视作空清单**——
   * 于是所有卡都判为 stale、触发一次全量生成，正是「首次引入本功能 / 手动删了 `.previews`」
   * 时期望的自愈行为，无需报错打断。
   *
   * @param rootDir - 系列根目录绝对路径。
   * @returns 清单映射（就地缓存并复用于后续写入）。
   */
  async function loadManifest(rootDir: string): Promise<Record<string, string>> {
    if (manifestCache && manifestCache.rootDir === rootDir) return manifestCache.data
    const data: Record<string, string> = {}
    try {
      const parsed: unknown = JSON.parse(await packFs.readText(join(rootDir, MANIFEST_REL)))
      // 只收「字符串值」的条目：清单是跨会话文件，可能被外部改坏，宁可丢弃脏值也不让非串值参与比较。
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") data[key] = value
        }
      }
    } catch {
      // 清单不存在（首次生成）或内容损坏：按空处理，令全部卡片判为待生成。
    }
    manifestCache = { rootDir, data }
    return data
  }

  /**
   * 渲染一张卡的全部帧并编码成 WebM，同时落一张静态 PNG。
   *
   * 帧序列的命名必须与 Rust 侧 `encode_webm` 拼出的 `frame_%04d.png` 严格对应（见 {@link ./paths}）。
   *
   * @param card - 待生成的卡片。
   * @param aspect - 所属系列的宽高比（比例在系列上，不在卡上）。
   * @param rootDir - 系列根目录绝对路径。
   * @param resolveAsset - 资源解析器。
   */
  async function generateCard(
    card: Card,
    aspect: number,
    rootDir: string,
    resolveAsset: ResolveAsset,
  ): Promise<void> {
    const renderer = await createCardFrameRenderer({
      card,
      resolveAsset,
      width: FRAME_WIDTH,
      aspect,
      cornerRadius: card.cornerRadius,
    })
    try {
      // 静态正视角 PNG：时间项取 0，与交互预览逐像素一致。
      await writePng(renderer, rootDir, previewPngRel(card.id), 0)
      // 视频按开关可选：关闭时到此为止，不渲染帧序列、不落帧、不调 ffmpeg。
      if (!GENERATE_VIDEO_PREVIEW) return
      // WebM 帧序列：相位从 0 起逐帧递增，得到「静卡·全息流动」。
      for (let i = 0; i < FRAME_COUNT; i++) {
        await writePng(renderer, rootDir, frameRel(card.id, i), i / FPS)
      }
      // 编码由 Rust 侧完成；`.previews/.frames/<cardId>/` 临时帧目录由其编码后清理。
      await ffmpeg.encodeWebm(rootDir, framesDirRel(card.id), previewWebmRel(card.id), FPS)
    } finally {
      // 无论成功与否都要释放 GPU 资源，避免逐卡累积导致显存泄漏。
      renderer.dispose()
    }
  }

  /**
   * 渲染一帧并以原子写落盘。
   *
   * @param renderer - 帧渲染器。
   * @param rootDir - 系列根目录绝对路径。
   * @param rel - 产物在系列内的相对路径。
   * @param time - 相位时间（秒）。
   */
  async function writePng(
    renderer: CardFrameRenderer,
    rootDir: string,
    rel: string,
    time: number,
  ): Promise<void> {
    const blob = await renderer.renderPng(time)
    await packFs.writeBytesAtomic(rootDir, rel, new Uint8Array(await blob.arrayBuffer()))
  }

  /**
   * 跑一轮：为当前 `pack` 中所有内容变过的卡生成预览，并在成功后更新清单。
   *
   * 单张卡失败只记日志、不中断整批——它不会写进清单，因而下次落盘后仍判为 stale、自动重试；
   * 已成功的卡保留其记录，不受影响。
   */
  async function runBatch(): Promise<void> {
    const { pack, rootDir } = usePackStore.getState()
    if (!pack || !rootDir) return
    const manifest = await loadManifest(rootDir)
    // 普通卡与隐藏款一视同仁：两者都要在集卡展示里出现，都要有预览。
    const targets = staleCards([...pack.cards, ...pack.hiddenCards], manifest, pack.aspect)
    if (targets.length === 0) return

    // 后台生成不驱动 UI 的「缺失资源」徽标：那张卡真缺图时，用户打开交互预览自会看到标记；
    // 此处只需让纹理缓存兜底为占位图、把其余层继续渲出来，故回调留空。
    const resolveAsset = createResolveAsset({ rootDir, onMissing: () => {} })

    setProgress({ done: 0, total: targets.length })
    let manifestDirty = false
    for (const card of targets) {
      try {
        await generateCard(card, pack.aspect, rootDir, resolveAsset)
        manifest[card.id] = cardRenderHash(card, pack.aspect)
        manifestDirty = true
      } catch (error) {
        console.error(`[preview-assets] 生成预览失败：card=${card.id}`, error)
      }
      setProgress({ done: progress.done + 1, total: targets.length })
    }

    if (manifestDirty) {
      try {
        await packFs.writeTextAtomic(join(rootDir, MANIFEST_REL), JSON.stringify(manifest, null, 2))
      } catch (error) {
        // 清单没写成功：丢弃缓存，下次读盘会拿到旧清单、把这些卡重新判为 stale —— 自愈重试。
        console.error("[preview-assets] 写入清单失败", error)
        manifestCache = null
      }
    }
  }

  /**
   * 跑空队列：反复执行 {@link runBatch}，直到不再有新的保存排入。
   *
   * 把「进行中又收到保存」合并为紧随其后的一轮重扫（`queued`），而非并发开跑——GPU 与编码
   * 都不宜并行抢占。收尾时兑现所有 `idle()` 等待者。
   */
  async function drain(): Promise<void> {
    active = true
    try {
      do {
        queued = false
        await runBatch()
      } while (queued)
    } finally {
      active = false
      queued = false
      const resolvers = idleResolvers
      idleResolvers = []
      for (const resolve of resolvers) resolve()
    }
  }

  /** 请求一轮生成：空闲则立即开跑，否则并入进行中的那一轮之后。 */
  function kick(): void {
    if (active) {
      queued = true
      return
    }
    void drain()
  }

  const unsubscribe = usePackStore.subscribe((state, prev) => {
    // 只在「保存完成」这一刻触发。两种进入 saved 的路径都要覆盖：
    // - `dirty → saving → saved`：编辑后的自动保存；
    // - `open / new → saved`：打开或新建即已落盘（此时 pack 引用也换了）。
    if (state.saveStatus !== "saved") return
    if (!state.pack || !state.rootDir) return
    const becameSaved = prev.saveStatus !== "saved"
    const packSwapped = prev.pack !== state.pack
    if (!becameSaved && !packSwapped) return
    kick()
  })

  return {
    detach: () => {
      unsubscribe()
      // 让仍在等待 idle() 的调用者不致悬挂（在飞的那一轮由闭包继续跑完，无副作用）。
      const resolvers = idleResolvers
      idleResolvers = []
      for (const resolve of resolvers) resolve()
      listeners.clear()
    },
    idle: () => {
      // 已空闲（无进行中、无排队）时立即兑现。
      if (!active) return Promise.resolve()
      return new Promise<void>((resolve) => idleResolvers.push(resolve))
    },
    isBusy: () => active,
    getProgress: () => progress,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
