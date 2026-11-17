/**
 * applyTheme 的行为测试。
 *
 * 通过注入假 `ThemeTarget` 规避 node 环境无 DOM——被测的是「写入 / 精确清除」这套逻辑。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { applyTheme, type ThemeTarget } from "../apply"

/** 构造一个记录写入的假目标。 */
function fakeTarget(): { store: Map<string, string>; target: ThemeTarget } {
  const store = new Map<string, string>()
  const target: ThemeTarget = {
    style: {
      setProperty: (k, v) => void store.set(k, v),
      removeProperty: (k) => void store.delete(k),
    },
  }
  return { store, target }
}

describe("applyTheme", () => {
  let f: ReturnType<typeof fakeTarget>

  beforeEach(() => {
    f = fakeTarget()
    applyTheme(null, f.target) // 清掉模块级「已写入键」残留
  })

  it("写入主题 token", () => {
    applyTheme({ "--color-accent": "88 166 255" }, f.target)
    expect(f.store.get("--color-accent")).toBe("88 166 255")
  })

  it("切换主题时清除旧键、写入新键", () => {
    applyTheme({ "--color-accent": "1 1 1", "--color-text": "2 2 2" }, f.target)
    applyTheme({ "--color-text": "3 3 3" }, f.target)
    expect(f.store.has("--color-accent")).toBe(false)
    expect(f.store.get("--color-text")).toBe("3 3 3")
  })

  it("传 null 清空全部", () => {
    applyTheme({ "--color-accent": "1 1 1" }, f.target)
    applyTheme(null, f.target)
    expect(f.store.size).toBe(0)
  })
})
