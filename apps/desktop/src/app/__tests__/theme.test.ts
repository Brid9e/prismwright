/**
 * 选中主题 id 的持久化测试。
 *
 * 底层 `@tauri-apps/plugin-store` 换成假 store——被测的是读写与默认值回退，不是 Tauri。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }))

import { load as storeLoad } from "@tauri-apps/plugin-store"
import { loadThemeId, saveThemeId } from "../theme"
import { DEFAULT_THEME_ID } from "../../themes/builtin"

/** 构造一个内存假 store。 */
function fakeStore(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    get: async (k: string) => data.get(k),
    set: async (k: string, v: unknown) => void data.set(k, v),
    save: vi.fn(async () => {}),
    data,
  }
}

describe("loadThemeId", () => {
  beforeEach(() => vi.clearAllMocks())

  it("读到已保存的 id", async () => {
    const s = fakeStore({ theme: "github-dark" })
    vi.mocked(storeLoad).mockResolvedValueOnce(s as never)
    expect(await loadThemeId()).toBe("github-dark")
  })

  it("未保存或非字符串时回退默认", async () => {
    vi.mocked(storeLoad).mockResolvedValueOnce(fakeStore() as never)
    expect(await loadThemeId()).toBe(DEFAULT_THEME_ID)
    vi.mocked(storeLoad).mockResolvedValueOnce(fakeStore({ theme: 7 }) as never)
    expect(await loadThemeId()).toBe(DEFAULT_THEME_ID)
  })

  it("读取抛错时回退默认", async () => {
    vi.mocked(storeLoad).mockRejectedValueOnce(new Error("no tauri"))
    expect(await loadThemeId()).toBe(DEFAULT_THEME_ID)
  })
})

describe("saveThemeId", () => {
  beforeEach(() => vi.clearAllMocks())

  it("写入并落盘", async () => {
    const s = fakeStore()
    vi.mocked(storeLoad).mockResolvedValueOnce(s as never)
    await saveThemeId("github-dark")
    expect(s.data.get("theme")).toBe("github-dark")
    expect(s.save).toHaveBeenCalledTimes(1)
  })

  it("写失败不抛错", async () => {
    vi.mocked(storeLoad).mockRejectedValueOnce(new Error("no tauri"))
    await expect(saveThemeId("x")).resolves.toBeUndefined()
  })
})
