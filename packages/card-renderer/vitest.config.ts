import { defineConfig } from "vitest/config"

/**
 * 仅承载纯函数单测（palette / mapping / tilt），不涉及 WebGL，
 * 故用 node 环境即可，无需 jsdom / canvas 打桩。
 */
export default defineConfig({
  test: {
    // 递归匹配：v1 与将来的 v2 测试都自动纳入。
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
})
