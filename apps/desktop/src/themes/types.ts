/**
 * 主题系统的共享类型。
 *
 * 主题 = 一组语义 token（`--color-*`）的覆盖值。这里刻意**不**引入任何 IO / UI 依赖，
 * 以便校验、应用、注册表三层都能只依赖这些类型。
 */

/** 主题 token 映射：语义 token 名（`--color-*`）→ `R G B` 三元组值。 */
export type ThemeTokens = Record<string, string>

/** 主题名：单串（用户导入常用）或 语言 → 名字 映射（内置用，随语言切换）。 */
export type ThemeName = string | Record<string, string>

/** 主题元信息。 */
export interface ThemeMeta {
  /** 主题 id（也是落盘文件名）。 */
  id: string
  /** 展示名；当 `nameKey` 存在时被忽略（改走 i18n）。 */
  name: ThemeName
  /** 来源：内置（随前端打包）或导入（应用数据目录）。 */
  source: "builtin" | "imported"
  /** 内置「默认」项专用的 i18n 名字键（带命名空间前缀）；其余主题不用。 */
  nameKey?: string
}

/** 一个可用主题：元信息 + 归一后的 token 覆盖。 */
export interface Theme {
  meta: ThemeMeta
  tokens: ThemeTokens
}

/** 一个从磁盘读入的主题文件：文件名 + 原始 JSON 文本。 */
export interface RawThemeFile {
  fileName: string
  contents: string
}
