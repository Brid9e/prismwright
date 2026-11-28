/**
 * 颜色控件：系统取色块 + 透明度滑杆 + 百分比。
 *
 * 透明度存在色值本身里（`#rrggbbaa`，见 `@prismwright/schema` 的 `withAlpha` / `alphaOf`），
 * 而不是另开一个字段——这样渲染器、落盘格式与旧数据都不需要「透明颜色」的特例：不透明色仍然
 * 序列化成 6 位。取色块只认 6 位，故绑值时先过 `toSixDigitHex` 去掉透明度；滑杆按全色值合成。
 *
 * 色值未设置时（例如光泽条目的颜色为空 = 沿用老的暖白常量），滑杆禁用：凑一个 8 位色值出来
 * 会把缺省从「暖白常量」变成白纸黑字的一个值，等于静默改了存量卡的颜色。
 */
import { useTranslation } from "react-i18next"
import * as RadixSlider from "@radix-ui/react-slider"
import { alphaOf, withAlpha } from "@prismwright/schema"
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
  const swatch = size === "md" ? "h-5 w-8" : "h-4 w-6"
  return (
    <div className="flex h-button items-center gap-1.5 rounded-control border border-line-soft bg-sunken px-1.5">
      <input
        type="color"
        value={toSixDigitHex(value)}
        aria-label={ariaLabel}
        onChange={(e) => onChange(withAlpha(e.target.value, alpha))}
        className={`${swatch} shrink-0 cursor-pointer rounded-chip border border-line-soft bg-transparent p-0`}
      />
      {/* 透明度用与滑杆同款的细轨 Radix 滑杆：原生 range 的 accent-color 在各平台
          粗细与手柄形状都不一致，会破坏控件系统的一致性。 */}
      <RadixSlider.Root
        value={[alpha]}
        min={0}
        max={1}
        step={0.01}
        disabled={value === ""}
        aria-label={t("colorAlpha", { label: ariaLabel })}
        onValueChange={([a]) => onChange(withAlpha(value, a))}
        className="relative flex h-4 min-w-0 flex-1 touch-none select-none items-center disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RadixSlider.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-track">
          <RadixSlider.Range className="absolute h-full bg-track-fill" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block h-3 w-1.5 rounded-chip bg-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
      </RadixSlider.Root>
      <span className="w-7 shrink-0 text-right text-num tabular-nums text-muted">
        {Math.round(alpha * 100)}%
      </span>
    </div>
  )
}
