/**
 * 主题校验与色值归一的单元测试。
 *
 * 只测纯函数：色值两种写法（三元组 / #hex）的归一与边界、非法值的拒绝、
 * `parseTheme` 的剥键（非 `--color-*` 与未知顶层字段）、以及失败文案是中文。
 */
import { describe, it, expect } from "vitest"
import { normalizeColor, parseTheme } from "../schema"

describe("normalizeColor", () => {
  it("接受 R G B 三元组并归一到单空格", () => {
    expect(normalizeColor("13 17 23")).toBe("13 17 23")
    expect(normalizeColor("  13   17  23 ")).toBe("13 17 23")
    expect(normalizeColor("013 017 023")).toBe("13 17 23")
  })

  it("接受边界值 255", () => {
    expect(normalizeColor("255 255 255")).toBe("255 255 255")
    expect(normalizeColor("0 0 0")).toBe("0 0 0")
  })

  it("接受 #rgb / #rrggbb 并转成三元组", () => {
    expect(normalizeColor("#0d1117")).toBe("13 17 23")
    expect(normalizeColor("#fff")).toBe("255 255 255")
    expect(normalizeColor("#ABC")).toBe("170 187 204")
  })

  it("拒绝越界、位数不符与空串", () => {
    expect(normalizeColor("256 0 0")).toBeNull()
    expect(normalizeColor("1000 0 0")).toBeNull()
    expect(normalizeColor("13 17")).toBeNull()
    expect(normalizeColor("red")).toBeNull()
    expect(normalizeColor("#12345")).toBeNull()
    expect(normalizeColor("")).toBeNull()
    expect(normalizeColor("   ")).toBeNull()
  })
})

describe("parseTheme", () => {
  it("解析合法主题：id / name / colors 归一", () => {
    const res = parseTheme({
      id: "github-dark",
      name: { "zh-CN": "GitHub 深色", en: "GitHub Dark" },
      colors: { "--color-accent": "#58a6ff" },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.theme.id).toBe("github-dark")
      expect(res.theme.name).toEqual({ "zh-CN": "GitHub 深色", en: "GitHub Dark" })
      expect(res.theme.tokens["--color-accent"]).toBe("88 166 255")
    }
  })

  it("剥离非 --color-* 键与未知顶层字段", () => {
    const res = parseTheme({
      id: "t",
      name: "T",
      colors: { "--palette-x": "1 2 3", "--color-text": "1 2 3" },
      extra: 1,
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.theme.tokens).toEqual({ "--color-text": "1 2 3" })
  })

  it("只保留匹配 --color-[a-z0-9-]+ 的键", () => {
    const res = parseTheme({
      id: "t",
      name: "T",
      colors: { "--color-": "1 2 3", "--color-Bad": "1 2 3", "--color-ok-1": "1 2 3" },
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(Object.keys(res.theme.tokens)).toEqual(["--color-ok-1"])
  })

  it("拒绝非法 id / 非法色值 / 缺字段", () => {
    expect(parseTheme({ id: "Bad Id", name: "T", colors: {} }).ok).toBe(false)
    expect(parseTheme({ id: "t", name: "T", colors: { "--color-text": "nope" } }).ok).toBe(false)
    expect(parseTheme({ id: "t", colors: {} }).ok).toBe(false)
    expect(parseTheme(null).ok).toBe(false)
  })

  it("失败原因是中文、可展示（不漏 zod 英文默认串）", () => {
    const cases: Array<[unknown, string]> = [
      [null, "对象"],
      [{ id: "Bad", name: "T", colors: {} }, "id"],
      [{ id: "t", colors: {} }, "name"],
      [{ id: "t", name: "T", colors: { "--color-text": "nope" } }, "色值非法"],
    ]
    for (const [input, fragment] of cases) {
      const res = parseTheme(input)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.message).toContain(fragment)
        expect(res.message).not.toMatch(/invalid|required|expected/i)
      }
    }
  })
})
