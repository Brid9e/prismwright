/**
 * 设计 token 的完整性守卫。
 *
 * token 是「全站唯一事实来源」，但它是 CSS 文本，类型系统看不见：漏定义一个
 * `--color-track-fill`，滑杆填充会静默变透明；主题文件里写了一个不存在的键，
 * 用户切换主题时那块颜色会悄悄退回默认值，且没有任何报错。故用测试把两件事钉住：
 * 必需语义 token 必须存在；主题只允许覆盖已定义的 token。
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8")
const githubDark = JSON.parse(
  readFileSync(new URL("../../themes/builtin/github-dark.json", import.meta.url), "utf8"),
) as { colors: Record<string, string> }

/** 组件与主题共同依赖的语义 token；少一个都会让某类控件静默失色。 */
const REQUIRED = [
  "--color-surface-app",
  "--color-surface-panel",
  "--color-surface-elevated",
  "--color-surface-sunken",
  "--color-track",
  "--color-track-fill",
  "--color-line",
  "--color-line-soft",
  "--color-border",
  "--color-border-strong",
  "--color-border-subtle",
  "--color-text",
  "--color-text-muted",
  "--color-text-disabled",
  "--color-text-on-accent",
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-active",
  "--color-accent-soft",
  "--color-focus",
  "--color-danger",
  "--color-warning",
  "--color-success",
  "--color-scrim",
  "--color-checker-a",
  "--color-checker-b",
]

/** `:root` 里声明过的所有 `--color-*` 键。 */
function declaredColorKeys(source: string): Set<string> {
  const keys = source.match(/--color-[a-z0-9-]+(?=\s*:)/g) ?? []
  return new Set(keys)
}

describe("tokens.css", () => {
  it("必需语义 token 全部定义", () => {
    const declared = declaredColorKeys(css)
    expect(REQUIRED.filter((key) => !declared.has(key))).toEqual([])
  })

  it("不再保留旧的蓝色强调色板", () => {
    expect(css).not.toContain("--palette-accent-")
  })
})

describe("内置主题", () => {
  it("github-dark 只覆盖已定义的语义 token", () => {
    const declared = declaredColorKeys(css)
    const unknown = Object.keys(githubDark.colors).filter((key) => !declared.has(key))
    expect(unknown).toEqual([])
  })
})
