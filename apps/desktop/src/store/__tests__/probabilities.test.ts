/**
 * packStore 写入抽卡权重表的行为测试。
 *
 * 这张表会被原样发布到云端、被云函数的 `pickDraw` 消费，所以两件事最要紧：
 * 全 0 必须落成空表（= 老系列的「按卡数均匀」语义，而不是一份全是 0 的记录），
 * 以及「没改数字点确定」不能凭空多出一个撤销点。
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
    readAssetBytes: vi.fn(async () => new ArrayBuffer(0)),
  },
}))

import { usePackStore } from "../packStore"

/** 五档全 0。 */
const ZERO = { common: 0, rare: 0, epic: 0, legendary: 0, hidden: 0 }

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
}

describe("packStore 抽卡权重", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("写入正权重时只保留大于 0 的档位", async () => {
    await setup()

    usePackStore.getState().setRarityProbabilities({
      common: 70,
      rare: 20,
      epic: 8,
      legendary: 2,
      hidden: 0,
    })

    expect(usePackStore.getState().pack?.rarityProbabilities).toEqual({
      common: 70,
      rare: 20,
      epic: 8,
      legendary: 2,
    })
  })

  it("负权重与 NaN 归 0，不被写进记录", async () => {
    await setup()

    usePackStore.getState().setRarityProbabilities({
      common: -5,
      rare: Number.NaN,
      epic: 1,
      legendary: 0,
      hidden: 0,
    })

    expect(usePackStore.getState().pack?.rarityProbabilities).toEqual({ epic: 1 })
  })

  it("全 0 落成空表：与新建系列完全一致，回到「按卡数均匀」", async () => {
    await setup()
    usePackStore.getState().setRarityProbabilities({ ...ZERO, legendary: 9 })
    expect(usePackStore.getState().pack?.rarityProbabilities).toEqual({ legendary: 9 })

    usePackStore.getState().setRarityProbabilities(ZERO)

    expect(usePackStore.getState().pack?.rarityProbabilities).toEqual({})
  })

  it("写入是一次可撤销的提交", async () => {
    await setup()

    usePackStore.getState().setRarityProbabilities({ ...ZERO, hidden: 1 })
    expect(usePackStore.getState().pack?.rarityProbabilities).toEqual({ hidden: 1 })

    usePackStore.getState().undo()

    expect(usePackStore.getState().pack?.rarityProbabilities).toEqual({})
  })

  it("与现状等价时不留撤销点", async () => {
    await setup()
    const before = usePackStore.getState().past.length

    // 新系列本来就是空表；把五档都填 0 点「确定」不该在历史里多出一步。
    usePackStore.getState().setRarityProbabilities(ZERO)

    expect(usePackStore.getState().past.length).toBe(before)
  })

  it("数值没变、只是键序或写法不同，也不留撤销点", async () => {
    await setup()
    usePackStore.getState().setRarityProbabilities({ ...ZERO, rare: 30 })
    const before = usePackStore.getState().past.length

    usePackStore
      .getState()
      .setRarityProbabilities({ hidden: 0, legendary: 0, epic: 0, rare: 30, common: 0 })

    expect(usePackStore.getState().past.length).toBe(before)
  })
})
