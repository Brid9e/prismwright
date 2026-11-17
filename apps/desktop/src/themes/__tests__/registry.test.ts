/**
 * 主题注册表测试：内置主题恒在、导入主题合并、坏文件与内置冲突被跳过、名字解析。
 */
import { describe, it, expect } from "vitest"
import { buildThemes, findTheme, themeDisplayName } from "../registry"
import { DEFAULT_THEME_ID } from "../builtin"

describe("buildThemes", () => {
  it("内置主题始终在列", () => {
    const ids = buildThemes([]).map((t) => t.meta.id)
    expect(ids).toContain(DEFAULT_THEME_ID)
    expect(ids).toContain("github-dark")
  })

  it("并入合法导入主题", () => {
    const themes = buildThemes([
      {
        fileName: "x.json",
        contents: JSON.stringify({ id: "x", name: "X", colors: { "--color-accent": "1 2 3" } }),
      },
    ])
    expect(findTheme(themes, "x")?.tokens["--color-accent"]).toBe("1 2 3")
  })

  it("跳过坏 JSON 与与内置冲突的 id", () => {
    const themes = buildThemes([
      { fileName: "bad.json", contents: "{not json" },
      {
        fileName: "dup.json",
        contents: JSON.stringify({ id: "github-dark", name: "D", colors: {} }),
      },
    ])
    expect(themes.filter((t) => t.meta.id === "github-dark")).toHaveLength(1)
  })
})

describe("themeDisplayName", () => {
  const t = (k: string) => `T:${k}`

  it("nameKey 走 i18n", () => {
    const meta = {
      id: "default",
      name: "",
      source: "builtin" as const,
      nameKey: "settings:appearance.default",
    }
    expect(themeDisplayName(meta, t, "zh-CN")).toBe("T:settings:appearance.default")
  })

  it("字符串名原样返回", () => {
    expect(themeDisplayName({ id: "x", name: "X", source: "imported" }, t, "en")).toBe("X")
  })

  it("映射名按语言取、回退 zh-CN", () => {
    const meta = { id: "x", name: { "zh-CN": "深色", en: "Dark" }, source: "builtin" as const }
    expect(themeDisplayName(meta, t, "en")).toBe("Dark")
    expect(themeDisplayName(meta, t, "fr")).toBe("深色")
  })
})
