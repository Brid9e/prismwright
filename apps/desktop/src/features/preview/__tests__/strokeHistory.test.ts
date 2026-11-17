/**
 * 擦除绘画的会话内步进历史：压栈 / 撤销 / 重做 / 上限。
 *
 * 用字符串充当快照：模块与画布无关，测的是「哪一份快照该被恢复、栈如何变化」。
 */
import { describe, it, expect } from "vitest"
import {
  STROKE_HISTORY_LIMIT,
  emptyStrokeHistory,
  pushStroke,
  redoStroke,
  undoStroke,
} from "../strokeHistory"

describe("strokeHistory", () => {
  it("撤销返回「这一笔之前」的快照，并把当前内容转入重做栈", () => {
    const history = emptyStrokeHistory<string>()
    pushStroke(history, "before-A")

    expect(undoStroke(history, "after-A")).toBe("before-A")
    expect(history.past).toEqual([])
    expect(history.future).toEqual(["after-A"])
  })

  it("没有可撤销的笔画时返回 null，历史不变", () => {
    const history = emptyStrokeHistory<string>()
    expect(undoStroke(history, "current")).toBeNull()
    expect(history).toEqual({ past: [], future: [] })
  })

  it("重做返回撤销时画布的样子，并重新计入已生效笔画", () => {
    const history = emptyStrokeHistory<string>()
    pushStroke(history, "before-A")
    undoStroke(history, "after-A")

    expect(redoStroke(history, "before-A")).toBe("after-A")
    expect(history.past).toEqual(["before-A"])
    expect(history.future).toEqual([])
  })

  it("没有可重做的内容时返回 null", () => {
    const history = emptyStrokeHistory<string>()
    expect(redoStroke(history, "current")).toBeNull()
  })

  it("撤销后重新落笔会清空重做栈", () => {
    const history = emptyStrokeHistory<string>()
    pushStroke(history, "before-A")
    undoStroke(history, "after-A")

    pushStroke(history, "before-B")
    expect(history.future).toEqual([])
    expect(redoStroke(history, "after-B")).toBeNull()
  })

  it("只保留最近 STROKE_HISTORY_LIMIT 笔，最早的快照被丢弃", () => {
    const history = emptyStrokeHistory<string>()
    for (let i = 0; i < STROKE_HISTORY_LIMIT + 2; i++) pushStroke(history, `snap-${i}`)

    expect(history.past).toHaveLength(STROKE_HISTORY_LIMIT)
    // 追不回最早的两笔：第一次撤销得到的是「第 3 笔之前」。
    expect(undoStroke(history, "current")).toBe(`snap-${STROKE_HISTORY_LIMIT + 1}`)
    expect(history.past[0]).toBe("snap-2")
  })
})
