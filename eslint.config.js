// @ts-check
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

/**
 * 根级 ESLint flat config。
 * - 对所有 TS 源码启用 typescript-eslint 推荐规则；
 * - 用 eslint-config-prettier 关闭与 Prettier 冲突的格式类规则（格式交予 Prettier）；
 * - 对测试文件放宽 `no-explicit-any`。
 */
export default tseslint.config(
  {
    ignores: [
      // 其他分支的完整副本，主仓库跑 lint 时不该扫进来。
      ".worktrees/**",
      "**/dist/**",
      "**/target/**",
      "**/node_modules/**",
      "**/*.d.ts",
      // 小程序：esbuild 压缩出的单文件包，不可读也无需 lint。
      "apps/miniprogram/miniprogram/lib/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    // §9.5.6：禁止硬编码色值。tokens.css 是全站唯一允许写**主题色**的地方，
    // 因此该规则只作用于 TS/TSX，不碰样式表。
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    ignores: [
      // 色标是存进 pack.json 的**用户数据**，不是主题色，没有语义 token 可对应；
      // 默认色值必须是一个合法的 hex 字面量。
      "apps/desktop/src/features/layers/colors.ts",
      // 测试要断言的正是这些数据值本身（色标数组、图层颜色），豁免不影响
      // 生产代码的保证。
      "apps/desktop/src/**/__tests__/**",
      "apps/desktop/src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}/]",
          message: "禁止硬编码色值（#hex）：请用 Tailwind 语义类或 var(--color-*)",
        },
        {
          selector: "Literal[value=/rgba?\\(/]",
          message: "禁止硬编码色值（rgb/rgba）：请用 Tailwind 语义类或 var(--color-*)",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}|rgba?\\(/]",
          message: "禁止硬编码色值：请用 Tailwind 语义类或 var(--color-*)",
        },
      ],
    },
  },
  {
    // 小程序运行时：wx 与 Page/App/Component 由微信注入，不是 JS 内置。
    // ES 内置（Date/Math/Promise…）由 ecmaVersion 自动带入，无需重复声明。
    files: ["apps/miniprogram/miniprogram/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        wx: "readonly",
        Page: "readonly",
        Component: "readonly",
        App: "readonly",
        Behavior: "readonly",
        getApp: "readonly",
        getCurrentPages: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
  },
  {
    // 构建脚本：Node 的 ESM 环境。
    files: ["apps/miniprogram/scripts/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // 云函数跑在 Node 的 CommonJS 环境。
    files: ["apps/miniprogram/cloudfunctions/**/*.js"],
    // tseslint 的推荐集对全仓生效，CommonJS 的 require 在这里是正常写法。
    rules: { "@typescript-eslint/no-require-imports": "off" },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        exports: "writable",
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    // 仓库级 Node 脚本（发布工具、ffmpeg 下载）：ESM 环境。
    // `fetch` / `URL` 是 Node 18+ 的运行时内置，不在 ecmaVersion 的范围里。
    files: ["tools/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    // 小程序预览脚本：在 apps/miniprogram 下运行，Node 的 ESM 环境。
    files: ["apps/miniprogram/tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  },
)
