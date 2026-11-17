/**
 * 防抖自动保存订阅者（`attachAutosave`）的行为测试。
 *
 * 覆盖用例：
 * - 多次连续提交只落盘一次（防抖合并），且落盘内容为最后一次的状态；
 * - 未标脏的变更（如仅切换选中项）不触发保存；
 * - `detach` 之后不再保存。
 *
 * 依赖处理：`packFs` 整体 mock，使用 vitest 假定时器精确控制防抖窗口，
 * 测试只关注「何时触发保存、保存了几次」，不触碰真实文件系统。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

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

import { usePackStore } from "../packStore"
import { attachAutosave } from "../autosave"
import { packFs } from "../../tauri/pack-fs"

describe("attachAutosave", () => {
  let autosave: ReturnType<typeof attachAutosave>

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(packFs.writeTextAtomic).mockClear()
    autosave = attachAutosave(500)
  })

  afterEach(() => {
    autosave.detach()
    vi.useRealTimers()
  })

  it("多次连续提交只落盘一次", async () => {
    usePackStore.getState().commit((d) => {
      d.notes = "a"
    })
    usePackStore.getState().commit((d) => {
      d.notes = "ab"
    })
    usePackStore.getState().commit((d) => {
      d.notes = "abc"
    })
    expect(packFs.writeTextAtomic).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(packFs.writeTextAtomic).toHaveBeenCalledTimes(1)
    const json = JSON.parse(vi.mocked(packFs.writeTextAtomic).mock.calls[0][1])
    expect(json.notes).toBe("abc")
  })

  it("未标脏的变更不触发保存", async () => {
    usePackStore.setState({ selectedCardId: "x" })
    await vi.advanceTimersByTimeAsync(500)
    expect(packFs.writeTextAtomic).not.toHaveBeenCalled()
  })

  it("detach 后不再保存", async () => {
    autosave.detach()
    usePackStore.getState().commit((d) => {
      d.notes = "z"
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(packFs.writeTextAtomic).not.toHaveBeenCalled()
  })
})

describe("attachAutosave.flush", () => {
  it("立即落盘并取消待触发的计时器", async () => {
    vi.useFakeTimers()
    usePackStore.setState(usePackStore.getInitialState(), true)
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(packFs.writeTextAtomic).mockClear()
    const autosave = attachAutosave(500)

    usePackStore.getState().commit((d) => {
      d.notes = "x"
    })
    await autosave.flush()

    expect(packFs.writeTextAtomic).toHaveBeenCalledTimes(1)
    expect(usePackStore.getState().saveStatus).toBe("saved")

    // 计时器已被取消：推进时间不应产生第二次写盘。
    await vi.advanceTimersByTimeAsync(1000)
    expect(packFs.writeTextAtomic).toHaveBeenCalledTimes(1)

    autosave.detach()
    vi.useRealTimers()
  })

  it("无可写内容时不产生多余写盘", async () => {
    vi.useFakeTimers()
    usePackStore.setState(usePackStore.getInitialState(), true)
    vi.mocked(packFs.writeTextAtomic).mockClear()
    const autosave = attachAutosave(500)

    await autosave.flush()

    expect(packFs.writeTextAtomic).not.toHaveBeenCalled()
    autosave.detach()
    vi.useRealTimers()
  })
})
