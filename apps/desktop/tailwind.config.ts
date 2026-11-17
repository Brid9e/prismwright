import type { Config } from "tailwindcss"

/** 把「通道三元组」CSS 变量映射为可带透明度的颜色：`bg-panel/60` 之类才会生效。 */
const token = (name: string): string => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: token("--color-surface-app"),
        panel: token("--color-surface-panel"),
        elevated: token("--color-surface-elevated"),
        sunken: token("--color-surface-sunken"),
        foreground: token("--color-text"),
        muted: token("--color-text-muted"),
        disabled: token("--color-text-disabled"),
        accent: {
          DEFAULT: token("--color-accent"),
          hover: token("--color-accent-hover"),
          active: token("--color-accent-active"),
          foreground: token("--color-text-on-accent"),
        },
        border: {
          DEFAULT: token("--color-border"),
          strong: token("--color-border-strong"),
          subtle: token("--color-border-subtle"),
        },
        ring: token("--color-focus"),
        success: token("--color-success"),
        warning: token("--color-warning"),
        danger: token("--color-danger"),
        rarity: {
          common: token("--color-rarity-common"),
          rare: token("--color-rarity-rare"),
          epic: token("--color-rarity-epic"),
          legendary: token("--color-rarity-legendary"),
        },
        scrim: token("--color-scrim"),
      },
      borderRadius: { sm: "2px", DEFAULT: "3px", md: "4px" },
      keyframes: {
        /**
         * 不确定进度：整条色带自左向右扫过再回卷，对齐 Element Plus 的 `indeterminate`。
         *
         * 用 `translateX` 而非 `left`，位移走合成层、不触发重排。`ease-in-out` 让色带在两端
         * （正好被 `overflow-hidden` 裁在轨道外）稍作停顿，于是读数上像「一条条」依次掠过，
         * 而非匀速倒退。起止都在轨道可视范围之外，故循环衔接处不可见。
         */
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
        // 品牌展示字体，只用于固定拉丁字标（如起始屏与标题栏的 Cardbara）。
        // 不再随包分发第三方字体，直接用系统 UI 字体，避免任何字体授权问题。
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
    },
  },
} satisfies Config
