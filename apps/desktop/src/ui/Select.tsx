/**
 * 下拉选择。
 *
 * 用 Radix dropdown-menu 而非原生 `<select>`：原生控件的深色主题在各平台上表现
 * 不一致，而编辑器要求三栏风格统一。
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Check, ChevronDown } from "lucide-react"

/** 一个选项。 */
export interface SelectOption {
  value: string
  /** 展示文本（调用方负责翻译）。 */
  label: string
}

export interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  /** 触发按钮是否撑满容器宽度。 */
  grow?: boolean
}

export function Select({ value, options, onChange, disabled, grow }: SelectProps) {
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        className={`flex h-6 items-center gap-1 rounded-sm border border-border bg-sunken px-1.5 text-[12px] text-foreground outline-none hover:border-border-subtle focus:border-accent disabled:text-disabled ${
          grow ? "min-w-0 flex-1" : ""
        }`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown size={13} className="ml-auto shrink-0 text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-sm border border-border-subtle bg-elevated py-1 shadow-lg"
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => onChange(option.value)}
              className="flex cursor-default items-center gap-2 px-2 py-1 text-[12px] text-foreground outline-none data-[highlighted]:bg-accent/25"
            >
              <Check size={13} className={option.value === value ? "opacity-100" : "opacity-0"} />
              {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
