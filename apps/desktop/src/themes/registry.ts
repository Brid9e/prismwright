/**
 * 主题注册表：把内置主题与从磁盘读入的导入主题合并成一份可用列表。
 *
 * 纯逻辑、无 IO——磁盘读取由 `themeStore` 负责，这里只接已读入的原始文件。
 */
import { BUILTIN_THEMES } from "./builtin"
import { parseTheme } from "./schema"
import type { RawThemeFile, Theme, ThemeMeta } from "./types"

/**
 * 合并内置与导入主题。
 *
 * 导入项逐条解析：坏 JSON / 非法主题**跳过**（一个坏文件不该瘫掉整个列表）；
 * 与内置（或彼此）id 冲突的也跳过——内置优先。
 *
 * @param imported - 从应用数据目录读入的原始主题文件。
 * @returns 可用主题列表，内置在前。
 */
export function buildThemes(imported: RawThemeFile[]): Theme[] {
  const out: Theme[] = [...BUILTIN_THEMES]
  const seen = new Set(out.map((t) => t.meta.id))

  for (const file of imported) {
    let raw: unknown
    try {
      raw = JSON.parse(file.contents)
    } catch {
      continue
    }
    const res = parseTheme(raw)
    if (!res.ok) continue
    if (seen.has(res.theme.id)) continue
    seen.add(res.theme.id)
    out.push({
      meta: { id: res.theme.id, name: res.theme.name, source: "imported" },
      tokens: res.theme.tokens,
    })
  }

  return out
}

/** 按 id 找主题；找不到返回 `undefined`。 */
export function findTheme(themes: Theme[], id: string): Theme | undefined {
  return themes.find((t) => t.meta.id === id)
}

/**
 * 解析主题的展示名。
 *
 * `nameKey` 存在时走 i18n（内置「默认」）；否则字符串名原样返回，映射名按当前语言取、
 * 依次回退 `zh-CN` → `en` → 映射里第一个值。用户导入的主题名不翻译。
 *
 * @param meta - 主题元信息。
 * @param t - i18n 翻译函数（仅当 `nameKey` 存在时用到）。
 * @param lang - 当前界面语言。
 */
export function themeDisplayName(
  meta: ThemeMeta,
  t: (key: string) => string,
  lang: string,
): string {
  if (meta.nameKey) return t(meta.nameKey)
  if (typeof meta.name === "string") return meta.name
  return (
    meta.name[lang] ?? meta.name["zh-CN"] ?? meta.name["en"] ?? Object.values(meta.name)[0] ?? meta.id
  )
}
