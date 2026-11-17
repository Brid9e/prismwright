/**
 * 释放 `WebGLRenderer`，并兜住 three 在小程序里的一个空指针。
 *
 * three 的 `WebGLRenderer.dispose()` 末尾会调 `WebGLAnimation.stop()`，而动画上下文取自
 * 全局 `self`（`if (typeof self !== 'undefined') animation.setContext(self)`）：小程序没有
 * `self`，上下文停在 `null`，于是 stop 里那句 `context.cancelAnimationFrame(id)` 直接抛
 * `TypeError: null is not an object (evaluating 'e.cancelAnimationFrame')`（真机已踩）。
 *
 * 我们从不用 `setAnimationLoop`，那次 stop 除了这个空转没有别的作用；渲染器自己的 GL 资源
 * 在抛错之前已经释放完（dispose 里 animation.stop() 是最后一行），所以只吞掉这一个异常。
 * 不让它扩散尤其重要：调用方（组件的 detached、探针的阶段切换）正在拆页面，抛出去会让
 * 后续清理与重建全部中断——真机上表现为画面卡死。
 *
 * @param renderer - 任何带 `dispose()` 的渲染器；类型放宽到结构，便于单测替身。
 */
export function disposeRenderer(renderer: { dispose(): void }): void {
  try {
    renderer.dispose()
  } catch {
    // 见上：小程序缺 `self` 时 three 的动画上下文为 null，此处已无可释放之物。
  }
}
