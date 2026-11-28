/**
 * 数字输入框。
 *
 * 关键行为：**编辑期间不回写**。用户输入 "0." 或清空时中间态不是合法数字，
 * 若每敲一个键就 onChange，滑杆/历史栈会被中间态污染；因此只在失焦或回车时提交，
 * 并用本地 state 承载输入过程中的文本。
 *
 * 判定规则（格式化、是否提交、夹取）抽在 `numberField.ts` 里，组件只负责渲染与受控同步。
 */
import { useEffect, useState } from "react"
import { formatNumber, resolveNumberInput } from "./number-field"

export interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** 显示时保留的小数位；提交时不做四舍五入。 */
  precision?: number
  disabled?: boolean
  /** 可访问名（输入框旁边没有可见文字标签时使用）。 */
  ariaLabel?: string
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  precision = 3,
  disabled,
  ariaLabel,
}: NumberFieldProps) {
  const [text, setText] = useState(() => formatNumber(value, precision))

  // 外部值变化（如撤销、切换图层）时同步显示——但仅在未聚焦时，
  // 否则会把用户正在输入的内容冲掉。
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(formatNumber(value, precision))
  }, [value, focused, precision])

  function commit() {
    const { display, value: next } = resolveNumberInput(text, value, { min, max, precision })
    setText(display)
    if (next !== null) onChange(next)
  }

  // 数字框 56px 而不是更窄：精度 3 的负值（如 `-0.196`）在 44px 里会从左侧裁掉负号，
  // 用户读到的方向就是反的；宁可少 12px 滑轨宽度。
  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
      className="h-control w-14 shrink-0 rounded-control border border-line-soft bg-sunken px-1.5 text-right font-mono text-num text-foreground outline-none hover:border-line focus:border-accent disabled:cursor-not-allowed disabled:text-disabled"
    />
  )
}
