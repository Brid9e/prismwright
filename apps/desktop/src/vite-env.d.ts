/// <reference types="vite/client" />
// 让 `import Logo from "./x.svg?react"` 有类型：vite-plugin-svgr 把带 `?react` 后缀的 SVG
// 编译成 React 组件，其模块声明由该包提供（插件在 vite.config.ts 里注册）。
/// <reference types="vite-plugin-svgr/client" />

/** 由 vite.config.ts 的 define 注入，来源是 apps/desktop/package.json 的 version。 */
declare const __APP_VERSION__: string
