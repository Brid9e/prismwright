// postcss-import 必须排在 tailwindcss 之前：base.css 顶部的 `@import './tokens.css'`
// 要先被内联，Tailwind 的指令才会作用在完整的样式表上。
export default {
  plugins: {
    "postcss-import": {},
    tailwindcss: {},
    autoprefixer: {},
  },
}
