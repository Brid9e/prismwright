/**
 * 单色控件：色块 + 十六进制文本，点开面板内取色器。
 *
 * 透明度已经收进取色器（`#rrggbbaa`），行内不再单独放滑杆与百分比，
 * 窄检查器里只占内容宽度。所有颜色字段共用同一个 `ColorPicker`。
 */
import { ColorPicker } from "./ColorPicker"

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
  return (
    <ColorPicker
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      size={size}
      showHex
    />
  )
}
