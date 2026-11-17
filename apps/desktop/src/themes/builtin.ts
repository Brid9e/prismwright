/**
 * 内置主题清单。
 *
 * 内置主题是随前端打包的 JSON（`./builtin/*.json`），构建期即经 `parseTheme` 校验——
 * 坏数据直接编译/运行期抛错，不会静默出问题。
 *
 * 「默认」项不是文件：它就是 `tokens.css` 的 `:root`，以**空覆盖**表达（选中即清空内联、
 * 回落默认）。因此它只声明 i18n 名字键，不声明 token。
 */
import githubDarkRaw from "./builtin/github-dark.json"
import { parseTheme } from "./schema"
import type { Theme } from "./types"

/** 默认主题 id——`preferences.json` 无 `theme` 键时回退到它。 */
export const DEFAULT_THEME_ID = "default"

/** 「默认」主题的 i18n 名字键（带命名空间前缀）。 */
export const DEFAULT_THEME_NAME_KEY = "settings:appearance.default"

/** 把内置 JSON 解析为 {@link Theme}；解析失败即抛错（内置数据本应恒合法）。 */
function fromJson(raw: unknown, id: string): Theme {
  const res = parseTheme(raw)
  if (!res.ok) throw new Error(`内置主题 ${id} 非法：${res.message}`)
  return {
    meta: { id: res.theme.id, name: res.theme.name, source: "builtin" },
    tokens: res.theme.tokens,
  }
}

/** 内置主题列表：默认（空覆盖）+ GitHub 深色。 */
export const BUILTIN_THEMES: readonly Theme[] = [
  {
    meta: { id: DEFAULT_THEME_ID, name: "", source: "builtin", nameKey: DEFAULT_THEME_NAME_KEY },
    tokens: {},
  },
  fromJson(githubDarkRaw, "github-dark"),
]

/** 内置主题 id 集合：导入时据此拒绝与内置冲突的 id。 */
export const BUILTIN_IDS: readonly string[] = BUILTIN_THEMES.map((t) => t.meta.id)
