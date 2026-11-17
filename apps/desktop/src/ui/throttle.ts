/**
 * 尾沿节流：窗口内最多执行一次，并保证窗口末尾补上**最后一次**的参数。
 *
 * 抽出来的原因：本阶段没有组件级 DOM 测试（仓库约定），时间相关的分支——首沿立即执行、
 * 窗口不因窗口内的调用而重置、尾沿补写最后一次、没有挂起值时不补写——留在组件里就只能
 * 靠肉眼验证。与 `number-field.ts` 同一套路：规则做成纯函数，组件只负责接线。
 *
 * 「不是 debounce」是这个模块存在的理由：debounce 要等到**安静期**才执行，用在拖取色板上
 * 就是拖的过程中一次都不写——正好把「实时预览」拖没了。这里的窗口自首沿起算，拖动期间照样
 * 稳定地往外写。
 */

/** 节流句柄。 */
export interface Throttle<A extends unknown[]> {
  /** 记一次调用：窗口已过则立即执行，否则挂起（窗口内只留最后一次的参数）。 */
  call(...args: A): void
}

/**
 * @param run - 被节流的函数。
 * @param intervalMs - 节流窗口（毫秒），自**上一次执行的起点**计算。
 */
export function throttle<A extends unknown[]>(
  run: (...args: A) => void,
  intervalMs: number,
): Throttle<A> {
  // 只在窗口内有过调用时才非 null。补写之后**不**重开计时器：下一个调用回到首沿路径，
  // 于是「只调一次」不会在窗口末尾变成同一参数的第二次执行。
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  return {
    call(...args) {
      if (timer !== null) {
        pending = args
        return
      }
      run(...args)
      timer = setTimeout(() => {
        timer = null
        const last = pending
        pending = null
        if (last) run(...last)
      }, intervalMs)
    },
  }
}
