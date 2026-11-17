import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // `.worktrees/` 里是同一仓库的其他分支副本，根目录跑测试时不能把它们再算一遍。
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
})
