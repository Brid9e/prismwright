import { defineConfig } from "tsup"

/**
 * 构建配置：产出 ESM 单入口 + 类型声明。
 * 入口名带 `v1/`，产物落 `dist/v1/`——与源码的版本分层一致；将来 v2 平级再加一个入口。
 * three 声明为 external（peerDependency），不打进产物，避免与宿主重复打包。
 */
export default defineConfig({
  entry: { "v1/index": "src/v1/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["three"],
})
