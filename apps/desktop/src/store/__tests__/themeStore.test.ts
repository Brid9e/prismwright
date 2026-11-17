/**
 * themeStore 的行为测试。
 *
 * 磁盘（packFs / themeFs）、持久化（app/theme）与 DOM（themes/apply）全部 mock——被测的
 * 是编排逻辑（load / select / 导入各分支），不是 Tauri 或浏览器。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: { pickFile: vi.fn(async () => null), readText: vi.fn(async () => "") },
}))
vi.mock("../../tauri/theme-fs", () => ({
  themeFs: { listImported: vi.fn(async () => []), install: vi.fn(async () => {}) },
}))
vi.mock("../../app/theme", () => ({
  loadThemeId: vi.fn(async () => "default"),
  saveThemeId: vi.fn(async () => {}),
}))
vi.mock("../../themes/apply", () => ({ applyTheme: vi.fn() }))

import { useThemeStore } from "../themeStore"
import { packFs } from "../../tauri/pack-fs"
import { themeFs } from "../../tauri/theme-fs"
import { saveThemeId } from "../../app/theme"
import { applyTheme } from "../../themes/apply"

/** 一份合法主题 JSON 文本。 */
const validTheme = JSON.stringify({
  id: "ocean",
  name: "Ocean",
  colors: { "--color-accent": "1 2 3" },
})

function reset() {
  useThemeStore.setState(useThemeStore.getInitialState(), true)
}

describe("themeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("load 合并带入的导入主题", async () => {
    vi.mocked(themeFs.listImported).mockResolvedValueOnce([
      { fileName: "ocean.json", contents: validTheme },
    ])
    await useThemeStore.getState().load()
    expect(useThemeStore.getState().themes.some((t) => t.meta.id === "ocean")).toBe(true)
  })

  it("load 在 listImported 抛错时降级为空导入", async () => {
    vi.mocked(themeFs.listImported).mockRejectedValueOnce(new Error("no tauri"))
    await useThemeStore.getState().load()
    expect(useThemeStore.getState().themes.some((t) => t.meta.id === "default")).toBe(true)
  })

  it("select 应用 token 并持久化", async () => {
    await useThemeStore.getState().load()
    await useThemeStore.getState().select("github-dark")
    expect(applyTheme).toHaveBeenCalled()
    expect(saveThemeId).toHaveBeenCalledWith("github-dark")
    expect(useThemeStore.getState().selectedId).toBe("github-dark")
  })

  it("导入成功：install 落盘、刷新并选中", async () => {
    vi.mocked(packFs.pickFile).mockResolvedValueOnce("/tmp/ocean.json")
    vi.mocked(packFs.readText).mockResolvedValueOnce(validTheme)
    // 落盘后重读磁盘应能读到刚写入的 ocean——锁住「安装 → 重载 → 选中」这条链路
    // （否则导入后若重载失效，本用例仍会因默认空列表而蒙混过关）。
    vi.mocked(themeFs.listImported).mockResolvedValueOnce([
      { fileName: "ocean.json", contents: validTheme },
    ])
    await useThemeStore.getState().importFromFile()
    expect(themeFs.install).toHaveBeenCalledWith("ocean", expect.any(String))
    expect(useThemeStore.getState().themes.some((t) => t.meta.id === "ocean")).toBe(true)
    expect(useThemeStore.getState().selectedId).toBe("ocean")
    expect(useThemeStore.getState().importError).toBeNull()
    expect(applyTheme).toHaveBeenCalledWith({ "--color-accent": "1 2 3" })
  })

  it("取消选择不触发任何动作", async () => {
    vi.mocked(packFs.pickFile).mockResolvedValueOnce(null)
    await useThemeStore.getState().importFromFile()
    expect(themeFs.install).not.toHaveBeenCalled()
  })

  it("非法 JSON 置 themeInvalid", async () => {
    vi.mocked(packFs.pickFile).mockResolvedValueOnce("/tmp/x.json")
    vi.mocked(packFs.readText).mockResolvedValueOnce("{not json")
    await useThemeStore.getState().importFromFile()
    expect(useThemeStore.getState().importError?.key).toBe("themeInvalid")
  })

  it("与内置同 id 置 themeConflict", async () => {
    vi.mocked(packFs.pickFile).mockResolvedValueOnce("/tmp/x.json")
    vi.mocked(packFs.readText).mockResolvedValueOnce(
      JSON.stringify({ id: "github-dark", name: "D", colors: {} }),
    )
    await useThemeStore.getState().importFromFile()
    expect(useThemeStore.getState().importError?.key).toBe("themeConflict")
  })

  it("install 抛错置 themeImportFailed", async () => {
    vi.mocked(packFs.pickFile).mockResolvedValueOnce("/tmp/ocean.json")
    vi.mocked(packFs.readText).mockResolvedValueOnce(validTheme)
    vi.mocked(themeFs.install).mockRejectedValueOnce(new Error("disk"))
    await useThemeStore.getState().importFromFile()
    expect(useThemeStore.getState().importError?.key).toBe("themeImportFailed")
  })
})
