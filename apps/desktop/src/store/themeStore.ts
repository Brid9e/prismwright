/**
 * themeStore —— 主题的可用列表、选中项与导入流程。
 *
 * 与 `uiStore` 并列：主题选中项需跨会话保留（写在 `preferences.json`，见 `app/theme.ts`），
 * 故单独成 store，与语言、最近列表同一模式。DOM 写入（`applyTheme`）也收敛在此，
 * 组件只读状态、点按调用动作。
 */
import { create } from "zustand"
import { packFs } from "../tauri/pack-fs"
import { themeFs } from "../tauri/theme-fs"
import { saveThemeId } from "../app/theme"
import { applyTheme } from "../themes/apply"
import { BUILTIN_IDS, DEFAULT_THEME_ID } from "../themes/builtin"
import { buildThemes, findTheme } from "../themes/registry"
import { parseTheme } from "../themes/schema"
import type { Theme } from "../themes/types"

/**
 * 导入失败的原因。
 *
 * `key` 指向 `errors` 命名空间的文案键（展示时翻译）；`message` 是附带的细节，填进
 * 文案的 `{{message}}` 占位。store 保持 i18n 无关。
 */
export interface ThemeImportError {
  key: "themeInvalid" | "themeConflict" | "themeImportFailed"
  message?: string
}

/** `useThemeStore` 的完整状态形状。 */
export interface ThemeStoreState {
  /** 可用主题（内置 + 导入）。 */
  themes: Theme[]
  /** 当前选中的主题 id。 */
  selectedId: string
  /** 最近一次导入失败的原因；`null` 表示无。 */
  importError: ThemeImportError | null

  /** 从磁盘载入导入主题并与内置合并。 */
  load: () => Promise<void>
  /** 切换主题：应用 token + 记录选中 + 落盘。 */
  select: (id: string) => Promise<void>
  /** 弹出文件框导入一个主题 JSON，成功则刷新并选中。 */
  importFromFile: () => Promise<void>
  /** 清除导入错误提示。 */
  clearImportError: () => void
}

/** 把未知异常转成可展示的字符串。 */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useThemeStore = create<ThemeStoreState>()((set, get) => ({
  themes: [],
  selectedId: DEFAULT_THEME_ID,
  importError: null,

  load: async () => {
    // 非 Tauri（dev:web）时 `listImported` 的 invoke 会拒绝——降级为「无导入主题」，不阻塞。
    const imported = await themeFs.listImported().catch(() => [])
    set({ themes: buildThemes(imported) })
  },

  select: async (id) => {
    const theme = findTheme(get().themes, id)
    applyTheme(theme?.tokens ?? null)
    set({ selectedId: id })
    await saveThemeId(id)
  },

  importFromFile: async () => {
    const path = await packFs.pickFile([{ name: "Theme", extensions: ["json"] }])
    if (!path) return

    let raw: unknown
    try {
      raw = JSON.parse(await packFs.readText(path))
    } catch (e) {
      set({ importError: { key: "themeInvalid", message: errText(e) } })
      return
    }

    const res = parseTheme(raw)
    if (!res.ok) {
      set({ importError: { key: "themeInvalid", message: res.message } })
      return
    }
    if (BUILTIN_IDS.includes(res.theme.id)) {
      set({ importError: { key: "themeConflict", message: res.theme.id } })
      return
    }

    try {
      // 落盘归一后的内容（hex 已转三元组、非 --color-* 键已剥离），保证磁盘上的文件规范。
      const canonical = JSON.stringify(
        { id: res.theme.id, name: res.theme.name, colors: res.theme.tokens },
        null,
        2,
      )
      await themeFs.install(res.theme.id, canonical)
    } catch (e) {
      set({ importError: { key: "themeImportFailed", message: errText(e) } })
      return
    }

    await get().load()
    await get().select(res.theme.id)
    set({ importError: null })
  },

  clearImportError: () => set({ importError: null }),
}))
