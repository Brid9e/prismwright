/**
 * 「重命名系列」的行为测试。
 *
 * 改名只改 `pack.json` 的 `name`（显示名），**不动磁盘目录**——目录名与系列名不必一致，
 * 系列身份靠 `pack.id`。被测的是这三件事的编排：写进 store、同步「最近打开」那一条、
 * 立即落盘。文件系统与最近列表的持久化都 mock 掉。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    copyAsset: vi.fn(async () => ""),
    moveToTrash: vi.fn(async () => "token"),
    restoreFromTrash: vi.fn(async () => {}),
    purgeTrash: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
    isPackDir: vi.fn(async () => true),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
  },
}))

vi.mock("../../app/recentPacks", async () => {
  // 只从真实模块借用 `RECENT_LIMIT`，两个 I/O 函数换成间谍（同 recentStore.test.ts）。
  const actual = await vi.importActual<{ RECENT_LIMIT: number }>("../../app/recentPacks")
  return {
    ...actual,
    loadRecentPacks: vi.fn(async () => []),
    saveRecentPacks: vi.fn(async () => {}),
  }
})

import { confirmRenamePack } from "../packActions"
import { usePackStore } from "../../store/packStore"
import { useRecentStore } from "../../store/recentStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"

const ROOT = "/tmp/p"

function reset() {
  useUiStore.setState(useUiStore.getInitialState(), true)
  usePackStore.setState(usePackStore.getInitialState(), true)
  useRecentStore.setState(useRecentStore.getInitialState(), true)
}

describe("confirmRenamePack", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    reset()
    await usePackStore.getState().newPack("旧名", ROOT)
    vi.mocked(packFs.writeTextAtomic).mockClear()
    useRecentStore.setState({
      recent: [
        { name: "旧名", rootDir: ROOT, openedAt: 5 },
        { name: "B", rootDir: "/tmp/b", openedAt: 1 },
      ],
    })
  })

  // 改的是 pack.json 的 name，且要立刻落盘——拖到下一次编辑才写，用户关了应用就白改了。
  it("去掉首尾空白后改名，立即落盘并同步最近列表", async () => {
    expect(await confirmRenamePack("  新名  ")).toBe(true)
    expect(usePackStore.getState().pack?.name).toBe("新名")
    expect(useRecentStore.getState().recent).toEqual([
      { name: "新名", rootDir: ROOT, openedAt: 5 },
      { name: "B", rootDir: "/tmp/b", openedAt: 1 },
    ])
    expect(packFs.writeTextAtomic).toHaveBeenCalledTimes(1)
    const [, contents] = vi.mocked(packFs.writeTextAtomic).mock.calls[0]
    expect(JSON.parse(contents).name).toBe("新名")
  })

  // schema 要求 name 非空：空名一旦写进 pack.json，下次打开会被 parsePack 拒绝。
  it("空名拒绝，什么都不改", async () => {
    expect(await confirmRenamePack("   ")).toBe(false)
    expect(usePackStore.getState().pack?.name).toBe("旧名")
    expect(packFs.writeTextAtomic).not.toHaveBeenCalled()
  })

  // 名字没变（只多了空格）不必提交——否则白占一个撤销点、白写一次盘。
  it("名字没变时直接返回成功，不写盘", async () => {
    expect(await confirmRenamePack("旧名 ")).toBe(true)
    expect(usePackStore.getState().pack?.name).toBe("旧名")
    expect(packFs.writeTextAtomic).not.toHaveBeenCalled()
  })

  it("未打开系列时返回 false", async () => {
    reset()
    expect(await confirmRenamePack("新名")).toBe(false)
  })
})
