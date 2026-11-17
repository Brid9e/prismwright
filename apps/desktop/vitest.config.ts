/**
 * 桌面端单元测试的 Vitest 配置。
 *
 * 架构位置：与 `vite.config.ts` 并列，专供 `pnpm -F cardbara test` 使用。
 * 这里刻意与 Vite 主线配置分离——测试只跑纯逻辑（store / 数据层）与少量
 * `react-dom/server` 冒烟渲染，不需要 React 插件、Tauri 端口约束等构建期能力。
 *
 * 关键选择：
 * - `environment: "node"`：被测对象是不依赖 DOM 的状态层，node 环境更轻更快；
 * - `include`：仅收集 `src` 下的 `*.test.ts`，避免误跑 `src-tauri` 或产物目录；
 * - `svgr()`：`TitleBar` 会内联品牌 logo（`import Logo from "x.svg?react"`）。
 *   少了它该 import 只得到资源路径字符串，SSR 一渲染 logo 就抛 "Invalid tag"。
 */
import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"
import svgr from "vite-plugin-svgr"

// 与 `vite.config.ts` 同源同值：`__APP_VERSION__` 由 Vite 的 `define` 注入，测试配置
// 是独立的文件、不继承主配置，这里必须再注入一次，否则引用它的模块在测试里报
// "is not defined"。
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

export default defineConfig({
  plugins: [svgr()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
