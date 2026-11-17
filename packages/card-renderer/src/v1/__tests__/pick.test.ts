/**
 * 拾色换算：客户端坐标 → NDC。
 *
 * 这一步是吸管能「点到哪取哪」的全部数学（余下只是 raycast）。轴向写反 / 少乘 2 的症状是
 * 「吸到的颜色整体镜像或只取到左上四分之一」，而着色器与材质都正常，很难往这里归因。
 */
import { describe, it, expect } from "vitest"
import { clientToNdc, ndcToClient } from "../pick"

const rect = { left: 100, top: 50, width: 200, height: 400 }

describe("clientToNdc", () => {
  it("画布中心映射到原点", () => {
    expect(clientToNdc(200, 250, rect)).toEqual({ x: 0, y: 0 })
  })

  it("左上角映射到 (-1, +1)，右下角映射到 (+1, -1)", () => {
    expect(clientToNdc(100, 50, rect)).toEqual({ x: -1, y: 1 })
    expect(clientToNdc(300, 450, rect)).toEqual({ x: 1, y: -1 })
  })

  it("尺寸非正时返回 null（还没布局好，别算出 NaN 去 raycast）", () => {
    expect(clientToNdc(0, 0, { left: 0, top: 0, width: 0, height: 400 })).toBeNull()
    expect(clientToNdc(0, 0, { left: 0, top: 0, width: 200, height: 0 })).toBeNull()
    expect(clientToNdc(0, 0, { left: 0, top: 0, width: NaN, height: 400 })).toBeNull()
  })
})

/**
 * 反向换算：NDC → 客户端坐标。
 *
 * 消费方是预览里的画笔范围圈：把卡面 UV 的两端点投到屏幕上量出「画布像素 → 屏幕像素」的
 * 比例，圈才跟得上缩放与倾斜。轴向写反的症状是圈跟着鼠标走但大小差一个方向，很难归因。
 */
describe("ndcToClient", () => {
  it("原点映射回画布中心", () => {
    expect(ndcToClient({ x: 0, y: 0 }, rect)).toEqual({ x: 200, y: 250 })
  })

  it("与 clientToNdc 互为逆运算（四角往返）", () => {
    const corners = [
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 100, y: 450 },
      { x: 300, y: 450 },
    ]
    for (const client of corners) {
      const ndc = clientToNdc(client.x, client.y, rect)!
      const back = ndcToClient(ndc, rect)!
      expect(back.x).toBeCloseTo(client.x)
      expect(back.y).toBeCloseTo(client.y)
    }
  })

  it("尺寸非正时返回 null（与正向同一道防线）", () => {
    expect(ndcToClient({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 400 })).toBeNull()
    expect(ndcToClient({ x: 0, y: 0 }, { left: 0, top: 0, width: 200, height: NaN })).toBeNull()
  })
})
