/**
 * Tauri 桌面端的 Vite 构建配置。
 *
 * 架构位置：本文件服务于 `apps/desktop` 的前端壳（React），同时被 `tauri dev` /
 * `tauri build` 复用——Tauri 在开发期读取 `devUrl`（固定端口 1420），在构建期
 * 读取 `frontendDist`。此处的 server 选项专为 Tauri 定制：固定端口、忽略
 * `src-tauri` 监听以免 Rust 重编译触发前端热重载。
 */
import { readFileSync } from "node:fs"

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import svgr from "vite-plugin-svgr"

const host = process.env.TAURI_DEV_HOST

// 工程文件清单里的 appVersion 取应用版本，避免再维护一份常量。
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

// https://vite.dev/config/
export default defineConfig(() => ({
  // 构建期注入应用版本（见 `vite-env.d.ts` 的 `__APP_VERSION__`）。
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

  // svgr：把 `import Logo from "./x.svg?react"` 编译成 React 组件。用组件而非 `<img src>` 是
  // 为了让 SVG 内联进 DOM——`<img>` 里的 SVG 自成一体，`fill="currentColor"` 取不到外部的
  // `color`；内联后 logo 才能跟着主题文字色走（见 StartScreen 的 CardbaraLogo）。
  plugins: [react(), svgr()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}))
