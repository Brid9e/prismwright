/**
 * 默认卡背的会话态。
 *
 * 数据本身躺在应用数据目录下的 `default-back/` 工程里（见 `features/default-back`），
 * 这里只缓存「此刻的卡背长什么样」与它的根目录，供预览、发布在系列没有卡背时取用。
 *
 * 不落盘：卡背的持久化由那份工程的自动保存负责。这里只在启动时读一次，并在默认卡背
 * 工程被编辑时由 {@link DefaultBackState.observe} 跟上——预览必须立刻反映刚改的卡背。
 */
import { create } from "zustand"
import { appDataDir } from "@tauri-apps/api/path"
import type { CardFace } from "@prismwright/schema"
import { join } from "../app/path"
import { packFs } from "../tauri/pack-fs"
import {
  DEFAULT_BACK_DIR_NAME,
  isDefaultBackPack,
  loadDefaultBack,
} from "../features/default-back/default-back"

/** `useDefaultBackStore` 的完整状态形状。 */
export interface DefaultBackState {
  /** 默认卡背工程的绝对目录；应用数据目录取不到时为 `null`。 */
  rootDir: string | null
  /** 默认卡背；还没做过（或读不出来）时为 `null`。 */
  face: CardFace | null
  /** 是否已经尝试读过盘。`false` 时 `rootDir` 尚不可信。 */
  loaded: boolean

  /** 从盘上重新读一遍（启动时调用；也用于读失败后的重试）。 */
  load: () => Promise<void>
  /**
   * 跟随 store 的编辑：当前打开的若是默认卡背工程，就把它的卡背同步进来。
   *
   * 不是那个工程时安静忽略——普通系列的卡背与这里无关。
   */
  observe: (rootDir: string | null, face: CardFace | null) => void
}

export const useDefaultBackStore = create<DefaultBackState>((set, get) => ({
  rootDir: null,
  face: null,
  loaded: false,

  load: async () => {
    let root: string | null = null
    try {
      root = join(await appDataDir(), DEFAULT_BACK_DIR_NAME)
    } catch {
      // dev:web 没有 Tauri：没有应用数据目录，也就没有默认卡背，按「未设置」处理。
      root = null
    }
    const face = root
      ? await loadDefaultBack({
          defaultRoot: root,
          isPackDir: packFs.isPackDir,
          readText: packFs.readText,
          join,
        })
      : null
    // 读盘期间用户可能已经在编辑默认卡背（observe 先到一步）：此时以内存里的为准，
    // 别用盘上的旧内容把刚改的东西冲掉。
    const current = get()
    if (current.loaded && isDefaultBackPack(current.rootDir, root)) {
      set({ rootDir: root, loaded: true })
      return
    }
    set({ rootDir: root, face, loaded: true })
  },

  observe: (rootDir, face) => {
    if (!isDefaultBackPack(rootDir, get().rootDir)) return
    set({ face })
  },
}))
