/**
 * 运行环境判定：跑在哪个平台、有没有桌面壳。
 *
 * 用途只有一个——决定标题栏与菜单长什么样：
 * - Windows：自绘标题栏（菜单搬进标题栏，见 `features/titlebar/`），不装原生菜单；
 * - macOS：自绘标题栏（窗口 `titleBarStyle: "Overlay"`，保留原生交通灯），菜单仍在屏幕顶部原生菜单栏；
 * - 其余（Linux 等）：系统标题栏 + 原生菜单。
 *
 * 因此「画不画自绘标题栏」与「用不用原生菜单」是**两件独立的事**——Windows 自绘且无原生菜单，
 * macOS 自绘**但**有原生菜单。二者分别由 {@link usesHtmlTitleBar} 与 {@link usesNativeMenu} 给出，
 * 调用方各取所需，不共用同一个布尔。
 *
 * 为什么按 UA 判定而不是引入 `@tauri-apps/plugin-os`：`dev:web` 在纯浏览器里跑，
 * 那里根本没有 Tauri 环境，而标题栏的取舍在两种环境下必须一致（否则开发时看到的
 * 和用户看到的是两套东西）。WebView2 的 UA 与 Windows 浏览器一致，都含 `Windows`。
 */

/** 平台：只需区分 Windows / macOS / 其余。 */
export type Platform = "windows" | "macos" | "other"

/**
 * 由 UA 判定平台。
 *
 * macOS 匹配 `Macintosh` 而**非** `Mac OS X`：后者在 iOS 的 UA 里也出现（`like Mac OS X`），
 * 拿它匹配会把 iPhone / iPad 误判成 macOS。桌面 macOS 的 UA 稳定含 `Macintosh; Intel Mac OS X`。
 *
 * @param userAgent - `navigator.userAgent`。
 * @returns 平台。
 */
export function detectPlatform(userAgent: string): Platform {
  if (/Windows/i.test(userAgent)) return "windows"
  if (/Macintosh/i.test(userAgent)) return "macos"
  return "other"
}

/**
 * 是否使用窗口内**自绘标题栏**。
 *
 * Windows 与 macOS 为真。差别在左侧：Windows 放菜单条，macOS 给原生交通灯让位
 * （见 `features/titlebar/TitleBar.tsx`）。
 *
 * @param platform - {@link detectPlatform} 的结果。
 * @returns 需要自绘标题栏时为真。
 */
export function usesHtmlTitleBar(platform: Platform): boolean {
  return platform === "windows" || platform === "macos"
}

/**
 * 是否使用**原生菜单**（系统菜单栏 / 系统按键）。
 *
 * macOS 与「其余」为真（macOS 菜单栏在屏幕顶部、Linux 用系统菜单），Windows 为假（菜单画
 * 在自绘标题栏里）。快捷键随之分流：原生菜单的平台由系统处理按键，自绘的平台由
 * `shortcuts.ts` 接（见其文件头）。
 *
 * @param platform - {@link detectPlatform} 的结果。
 * @returns 需要原生菜单时为真。
 */
export function usesNativeMenu(platform: Platform): boolean {
  return platform !== "windows"
}

/**
 * 桌面壳（Tauri）是否在场。
 *
 * Tauri 的核心脚本会在窗口上挂 `__TAURI_INTERNALS__`；`dev:web` 的纯浏览器里没有，
 * 此时窗口按钮（最小化/最大化/关闭）无处可发、交通灯让位也无意义，界面上要相应变化。
 *
 * @param target - 待检查的全局对象，默认 `globalThis`（测试可传普通对象）。
 * @returns 有 Tauri 环境时为真。
 */
export function hasTauriEnv(target: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in target
}
