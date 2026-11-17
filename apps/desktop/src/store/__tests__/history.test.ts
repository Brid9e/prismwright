/**
 * packStore 的变更提交与撤销 / 重做行为测试。
 *
 * 覆盖用例：
 * - `commit` 深拷贝改数据、标脏、把旧引用压入撤销栈；
 * - `undo` / `redo` 的快照往返与空栈惰性；
 * - 合并窗口：相同 `mergeKey` 且落在窗口内合并为一步，否则分步；
 * - 新提交清空重做栈；`updatedAt` 单调递增；无 `pack` 时 `commit` 为安全空操作。
 *
 * 依赖处理：`packFs` 整体 mock，测试只关心内存状态与历史栈，不触碰文件系统。
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

import { usePackStore } from "../packStore"

/** 以新建一个空系列作为每个用例的共同起点，保证存在可编辑的 `pack`。 */
async function seed() {
  await usePackStore.getState().newPack("P", "/tmp/p")
}

describe("commit / undo / redo", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
    await seed()
  })

  it("commit 修改数据、标脏、入历史", () => {
    const s0 = usePackStore.getState()
    usePackStore.getState().commit((d) => {
      d.notes = "hello"
    })
    const s1 = usePackStore.getState()
    expect(s1.pack?.notes).toBe("hello")
    expect(s1.saveStatus).toBe("dirty")
    expect(s1.past).toHaveLength(1)
    expect(s1.past[0]).toBe(s0.pack) // 旧引用入栈
    expect(s1.future).toHaveLength(0)
  })

  it("undo 回到上一状态，redo 再前进", () => {
    const original = usePackStore.getState().pack
    usePackStore.getState().commit((d) => {
      d.notes = "A"
    })
    usePackStore.getState().undo()
    expect(usePackStore.getState().pack).toBe(original)
    usePackStore.getState().redo()
    expect(usePackStore.getState().pack?.notes).toBe("A")
  })

  it("undo/redo 在栈空时不动", () => {
    const before = usePackStore.getState().pack
    usePackStore.getState().undo()
    expect(usePackStore.getState().pack).toBe(before)
    usePackStore.getState().redo()
    expect(usePackStore.getState().pack).toBe(before)
  })

  it("相同 mergeKey 在时间窗内合并为一步", () => {
    usePackStore.getState().commit(
      (d) => {
        d.notes = "a"
      },
      { mergeKey: "notes", now: 1000 },
    )
    usePackStore.getState().commit(
      (d) => {
        d.notes = "ab"
      },
      { mergeKey: "notes", now: 1200 },
    )
    usePackStore.getState().commit(
      (d) => {
        d.notes = "abc"
      },
      { mergeKey: "notes", now: 1400 },
    )
    expect(usePackStore.getState().past).toHaveLength(1)
    usePackStore.getState().undo()
    expect(usePackStore.getState().pack?.notes).toBe("")
  })

  it("超过时间窗则不合并", () => {
    usePackStore.getState().commit(
      (d) => {
        d.notes = "a"
      },
      { mergeKey: "notes", now: 1000 },
    )
    usePackStore.getState().commit(
      (d) => {
        d.notes = "b"
      },
      { mergeKey: "notes", now: 2000 },
    )
    expect(usePackStore.getState().past).toHaveLength(2)
  })

  it("不同 mergeKey 不合并", () => {
    usePackStore.getState().commit(
      (d) => {
        d.notes = "a"
      },
      { mergeKey: "notes", now: 1000 },
    )
    usePackStore.getState().commit(
      (d) => {
        d.name = "X"
      },
      { mergeKey: "name", now: 1100 },
    )
    expect(usePackStore.getState().past).toHaveLength(2)
  })

  it("新提交清空 redo 栈", () => {
    usePackStore.getState().commit((d) => {
      d.notes = "a"
    })
    usePackStore.getState().undo()
    expect(usePackStore.getState().future).toHaveLength(1)
    usePackStore.getState().commit((d) => {
      d.notes = "b"
    })
    expect(usePackStore.getState().future).toHaveLength(0)
  })

  it("undo 清除 lastMergeKey，使下次提交不并入旧窗口", () => {
    // 第一次提交：lastMergeKey 从 null 变为 "notes"，旧引用入栈（past 长度 1）。
    usePackStore.getState().commit(
      (d) => {
        d.notes = "a"
      },
      { mergeKey: "notes", now: 1000 },
    )
    // 撤销：当前状态移入 future，同时 lastMergeKey 被清空为 null。
    usePackStore.getState().undo()
    // 再次提交相同 mergeKey，且 now（1001）落在合并窗口（500ms）内。
    // 若 mergeKey 未被 undo 清除，本次会被并入上一步、不再新增历史点（past 长度 0）；
    // 因为 undo 已清除，canMerge 为 false，旧引用重新入栈。
    usePackStore.getState().commit(
      (d) => {
        d.notes = "b"
      },
      { mergeKey: "notes", now: 1001 },
    )
    // 关键断言：撤销后 past 已被清空（undo 取出唯一元素），新提交再压入一条，故长度恰为 1。
    expect(usePackStore.getState().past).toHaveLength(1)
    expect(usePackStore.getState().future).toHaveLength(0)
  })

  it("撤销栈达到 HISTORY_LIMIT(100) 后截断，丢弃最早快照", () => {
    // 101 次不带 mergeKey 的提交：mergeKey 恒为 null，canMerge 恒为 false，逐条入栈。
    // 提交纯同步、无 IO，循环开销可忽略。
    for (let i = 0; i < 101; i++) {
      usePackStore.getState().commit((d) => {
        d.notes = String(i)
      })
    }
    // 栈深被 slice(-HISTORY_LIMIT) 限制为 100，最早那一条被丢弃。
    expect(usePackStore.getState().past).toHaveLength(100)
  })

  it("重做栈同样不超过 HISTORY_LIMIT(100)", () => {
    // 先堆满撤销栈（100 条），再多撤几次直到撤销栈耗尽。
    for (let i = 0; i < 101; i++) {
      usePackStore.getState().commit((d) => {
        d.notes = String(i)
      })
    }
    for (let i = 0; i < 150; i++) {
      usePackStore.getState().undo()
    }
    // 重做栈在 undo 内亦用 slice(0, HISTORY_LIMIT) 截断，恒不超过上限。
    expect(usePackStore.getState().future.length).toBeLessThanOrEqual(100)
  })

  it("commit 更新 updatedAt", () => {
    const before = usePackStore.getState().pack!.updatedAt
    usePackStore.getState().commit((d) => {
      d.notes = "x"
    })
    expect(usePackStore.getState().pack!.updatedAt).not.toBe(before)
  })

  it("updatedAt 严格单调：注入的 now 落后时仍不倒退", () => {
    usePackStore.getState().commit(
      (d) => {
        d.notes = "a"
      },
      { now: 1000 },
    )
    const t1 = usePackStore.getState().pack!.updatedAt
    // 第二次的 now（500）早于上一条的基准时间（模拟时钟回拨 / 注入历史时间戳）；
    // 实现取 max(now, prev+1)，故 updatedAt 仍严格大于上一条而非倒退。
    usePackStore.getState().commit(
      (d) => {
        d.notes = "b"
      },
      { now: 500 },
    )
    const t2 = usePackStore.getState().pack!.updatedAt
    expect(Date.parse(t2)).toBeGreaterThan(Date.parse(t1))
  })

  it("无 pack 时 commit 不报错也不改状态", () => {
    usePackStore.setState({ pack: null })
    expect(() =>
      usePackStore.getState().commit((d) => {
        d.notes = "x"
      }),
    ).not.toThrow()
    expect(usePackStore.getState().pack).toBeNull()
  })
})
