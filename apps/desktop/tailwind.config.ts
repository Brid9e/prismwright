import type { Config } from "tailwindcss"

/** 把「通道三元组」CSS 变量映射为可带透明度的颜色：`bg-panel/60` 之类才会生效。 */
const token = (name: string): string => `rgb(var(${name}) / <alpha-value>)`

/**
 * 设计刻度的唯一出口。
 *
 * 组件只允许消费这里的语义类（`h-control`、`rounded-card`、`text-label`……），
 * 不允许再写 `h-[26px]` 这类任意值——任意值会把「同一控件两种尺寸」重新引进代码，
 * 而这正是本轮 UI 重置要消灭的问题。刻度定义见
 * docs/superpowers/specs/2026-11-28-editor-ui-control-system-design.md §5。
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // 圆角覆盖默认刻度：只留设计规范里的五档。旧代码里的 `rounded-sm/md/lg` 会因此
    // 失去圆角（而不是悄悄换成另一档），由样式守卫测试逐处暴露后改为语义类。
    borderRadius: {
      none: "0",
      DEFAULT: "0",
      chip: "4px",
      control: "7px",
      card: "10px",
      panel: "14px",
      full: "9999px",
    },
    extend: {
      colors: {
        app: token("--color-surface-app"),
        panel: token("--color-surface-panel"),
        elevated: token("--color-surface-elevated"),
        sunken: token("--color-surface-sunken"),
        track: {
          DEFAULT: token("--color-track"),
          fill: token("--color-track-fill"),
        },
        line: {
          DEFAULT: token("--color-line"),
          soft: token("--color-line-soft"),
        },
        foreground: token("--color-text"),
        muted: token("--color-text-muted"),
        disabled: token("--color-text-disabled"),
        accent: {
          DEFAULT: token("--color-accent"),
          hover: token("--color-accent-hover"),
          active: token("--color-accent-active"),
          soft: token("--color-accent-soft"),
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
      height: {
        control: "24px",
        button: "28px",
        row: "32px",
        panelhead: "40px",
        topbar: "46px",
        switch: "17px",
        // 卡片库缩略图（约 5:7 的卡面比例）。
        thumb: "42px",
      },
      width: {
        switch: "30px",
        // 属性行的固定标签列宽。
        label: "60px",
        // Windows 自绘窗口按钮的宽度（原生 Fluent 度量）。
        window: "46px",
        thumb: "30px",
      },
      fontSize: {
        num: ["10px", { lineHeight: "12px" }],
        label: ["11px", { lineHeight: "16px" }],
        body: ["12px", { lineHeight: "16px" }],
        title: ["13px", { lineHeight: "16px" }],
        cardname: ["17px", { lineHeight: "22px" }],
      },
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
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
        // 品牌展示字体，只用于固定拉丁字标（如起始屏与标题栏的 Prismwright）。
        // 不再随包分发第三方字体，直接用系统 UI 字体，避免任何字体授权问题。
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
    },
  },
} satisfies Config
