/**
 * 标题栏右侧的窗口按钮（最小化 / 最大化-还原 / 关闭）。
 *
 * 只在有 Tauri 环境时渲染：`dev:web` 里没有窗口可管，按钮点了也是空响。
 *
 * **关闭键走 `close()` 而不是 `destroy()`**：`close()` 会发出 close-requested 事件，
 * `App.tsx` 的处理器借此先把未落盘的编辑冲刷掉再关窗；`destroy()` 是强拆，
 * 会绕过那道flush、丢掉最后一次防抖窗口里的写入。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { getCurrentWindow } from "@tauri-apps/api/window"

/** 无 Tauri 环境（`dev:web`）时所有调用静默降级。 */
function win() {
  return getCurrentWindow()
}

/**
 * 窗口按钮的字形——照 Windows 11 的原生度量自己画，**不用图标库**。
 *
 * 原生（Fluent）三个字形都落在同一个 10×10 的方框里、统一 1px 描边：最小化是 10×1 的横杠、
 * 最大化是 10×10 的方框、关闭是 10×10 的叉。图标库对不上——lucide 三个图标各自的留白不同
 * （Minus 占 14/24、Square 18/24、X 只有 12/24），一个 size 没法让三者都落进 10×10；描边也
 * 只有 2px 一档。实测下来：关闭叉只有 8×8、最小化却粗到 2px——正是「跟原生摆一起显得小一圈、
 * 粗细也不齐」的由来。
 *
 * 坐标取**半整数**（0.5 / 5.5 / 9.5）：1× DPI 下落在一整像素上，才画得出原生那种锐利细线；
 * 落在整数上会被掰成两行半像素，糊成 2px。字形随按钮的 `text-muted` 取色（`currentColor`）。
 */
const GLYPH_PROPS = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  "aria-hidden": true,
} as const

/** 最小化：10×1 的横杠。 */
function GlyphMinimize() {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M0 5.5h10" />
    </svg>
  )
}

/** 最大化：10×10 的方框。 */
function GlyphMaximize() {
  return (
    <svg {...GLYPH_PROPS}>
      <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
    </svg>
  )
}

/** 还原（已最大化）：前排 8×8 方框 + 后排露出的顶边与右边。 */
function GlyphRestore() {
  return (
    <svg {...GLYPH_PROPS}>
      <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M2.5 0.5H9.5V7.5" />
    </svg>
  )
}

/** 关闭：10×10 的叉。 */
function GlyphClose() {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M0.5 0.5 9.5 9.5M9.5 0.5 0.5 9.5" />
    </svg>
  )
}

/** 窗口按钮组。 */
export function WindowControls() {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)

  // 最大化态只用于换图标与提示文案。用窗口 resize 事件跟踪而不订阅 Tauri 事件：
  // 最大化/还原/拖边框都会触发 resize，且这条路径在浏览器里也不会报错。
  useEffect(() => {
    let alive = true
    const sync = () => {
      try {
        void win()
          .isMaximized()
          .then((v) => {
            if (alive) setMaximized(v)
          })
          .catch(() => {})
      } catch {
        // 无 Tauri：保持未最大化，不影响编辑。
      }
    }
    sync()
    window.addEventListener("resize", sync)
    return () => {
      alive = false
      window.removeEventListener("resize", sync)
    }
  }, [])

  /** 每个按钮：图标 + 提示 + 动作；动作里的异常一律吞掉（窗口管理失败不该冒泡白屏）。 */
  const buttons = [
    {
      key: "minimize",
      label: t("common:window.minimize"),
      icon: <GlyphMinimize />,
      run: () => win().minimize(),
    },
    {
      key: "maximize",
      label: t(maximized ? "common:window.restore" : "common:window.maximize"),
      icon: maximized ? <GlyphRestore /> : <GlyphMaximize />,
      run: () => win().toggleMaximize(),
    },
    {
      key: "close",
      label: t("common:window.close"),
      icon: <GlyphClose />,
      run: () => win().close(),
    },
  ]

  return (
    <div className="flex h-full">
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          title={b.label}
          aria-label={b.label}
          onClick={() => {
            try {
              void b.run().catch(() => {})
            } catch {
              // 无 Tauri：静默降级。
            }
          }}
          className={`flex w-window items-center justify-center text-muted ${
            b.key === "close"
              ? "hover:bg-danger hover:text-white"
              : "hover:bg-elevated hover:text-foreground"
          }`}
        >
          {b.icon}
        </button>
      ))}
    </div>
  )
}
