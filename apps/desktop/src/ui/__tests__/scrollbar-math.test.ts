import { describe, it, expect } from "vitest"
import { scrollbarMetrics } from "../scrollbar-math"

const base = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500, trackHeight: 500 }

describe("scrollbarMetrics", () => {
  it("内容不超过视口时不显示", () => {
    expect(scrollbarMetrics({ ...base, scrollHeight: 500 })).toEqual({
      visible: false,
      thumbHeight: 0,
      thumbTop: 0,
    })
  })

  it("滑块按比例缩短，最小 24px", () => {
    expect(scrollbarMetrics(base).thumbHeight).toBe(250)
    expect(scrollbarMetrics({ ...base, scrollHeight: 100000 }).thumbHeight).toBe(24)
  })

  it("滑块位置随滚动进度落在轨道内", () => {
    expect(scrollbarMetrics(base).thumbTop).toBe(0)
    expect(scrollbarMetrics({ ...base, scrollTop: 250 }).thumbTop).toBe(125)
    const bottom = scrollbarMetrics({ ...base, scrollTop: 500 })
    expect(bottom.thumbTop).toBe(250)
    expect(bottom.thumbTop + bottom.thumbHeight).toBeLessThanOrEqual(500)
  })

  it("越界滚动与 NaN 不会产出 NaN 样式", () => {
    expect(scrollbarMetrics({ ...base, scrollTop: 99999 }).thumbTop).toBe(250)
    expect(scrollbarMetrics({ ...base, scrollTop: -9999 }).thumbTop).toBe(0)
    expect(scrollbarMetrics({ ...base, scrollTop: Number.NaN }).visible).toBe(false)
    expect(scrollbarMetrics({ ...base, trackHeight: 0 }).visible).toBe(false)
  })
})
