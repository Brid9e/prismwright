/**
 * 主题 JSON 的校验与归一。
 *
 * 规则（见设计 §3）：
 * - `id`：`^[a-z0-9][a-z0-9-]{0,63}$`；
 * - `name`：非空字符串，或「语言 → 非空字符串」映射；
 * - `colors`：`Record<string, string>`；**键必须**匹配 `^--color-[a-z0-9-]+$`，其余忽略（向前
 *   兼容、也不给主题作者开放原始色板 `--palette-*`）；**值**接受 `R G B` 三元组或 `#rgb`/`#rrggbb`，
 *   归一为三元组。
 *
 * 未知顶层字段由 `z.object` 默认剥离（与 `@prismwright/schema` 的约定一致）。
 *
 * 校验失败文案一律用中文：`parseTheme` 的 `message` 会被拼进 `errors.themeInvalid` 直接展示，
 * 不能让 zod 的英文默认串（"Required" / "Invalid input" …）漏进界面。
 */
import { z } from "zod"
import type { ThemeName, ThemeTokens } from "./types"

/** 已校验并归一、尚未归入来源的主题内容。 */
export interface ParsedTheme {
  id: string
  name: ThemeName
  tokens: ThemeTokens
}

/** `parseTheme` 的结果：成功给出主题，失败给出可展示的原因。 */
export type ParseThemeResult = { ok: true; theme: ParsedTheme } | { ok: false; message: string }

/** `R G B` 三元组：三个以空白分隔的 1–3 位数字。 */
const TRIPLE = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/
/** `#rgb` 或 `#rrggbb`（不区分大小写）。 */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
/** 合法语义 token 键：`--color-` 后接至少一个小写字母 / 数字 / 连字符。 */
const COLOR_KEY = /^--color-[a-z0-9-]+$/

/**
 * 把一个色值字符串归一为 `R G B` 三元组。
 *
 * @param value - `R G B` 三元组或 `#rgb` / `#rrggbb`。
 * @returns 归一后的三元组；无法识别或分量越界时返回 `null`。
 */
export function normalizeColor(value: string): string | null {
  const v = value.trim()

  const triple = TRIPLE.exec(v)
  if (triple) {
    // `\d{1,3}` 已保证是非负整数，这里只需再挡上界。
    const parts = [triple[1], triple[2], triple[3]].map(Number)
    if (parts.every((n) => n <= 255)) return parts.join(" ")
    return null
  }

  const hex = HEX.exec(v)
  if (hex) {
    let h = hex[1]
    // 三位简写展开成六位（#f0a → #ff00aa）。
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = Number.parseInt(h, 16)
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
  }

  return null
}

/** 主题名：非空字符串，或「语言 → 非空字符串」映射。 */
const NameSchema = z.union(
  [z.string().min(1, "主题名不能为空"), z.record(z.string(), z.string().min(1, "主题名不能为空"))],
  // union 失败产生的是 `invalid_union`（而非 `invalid_type`），params 的 required_error /
  // invalid_type_error 对它不生效，故用 errorMap 统一给出中文原因。
  { errorMap: () => ({ message: "主题 name 必须是非空字符串或语言→名字映射" }) },
)

/** 主题 JSON 的原始形状（值尚未归一）。 */
const RawThemeSchema = z.object(
  {
    id: z
      .string({ required_error: "缺少字段 id", invalid_type_error: "主题 id 必须是字符串" })
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "主题 id 非法（仅小写字母、数字、连字符）"),
    name: NameSchema,
    colors: z.record(z.string(), z.string({ invalid_type_error: "色值必须是字符串" }), {
      required_error: "缺少字段 colors",
      invalid_type_error: "colors 必须是对象",
    }),
  },
  { required_error: "主题必须是一个 JSON 对象", invalid_type_error: "主题必须是一个 JSON 对象" },
)

/**
 * 校验并归一一个主题 JSON。
 *
 * @param raw - 任意来源（`JSON.parse` 结果或内置 JSON 模块）的数据。
 * @returns 成功给出归一后的 {@link ParsedTheme}；失败给出可展示的原因。
 */
export function parseTheme(raw: unknown): ParseThemeResult {
  const parsed = RawThemeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "主题格式不正确" }
  }

  const { id, name, colors } = parsed.data
  const tokens: ThemeTokens = {}
  for (const [key, value] of Object.entries(colors)) {
    if (!COLOR_KEY.test(key)) continue
    const normalized = normalizeColor(value)
    if (normalized === null) return { ok: false, message: `色值非法：${key} = ${value}` }
    tokens[key] = normalized
  }

  return { ok: true, theme: { id, name, tokens } }
}
