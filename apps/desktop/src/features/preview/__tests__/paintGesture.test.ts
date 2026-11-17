/**
 * 擦除画笔的手势记账：什么时候记撤销快照、上一笔落到哪。
 *
 * 这里钉的是一个真实发生过的问题：撤销按钮只在「按下的那一点落在卡面上」时才点亮。
 * 用户从卡外起笔、拖进卡面才落墨——画面确实被擦了，可这一笔从没记过快照，左箭头
 * 一直是灰的。快照必须挂在**第一次落墨**上，而不是按下上。
 */
import { describe, it, expect } from "vitest"
import {
  IDLE_GESTURE,
  inkTo,
  startGesture,
  takeSnapshot,
  type PaintGesture,
} from "../paintGesture"

describe("startGesture", () => {
  it("按下即开始一笔，记住落点与是不是恢复笔", () => {
    expect(startGesture(true, { x: 10, y: 20 })).toEqual({
      drawing: true,
      last: { x: 10, y: 20 },
      restore: true,
      snapshotted: false,
    })
  })

  it("按在卡面之外（落点为 null）也进入按下态，只是还没落墨", () => {
    const gesture = startGesture(false, null)
    expect(gesture.drawing).toBe(true)
    expect(gesture.last).toBeNull()
    expect(gesture.snapshotted).toBe(false)
  })
})

describe("takeSnapshot", () => {
  it("按下就落在卡面上：落墨前记快照", () => {
    const step = takeSnapshot(startGesture(false, { x: 5, y: 5 }))
    expect(step.snapshot).toBe(true)
    expect(step.gesture.snapshotted).toBe(true)
  })

  // 回归：起笔在卡外、拖进卡面才落墨——这一笔同样要记快照，否则撤销按钮点不亮。
  it("起笔在卡外、拖进卡面：第一次落墨时补记快照", () => {
    const step = takeSnapshot(startGesture(false, null))
    expect(step.snapshot).toBe(true)
  })

  it("同一笔里只记一次：后续落墨不再记快照", () => {
    const first = takeSnapshot(startGesture(false, { x: 1, y: 1 }))
    const second = takeSnapshot(first.gesture)
    expect(second.snapshot).toBe(false)
    expect(second.gesture).toBe(first.gesture)
  })

  it("没按下时不记快照（移动事件不该凭空造出一格历史）", () => {
    const step = takeSnapshot(IDLE_GESTURE)
    expect(step.snapshot).toBe(false)
    expect(step.gesture).toBe(IDLE_GESTURE)
  })
})

describe("inkTo", () => {
  it("返回这一段的起点，并把上一落点推进到新位置", () => {
    const gesture = startGesture(false, { x: 1, y: 2 })
    const step = inkTo(gesture, { x: 3, y: 4 })
    expect(step.from).toEqual({ x: 1, y: 2 })
    expect(step.gesture.last).toEqual({ x: 3, y: 4 })
    expect(step.gesture.snapshotted).toBe(gesture.snapshotted)
  })

  it("第一次落墨没有起点（只点一个圆点）", () => {
    const step = inkTo(startGesture(false, null), { x: 7, y: 8 })
    expect(step.from).toBeNull()
    expect(step.gesture.last).toEqual({ x: 7, y: 8 })
  })
})

describe("长手势", () => {
  it("起笔在卡外 → 拖进卡面 → 继续拖动：整笔只有一格快照", () => {
    let gesture: PaintGesture = startGesture(false, null)
    const points = [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ]
    const snapshots: boolean[] = []
    for (const point of points) {
      const snap = takeSnapshot(gesture)
      snapshots.push(snap.snapshot)
      gesture = inkTo(snap.gesture, point).gesture
    }
    expect(snapshots).toEqual([true, false, false])
  })
})
