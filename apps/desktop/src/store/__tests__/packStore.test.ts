/**
 * packStore 生命周期（新建 / 打开 / 保存）的行为测试。
 *
 * 覆盖用例：
 * - `newPack` 建目录、写 `pack.json`、状态转 `saved`；
 * - `openPack` 读取并 `parsePack` 解析，遇损坏数据置 `error` 且不抛；
 * - `openPack` 给老系列里名字为空的图层按位置补上默认名；
 * - `save` 写盘成功转 `saved`、失败置 `error` 并保留 `pack`。
 *
 * 依赖处理：`packFs`（Tauri 文件桥）被整体 mock，测试只关注 store 的状态迁移，
 * 不触碰真实文件系统与 `invoke`。
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
import { packFs } from "../../tauri/pack-fs"

/**
 * 把 store 复位到初始状态。
 *
 * 使用 zustand v5 的 `getInitialState()` 拿到「未受任何变更影响」的初始快照，
 * 再整体替换当前状态，保证每个用例彼此隔离（含历史栈、错误、选择态）。
 */
function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

describe("packStore 生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("newPack 建目录、写 pack.json、状态为已保存", async () => {
    await usePackStore.getState().newPack("星辰之约", "/tmp/pack")
    const s = usePackStore.getState()
    expect(s.pack?.name).toBe("星辰之约")
    expect(s.pack?.schemaVersion).toBe(9)
    expect(s.pack?.editorVersion).toBe("v1")
    expect(s.rootDir).toBe("/tmp/pack")
    expect(s.saveStatus).toBe("saved")
    expect(packFs.ensureDir).toHaveBeenCalledWith("/tmp/pack/assets")
    const writeCall = vi.mocked(packFs.writeTextAtomic).mock.calls[0]
    expect(writeCall[0]).toBe("/tmp/pack/pack.json")
    expect(JSON.parse(writeCall[1]).name).toBe("星辰之约")
    expect(JSON.parse(writeCall[1]).editorVersion).toBe("v1")
  })

  it("openPack 读文件并用 parsePack 解析", async () => {
    vi.mocked(packFs.readText).mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 7,
        id: "p1",
        name: "已有系列",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        cards: [],
      }),
    )
    await usePackStore.getState().openPack("/tmp/existing")
    const s = usePackStore.getState()
    expect(s.pack?.name).toBe("已有系列")
    expect(s.saveStatus).toBe("saved")
  })

  it("Windows 盘符目录下的落盘路径不混用分隔符", async () => {
    // 系列目录来自 Windows 的「文档」目录或原生目录框，都是反斜杠。若内部拼 `pack.json`
    // 与 `assets` 时固定用 `/`，得到的就是 `C:\Users\me\MyPacks/pack.json` 这类混着的路径
    // ——功能上能用，但显示出来和排错时都别扭。分隔符一律跟着目录走。
    await usePackStore.getState().newPack("P", "C:\\Users\\me\\MyPacks")
    expect(packFs.ensureDir).toHaveBeenCalledWith("C:\\Users\\me\\MyPacks\\assets")
    const writeCall = vi.mocked(packFs.writeTextAtomic).mock.calls[0]
    expect(writeCall[0]).toBe("C:\\Users\\me\\MyPacks\\pack.json")
  })

  it("openPack 给老数据里名字为空的图层补上默认名", async () => {
    // 「创建时写名」之前存下的 pack.json，图层名是空串。打开时按**位置**补名——补出来的
    // 名字与打开前界面显示的编号一致（用户看不出差别），而此后再拖拽重排，名字就固定在
    // 数据里、不再跟着位置跑。已有名字的图层原样不动。
    vi.mocked(packFs.readText).mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 7,
        id: "p2",
        name: "老系列",
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        cards: [
          {
            id: "c1",
            num: 1,
            name: "老卡",
            layers: [
              { id: "l1", name: "" },
              { id: "l2", name: "描边" },
              { id: "l3", name: "" },
            ],
          },
        ],
      }),
    )
    await usePackStore.getState().openPack("/tmp/old")
    const names = usePackStore.getState().pack!.cards[0].layers.map((l) => l.name)
    // 空名层拿到的是**它原来那个位置名**：第 1 层 → 「图层 1」、第 3 层 → 「图层 3」，
    // 与打开前界面上显示的编号一致（注意没有「图层 2」——那个编号本来就属于「描边」那一行，
    // 而它已经有名字了）。已有名字的图层原样不动。
    expect(names).toEqual(["图层 1", "描边", "图层 3"])
  })

  it("openPack 遇损坏数据时置 error 且不抛", async () => {
    vi.mocked(packFs.readText).mockResolvedValueOnce("{ not json")
    await usePackStore.getState().openPack("/tmp/broken")
    const s = usePackStore.getState()
    expect(s.saveStatus).toBe("error")
    expect(s.lastError).toBeTruthy()
    expect(s.pack).toBeNull()
  })

  it("save 写盘并把状态置为 saved", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(packFs.writeTextAtomic).mockClear()
    usePackStore.setState({ saveStatus: "dirty" })
    await usePackStore.getState().save()
    expect(packFs.writeTextAtomic).toHaveBeenCalledTimes(1)
    expect(usePackStore.getState().saveStatus).toBe("saved")
  })

  it("save 失败时置 error 并保留 pack", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    vi.mocked(packFs.writeTextAtomic).mockRejectedValueOnce(new Error("disk full"))
    usePackStore.setState({ saveStatus: "dirty" })
    await usePackStore.getState().save()
    const s = usePackStore.getState()
    expect(s.saveStatus).toBe("error")
    expect(s.lastError).toContain("disk full")
    expect(s.pack).not.toBeNull()
  })

  it("并发 save 串行落盘，旧快照不会覆盖新数据", async () => {
    // 先建包（内部会写一次盘），随后清掉这次调用记录，只观察后续两次并发写。
    await usePackStore.getState().newPack("P", "/tmp/pack")
    const write = vi.mocked(packFs.writeTextAtomic)
    write.mockClear()

    // 让「第一次写盘」挂起，模拟慢写；第二次写盘走默认实现（立即完成）。
    let resolveFirst!: () => void
    write.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))

    // 发起 save A：读到的快照是 v1（name = "P"），写盘挂起。
    const saveA = usePackStore.getState().save()
    // 让 A 走到写盘并进入挂起状态，再产生新版本数据。
    // 落盘前还有「合并图片层」那几步 await（无组时也要过几个微任务），故排空一整轮微任务
    // 才算 A 真的发起写入——`setTimeout(0)` 在微任务排空之后才执行。
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 提交 v2，并发起 save B。串行化保证 B 必须等 A 完成才写盘。
    usePackStore.getState().commit((d) => {
      d.name = "P2"
    })
    const saveB = usePackStore.getState().save()
    // 此刻只有 A 真正发起了一次写，B 仍在队列中等待——这正是串行化的关键。
    expect(write).toHaveBeenCalledTimes(1)

    // 放行 A，随后 A/B 依次完成。
    resolveFirst()
    await saveA
    await saveB

    // 最终落盘的必须是新数据 v2，且状态回到 saved（旧快照不得覆盖新数据）。
    const calls = write.mock.calls
    expect(JSON.parse(calls[calls.length - 1][1]).name).toBe("P2")
    expect(usePackStore.getState().saveStatus).toBe("saved")
  })
})

describe("packStore closePack", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePackStore.setState(usePackStore.getInitialState(), true)
  })

  it("清空回初始态：pack / rootDir / 历史 / 选择态全部归零", async () => {
    await usePackStore.getState().newPack("P", "/tmp/p")
    usePackStore.getState().addCard(false)
    expect(usePackStore.getState().pack).not.toBeNull()

    usePackStore.getState().closePack()

    const s = usePackStore.getState()
    expect(s.pack).toBeNull()
    expect(s.rootDir).toBeNull()
    expect(s.selectedCardId).toBeNull()
    expect(s.selectedLayerId).toBeNull()
    expect(s.past).toEqual([])
    expect(s.future).toEqual([])
    expect(s.saveStatus).toBe("idle")
  })
})
