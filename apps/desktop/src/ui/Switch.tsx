/**
 * 开关：单一功能的启用 / 停用二态切换（光泽、摩尔纹、几何刻纹的启用开关等）。
 *
 * 走 Radix Switch。选开关而非复选框，是因为这些控件表达的是「某块功能是否即时生效」，
 * 开关的形态比打勾更贴合。Radix 的 Root 渲染成 `<button role="switch">`，`:disabled` 对它
 * 有效，故禁用样式直接走 `disabled:` 变体（这点与 Slider 不同——那边是 `<span>`，只能另想办法）。
 */
import * as RadixSwitch from "@radix-ui/react-switch"

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /**
   * 可访问名。开关旁边若没有关联的 `<label>`（编辑器里通常是 `PropertyRow` 左侧那行文字，
   * 它不是 `<label for>`），必须传这个，否则读屏只报得出「开关」而说不出开的是什么。
   */
  ariaLabel?: string
}

export function Switch({ checked, onChange, disabled, ariaLabel }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full border border-border-subtle bg-sunken p-[1px] outline-none transition-colors focus:ring-1 focus:ring-ring data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block h-2.5 w-2.5 translate-x-0 rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-2.5 data-[state=checked]:bg-accent-foreground" />
    </RadixSwitch.Root>
  )
}
