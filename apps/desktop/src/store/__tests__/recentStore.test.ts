/**
 * recentStore 的行为测试。
 *
 * 重点：去重置顶、上限截断、失效探测、以及无效条目被过滤。
 * 磁盘与探测都 mock 掉——被测的是编排逻辑，不是 Tauri。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: { isPackDir: vi.fn(async () => true) },
}))

vi.mock("../../app/recentPacks", async () => {
  // 只从真实模块借用 `RECENT_LIMIT`（截断上限），两个 I/O 函数换成间谍。
  // 用显式形状而非 `typeof import(...)`：后者被项目的 no-import()-type 规则禁止。
  const actual = await vi.importActual<{ RECENT_LIMIT: number }>("../../app/recentPacks")
  return {
    ...actual,
    loadRecentPacks: vi.fn(async () => []),
    saveRecentPacks: vi.fn(async () => {}),
  }
})

// 底层 store 的 `load` 也要能兜住：真实 `loadRecentPacks`（见下方坏数据过滤用例）
// 会经它读盘，注入混合数据才能覆盖 `isRecentPack` 的过滤分支。
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(),
}))

import { useRecentStore, upsertRecent } from "../recentStore"
import { loadRecentPacks, saveRecentPacks, type RecentPack } from "../../app/recentPacks"
import { packFs } from "../../tauri/pack-fs"
import { load as storeLoad } from "@tauri-apps/plugin-store"

function reset() {
  useRecentStore.setState(useRecentStore.getInitialState(), true)
}

describe("upsertRecent（纯函数）", () => {
  const a: RecentPack = { name: "A", rootDir: "/a", openedAt: 1 }
  const b: RecentPack = { name: "B", rootDir: "/b", openedAt: 2 }

  it("新项置顶", () => {
    expect(upsertRecent([a], { name: "B", rootDir: "/b" }, 9)).toEqual([
      { name: "B", rootDir: "/b", openedAt: 9 },
      a,
    ])
  })

  it("同 rootDir 去重并刷新到顶部", () => {
    expect(upsertRecent([a, b], { name: "A2", rootDir: "/a" }, 9)).toEqual([
      { name: "A2", rootDir: "/a", openedAt: 9 },
      b,
    ])
  })

  it("超过上限截断尾部", () => {
    const many: RecentPack[] = Array.from({ length: 12 }, (_, i) => ({
      name: `n${i}`,
      rootDir: `/r${i}`,
      openedAt: i,
    }))
    const out = upsertRecent(many, { name: "new", rootDir: "/new" }, 99)
    expect(out).toHaveLength(10)
    expect(out[0].rootDir).toBe("/new")
    // 同时钉住尾部：切片边界若有偏差（多切/少切一条），尾部会立刻暴露。
    expect(out[9].rootDir).toBe("/r8")
    expect(out.some((r) => r.rootDir === "/r11")).toBe(false)
  })
})

describe("recentStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("load 从磁盘读入", async () => {
    vi.mocked(loadRecentPacks).mockResolvedValueOnce([{ name: "A", rootDir: "/a", openedAt: 1 }])
    await useRecentStore.getState().load()
    expect(useRecentStore.getState().recent).toEqual([{ name: "A", rootDir: "/a", openedAt: 1 }])
  })

  it("push 置顶并落盘", async () => {
    await useRecentStore.getState().push({ name: "A", rootDir: "/a" })
    expect(useRecentStore.getState().recent).toHaveLength(1)
    expect(useRecentStore.getState().recent[0].rootDir).toBe("/a")
    expect(saveRecentPacks).toHaveBeenCalledTimes(1)
  })

  it("push 只清掉该项的失效标记，不误伤其他", async () => {
    // 埋两个键：被 push 的那个应被摘除，无关的那个必须留下——
    // 若实现偷懒整体 reset（`missing: {}`），无关键的消失会让本用例失败。
    useRecentStore.setState({ missing: { "/a": true, "/other": true } })
    await useRecentStore.getState().push({ name: "A", rootDir: "/a" })
    expect(useRecentStore.getState().missing).toEqual({ "/other": true })
  })

  it("remove 移除一条并落盘", async () => {
    useRecentStore.setState({ recent: [{ name: "A", rootDir: "/a", openedAt: 1 }] })
    await useRecentStore.getState().remove("/a")
    expect(useRecentStore.getState().recent).toEqual([])
    expect(saveRecentPacks).toHaveBeenCalledWith([])
  })

  // 系列改名后，最近列表里那条也要跟着改：否则关掉再打开前，菜单/启动屏还是旧名。
  // 改名不是「打开」，所以顺序与时间戳必须原样——用 push 图省事会把那条顶到最前。
  it("rename 只改名字，不动排序与打开时间，并落盘", async () => {
    useRecentStore.setState({
      recent: [
        { name: "旧名", rootDir: "/a", openedAt: 5 },
        { name: "B", rootDir: "/b", openedAt: 1 },
      ],
    })
    await useRecentStore.getState().rename("/a", "新名")
    expect(useRecentStore.getState().recent).toEqual([
      { name: "新名", rootDir: "/a", openedAt: 5 },
      { name: "B", rootDir: "/b", openedAt: 1 },
    ])
    expect(saveRecentPacks).toHaveBeenCalledTimes(1)
  })

  it("rename 找不到对应目录时原样返回、不落盘", async () => {
    useRecentStore.setState({ recent: [{ name: "A", rootDir: "/a", openedAt: 1 }] })
    await useRecentStore.getState().rename("/nope", "新名")
    expect(useRecentStore.getState().recent).toEqual([{ name: "A", rootDir: "/a", openedAt: 1 }])
    expect(saveRecentPacks).not.toHaveBeenCalled()
  })

  it("clear 清空全部", async () => {
    useRecentStore.setState({
      recent: [{ name: "A", rootDir: "/a", openedAt: 1 }],
      missing: { "/a": true },
    })
    await useRecentStore.getState().clear()
    expect(useRecentStore.getState().recent).toEqual([])
    expect(useRecentStore.getState().missing).toEqual({})
  })

  it("probeMissing 只标记探测失败项", async () => {
    useRecentStore.setState({
      recent: [
        { name: "A", rootDir: "/ok", openedAt: 1 },
        { name: "B", rootDir: "/gone", openedAt: 2 },
      ],
    })
    vi.mocked(packFs.isPackDir).mockImplementation(async (p: string) => p === "/ok")
    await useRecentStore.getState().probeMissing()
    expect(useRecentStore.getState().missing).toEqual({ "/gone": true })
  })

  it("probeMissing 探测抛错时按失效处理", async () => {
    useRecentStore.setState({ recent: [{ name: "A", rootDir: "/boom", openedAt: 1 }] })
    vi.mocked(packFs.isPackDir).mockRejectedValueOnce(new Error("IO"))
    await useRecentStore.getState().probeMissing()
    expect(useRecentStore.getState().missing).toEqual({ "/boom": true })
  })
})

describe("loadRecentPacks（真实实现：坏数据过滤）", () => {
  /**
   * 上方把 `loadRecentPacks` 整体换成了间谍，`isRecentPack` 因此从未真正跑过。
   * 这里用 `importActual` 取回真实实现，再把底层 `@tauri-apps/plugin-store` 的 `load`
   * 换成返回混合数组的假 store——旧版或手改过的 preferences.json 可能混入缺字段的条目，
   * 读入时须剔除，而不是带病塞进最近列表。
   */
  it("丢弃形状非法的磁盘记录，只保留合法项", async () => {
    const { loadRecentPacks: realLoad } = await vi.importActual<{
      loadRecentPacks: () => Promise<RecentPack[]>
    }>("../../app/recentPacks")

    const valid: RecentPack = { name: "OK", rootDir: "/ok", openedAt: 1 }
    const disk = [
      valid,
      { name: "缺 rootDir" }, // 少字段
      null, // 非对象
      { name: "字段类型错", rootDir: 7, openedAt: 2 }, // rootDir 非 string
    ]
    const fakeStore = { get: async () => disk }
    vi.mocked(storeLoad).mockResolvedValueOnce(
      fakeStore as unknown as Awaited<ReturnType<typeof storeLoad>>,
    )

    expect(await realLoad()).toEqual([valid])
  })
})
