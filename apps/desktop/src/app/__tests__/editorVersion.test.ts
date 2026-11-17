/**
 * 编辑器版本偏好的持久化测试。
 *
 * 底层 `@tauri-apps/plugin-store` 换成假 store——被测的是读写与默认值回退，不是 Tauri。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }))

import { load as storeLoad } from "@tauri-apps/plugin-store"
import { loadEditorVersion, saveEditorVersion } from "../editorVersion"
import { DEFAULT_EDITOR_VERSION } from "../editorVersions"

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

describe("loadEditorVersion", () => {
  beforeEach(() => vi.clearAllMocks())

  it("读到已保存的版本", async () => {
    vi.mocked(storeLoad).mockResolvedValueOnce(fakeStore({ editorVersion: "v1" }) as never)
    expect(await loadEditorVersion()).toBe("v1")
  })

  it("未保存、未知版本或非字符串时回退默认", async () => {
    vi.mocked(storeLoad).mockResolvedValueOnce(fakeStore() as never)
    expect(await loadEditorVersion()).toBe(DEFAULT_EDITOR_VERSION)

    // 将来发布 v2 之前，"v2" 仍是非法值——未知版本必须回退，而不是让编辑器加载不存在的版本。
    vi.mocked(storeLoad).mockResolvedValueOnce(fakeStore({ editorVersion: "v2" }) as never)
    expect(await loadEditorVersion()).toBe(DEFAULT_EDITOR_VERSION)

    vi.mocked(storeLoad).mockResolvedValueOnce(fakeStore({ editorVersion: 7 }) as never)
    expect(await loadEditorVersion()).toBe(DEFAULT_EDITOR_VERSION)
  })

  it("读取抛错时回退默认", async () => {
    vi.mocked(storeLoad).mockRejectedValueOnce(new Error("no tauri"))
    expect(await loadEditorVersion()).toBe(DEFAULT_EDITOR_VERSION)
  })
})

describe("saveEditorVersion", () => {
  beforeEach(() => vi.clearAllMocks())

  it("写入并落盘", async () => {
    const s = fakeStore()
    vi.mocked(storeLoad).mockResolvedValueOnce(s as never)
    await saveEditorVersion("v1")
    expect(s.data.get("editorVersion")).toBe("v1")
    expect(s.save).toHaveBeenCalledTimes(1)
  })

  it("写失败不抛错", async () => {
    vi.mocked(storeLoad).mockRejectedValueOnce(new Error("no tauri"))
    await expect(saveEditorVersion("v1")).resolves.toBeUndefined()
  })
})
