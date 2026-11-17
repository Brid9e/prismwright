/**
 * `throttle.ts` 纯逻辑测试。
 *
 * 覆盖用例：
 * - 首沿立即执行（第一个事件不许等窗口）；
 * - 窗口内的连续调用只在窗口末尾补写**最后一次**（尾沿不丢值）；
 * - **回归**：窗口自首沿起算、不因窗口内的调用而重置——写成 debounce 的话，拖着取色板
 *   一次都不会写，「实时」直接没了；
 * - 没有挂起值时不补写，只调一次不会变成同一窗口里的两次重复提交；
 * - 补写之后的下一个调用回到首沿路径（窗口周期性）。
 *
 * 环境：node（`vitest.config.ts`）+ 假定时器；被测对象无 DOM 依赖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { throttle } from "../throttle"

describe("throttle", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("首沿立即执行", () => {
    const writes: number[] = []
    const tick = throttle((v: number) => writes.push(v), 100)
    tick.call(1)
    expect(writes).toEqual([1])
  })

  it("窗口内的连续调用只在窗口末尾补写最后一次", () => {
    const writes: number[] = []
    const tick = throttle((v: number) => writes.push(v), 100)
    tick.call(1)
    vi.advanceTimersByTime(30)
    tick.call(2)
    vi.advanceTimersByTime(30)
    tick.call(3)
    expect(writes).toEqual([1]) // 窗口内一次都没写
    vi.advanceTimersByTime(40) // 到首沿之后 100ms
    expect(writes).toEqual([1, 3]) // 只补最后一次，中间的 2 被丢掉
  })

  it("窗口不因窗口内的调用而重置（throttle 不是 debounce）", () => {
    const writes: string[] = []
    const tick = throttle((v: string) => writes.push(v), 100)
    tick.call("a")
    vi.advanceTimersByTime(90)
    tick.call("b") // 距上次调用只隔 90ms：若是 debounce，这里会把窗口推到 190ms
    vi.advanceTimersByTime(10)
    expect(writes).toEqual(["a", "b"])
  })

  it("只调用一次时不产生重复写入", () => {
    const writes: number[] = []
    const tick = throttle((v: number) => writes.push(v), 100)
    tick.call(7)
    vi.advanceTimersByTime(1000)
    expect(writes).toEqual([7])
  })

  it("补写之后的下一个调用又是立即执行", () => {
    const writes: number[] = []
    const tick = throttle((v: number) => writes.push(v), 100)
    tick.call(1)
    vi.advanceTimersByTime(30)
    tick.call(2)
    vi.advanceTimersByTime(70)
    expect(writes).toEqual([1, 2])
    tick.call(3)
    expect(writes).toEqual([1, 2, 3])
  })
})
