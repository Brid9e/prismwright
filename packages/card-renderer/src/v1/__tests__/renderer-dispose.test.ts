import { describe, it, expect, vi } from "vitest"
import { disposeRenderer } from "../renderer-dispose"

describe("disposeRenderer", () => {
  it("正常渲染器：调用一次 dispose", () => {
    const dispose = vi.fn()
    disposeRenderer({ dispose })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("dispose 抛错时不向外扩散（小程序缺 self 的空指针）", () => {
    // 真机报错原文：three 的 dispose 末尾 animation.stop() 读 null 的 cancelAnimationFrame。
    const renderer = {
      dispose() {
        throw new TypeError("null is not an object (evaluating 'e.cancelAnimationFrame')")
      },
    }
    expect(() => disposeRenderer(renderer)).not.toThrow()
  })
})
