/**
 * 防抖自动保存订阅者。
 *
 * 架构位置：作为 `packStore` 的一个「旁挂」订阅器存在，不污染 store 本体。
 * store 只负责在 `commit` 时把状态标为 `dirty`；何时、以何种节奏把 `dirty` 落盘
 * 由本模块决定——把「持久化时机」从状态迁移中解耦，既让 store 保持纯粹，
 * 也让「防抖」这一横切关注点可被单独替换/停用（测试、卸载时 `detach`）。
 *
 * 触发条件（三者同时满足才排一次落盘）：
 * 1. `pack` 引用发生变化（数据被替换，而非选中态之类的无关字段变动）；
 * 2. 新的 `pack` 非 `null`（未绑定系列时无盘可写）；
 * 3. 当前 `saveStatus` 为 `dirty`（只有「因编辑而标脏」才自动保存，
 *    避免把 `openPack` 等由 IO 引发的引用替换也误判为需要保存）。
 */
import { usePackStore } from "./packStore"

/** `attachAutosave` 返回的控制句柄。 */
export interface AutosaveHandle {
  detach: () => void
  flush: () => Promise<void>
}

/**
 * 订阅 store，pack 因「标脏」变更后防抖落盘。
 *
 * 每次满足触发条件的变更都会重置计时器，从而把一串连续编辑（如拖动滑杆、
 * 连续输入）合并为窗口结束后的一次写盘，避免频繁 IO。
 *
 * @param debounceMs - 防抖窗口（毫秒），默认 `500`。窗口内无新变更才真正写盘。
 * @returns 控制句柄：
 *   - `detach()`：取消订阅并清掉未触发的计时器（测试 / 组件卸载时调用）；
 *   - `flush()`：取消待触发的计时器并立即落盘（Cmd/Ctrl+S、切换系列前调用）。
 *     无待写内容时为空操作，不会产生多余 IO。
 */
export function attachAutosave(debounceMs = 500): AutosaveHandle {
  let timer: ReturnType<typeof setTimeout> | null = null
  // 是否有「已排期但尚未落盘」的变更。flush 靠它区分「有东西要写」与「干净」，
  // 而不去看 saveStatus——状态机是 save() 的职责，订阅器不该依赖它的细节。
  let pending = false

  // 记录上一次观察到的 pack 引用。zustand 订阅在每次 set 后都会回调，
  // 我们只关心 pack 引用本身是否变化——其它字段（选中态、saveStatus…）的更新
  // 不应触发排盘，否则一次 `set({ saveStatus })` 也会白白重启计时器。
  let lastPack = usePackStore.getState().pack

  const unsubscribe = usePackStore.subscribe((state) => {
    // pack 引用未变：本次 set 与数据变更无关（多为选中态、状态机迁移），直接忽略。
    if (state.pack === lastPack) return
    lastPack = state.pack
    // 系列被清空（如 openPack 失败）：无盘可写。
    if (state.pack === null) return
    // 非 dirty 的引用替换（如 openPack 成功置 saved）不应自动保存。
    if (state.saveStatus !== "dirty") return

    // 重置防抖窗口：清掉上一枚待触发计时器，重新计时。
    if (timer) clearTimeout(timer)
    pending = true
    timer = setTimeout(() => {
      timer = null
      pending = false
      // fire-and-forget：写盘完成/失败由 save() 内部改状态机，订阅器无需 await。
      void usePackStore.getState().save()
    }, debounceMs)
  })

  return {
    detach: () => {
      // 先清计时器，再退订：否则 detach 之后仍可能有一次已排期的写盘。
      if (timer) clearTimeout(timer)
      timer = null
      pending = false
      unsubscribe()
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (!pending) return
      pending = false
      await usePackStore.getState().save()
    },
  }
}
