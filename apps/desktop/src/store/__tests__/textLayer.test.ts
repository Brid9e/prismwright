/**
 * 文字图层的 store 动作：建层即选中、默认名走文字池、文字参数深度合并且按字段合并历史。
 *
 * 合并键的约定是这里的重点：拖同一个滑块要被合并成一步历史，换个字段则必须各自成步。
 */
import { describe, it, expect, vi } from "vitest"

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

import { findLayerById, type CardFace } from "@prismwright/schema"
import { usePackStore } from "../packStore"
import type { FaceRef } from "../packStore"

const ref: FaceRef = { kind: "card", cardId: "c1" }

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

/** 建一个含单张卡片的系列，返回卡片 id。 */
async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
  const cardId = usePackStore.getState().addCard(false)!
  return { cardId }
}

function face(cardId: string): CardFace {
  return usePackStore.getState().pack!.cards.find((c) => c.id === cardId)!
}

describe("addTextLayer", () => {
  it("建文字层、选中它、默认名走文字池", async () => {
    reset()
    const { cardId } = await setup()
    const id = usePackStore.getState().addTextLayer({ ...ref, cardId }, "文字")
    expect(id).toBeTruthy()
    const layer = findLayerById(face(cardId).layers, id!)!
    expect(layer.kind).toBe("text")
    expect(layer.text?.content).toBe("文字")
    expect(layer.name).toBe("文字 1")
    expect(usePackStore.getState().selectedLayerId).toBe(id)
  })

  it("一次撤销即可让整个文字层消失", async () => {
    reset()
    const { cardId } = await setup()
    const before = face(cardId).layers.length
    usePackStore.getState().addTextLayer({ ...ref, cardId }, "文字")
    usePackStore.getState().undo()
    expect(face(cardId).layers).toHaveLength(before)
  })
})

describe("updateTextLayer", () => {
  it("深度合并：只改传入的字段，其余保留", async () => {
    reset()
    const { cardId } = await setup()
    const id = usePackStore.getState().addTextLayer({ ...ref, cardId }, "A")!
    usePackStore.getState().updateTextLayer({ ...ref, cardId }, id, {
      fontSize: 0.3,
      color: "#ff0000",
    })
    const layer = findLayerById(face(cardId).layers, id)!
    expect(layer.text?.fontSize).toBe(0.3)
    expect(layer.text?.color).toBe("#ff0000")
    expect(layer.text?.content).toBe("A")
    expect(layer.text?.fontFamily).toBe("sans-serif")
  })

  it("同一字段在窗口内连续提交合并为一步；换字段另起一步", async () => {
    reset()
    const { cardId } = await setup()
    const id = usePackStore.getState().addTextLayer({ ...ref, cardId }, "A")!
    const { updateTextLayer, undo } = usePackStore.getState()
    const depth = usePackStore.getState().past.length
    updateTextLayer({ ...ref, cardId }, id, { fontSize: 0.2 }, { now: 0 })
    updateTextLayer({ ...ref, cardId }, id, { fontSize: 0.25 }, { now: 100 })
    expect(usePackStore.getState().past.length).toBe(depth + 1)
    updateTextLayer({ ...ref, cardId }, id, { color: "#00ff00" }, { now: 200 })
    expect(usePackStore.getState().past.length).toBe(depth + 2)
    // 撤销一次只回退颜色，字号仍是合并后的值。
    undo()
    const layer = findLayerById(face(cardId).layers, id)!
    expect(layer.text?.fontSize).toBe(0.25)
    expect(layer.text?.color).toBe("#ffffff")
  })

  it("非文字层 / 图层不存在：安静空操作（不留历史点）", async () => {
    reset()
    const { cardId } = await setup()
    const normalId = face(cardId).layers[0].id
    const depth = usePackStore.getState().past.length
    usePackStore.getState().updateTextLayer({ ...ref, cardId }, normalId, { fontSize: 0.3 })
    usePackStore.getState().updateTextLayer({ ...ref, cardId }, "missing", { fontSize: 0.3 })
    expect(usePackStore.getState().past.length).toBe(depth)
    expect(findLayerById(face(cardId).layers, normalId)?.text).toBeNull()
  })

  it("描边 / 投影整体替换（嵌套对象不逐字段合并）", async () => {
    reset()
    const { cardId } = await setup()
    const id = usePackStore.getState().addTextLayer({ ...ref, cardId }, "A")!
    usePackStore.getState().updateTextLayer({ ...ref, cardId }, id, {
      stroke: { color: "#123456", width: 0.01 },
    })
    expect(findLayerById(face(cardId).layers, id)?.text?.stroke).toEqual({
      color: "#123456",
      width: 0.01,
    })
    usePackStore.getState().updateTextLayer({ ...ref, cardId }, id, { stroke: null })
    expect(findLayerById(face(cardId).layers, id)?.text?.stroke).toBeNull()
  })
})
