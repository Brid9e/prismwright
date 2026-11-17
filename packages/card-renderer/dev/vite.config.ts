import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/**
 * harness 专用 Vite 配置：以 dev/ 为根，只服务验收页；three 走 devDependency。
 *
 * 根目录取自本文件的 ESM URL（而非 `__dirname`），以适配 Vite 原生配置加载器——
 * 后者不支持 CJS 的 `__dirname`。
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 5199, open: "/harness.html" },
})
