/**
 * 颜色控件：系统取色块 + 透明度滑杆 + 百分比。
 *
 * 透明度存在色值本身里（`#rrggbbaa`，见 `@cardbara/schema` 的 `withAlpha` / `alphaOf`），
 * 而不是另开一个字段——这样渲染器、落盘格式与旧数据都不需要「透明颜色」的特例：不透明色仍然
 * 序列化成 6 位。取色块只认 6 位，故绑值时先过 `toSixDigitHex` 去掉透明度；滑杆按全色值合成。
 *
 * 色值未设置时（例如光泽条目的颜色为空 = 沿用老的暖白常量），滑杆禁用：凑一个 8 位色值出来
 * 会把缺省从「暖白常量」变成白纸黑字的一个值，等于静默改了存量卡的颜色。
 */
import { useTranslation } from "react-i18next"
import { alphaOf, withAlpha } from "@cardbara/schema"
import { toSixDigitHex } from "../features/layers/colors"

export interface ColorFieldProps {
  /** 当前色值（`#rrggbb` 或 `#rrggbbaa`）；空串 = 未设置。 */
  value: string
  onChange: (hex: string) => void
  /** 可访问名（所在字段的文案）。 */
  ariaLabel: string
  /** 色块尺寸：效果栈 / 卡面面板用 `sm`，文字面板用 `md`。 */
  size?: "sm" | "md"
}

export function ColorField({ value, onChange, ariaLabel, size = "sm" }: ColorFieldProps) {
  const { t } = useTranslation("common")
  const alpha = alphaOf(value)
  const swatch = size === "md" ? "h-6 w-10" : "h-5 w-8"
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={toSixDigitHex(value)}
        aria-label={ariaLabel}
        onChange={(e) => onChange(withAlpha(e.target.value, alpha))}
        className={`${swatch} cursor-pointer rounded-sm border border-border bg-sunken p-0`}
      />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={alpha}
        disabled={value === ""}
        aria-label={t("colorAlpha", { label: ariaLabel })}
        onChange={(e) => onChange(withAlpha(value, Number(e.target.value)))}
        className="w-16 accent-accent disabled:opacity-40"
      />
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted">
        {Math.round(alpha * 100)}%
      </span>
    </div>
  )
}
