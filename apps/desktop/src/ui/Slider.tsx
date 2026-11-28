/**
 * 滑块 + 数字框的组合控件。
 *
 * 两者绑同一个值：滑块适合粗调、数字框适合精确定值，编辑器里两者都要。
 * 拖动过程中每次变更都会向上抛（由 store 的合并键收敛成一步历史）。
 *
 * 少数参数（如卡面宽高比）改动代价大——要重建渲染视图，不能每帧跟着滑杆重来。
 * 这类参数传 `onCommit`：拖动期间只走 `onChange`（调用方自己暂存草稿），
 * 松手或数字框提交时才走 `onCommit` 落到数据上。
 */
import * as RadixSlider from "@radix-ui/react-slider"
import { RotateCcw } from "lucide-react"
import { NumberField } from "./NumberField"
import { IconButton } from "./IconButton"

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  /**
   * 定稿回调：滑杆松手 / 键盘微调结束、数字框失焦或回车、点击复位时触发。
   *
   * 提供它时，调用方应把重活放在这里，而 `onChange` 只暂存草稿。
   * 不提供则行为与单一 `onChange` 完全一致。
   */
  onCommit?: (value: number) => void
  min: number
  max: number
  step?: number
  /** 数字框显示的小数位。 */
  precision?: number
  /**
   * 可访问名。滑杆旁边若没有关联的 `<label>`（例如预览的缩放滑杆），必须传这个，
   * 否则读屏只报得出「滑块」而说不出调的是什么。
   */
  ariaLabel?: string
  disabled?: boolean
  /**
   * 默认值。提供时数字框右侧出现复位图标；点击即 `onChange(defaultValue)`。
   *
   * 不提供则完全不渲染图标——导出 / 预览这类「不是数据参数」的滑杆不受影响。
   */
  defaultValue?: number
  /**
   * 复位图标的可访问名 / Tooltip 文案（由调用方按所在命名空间翻译）。
   * 仅在提供 `defaultValue` 时有意义。
   */
  resetLabel?: string
}

export function Slider({
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 0.01,
  precision = 3,
  ariaLabel,
  disabled,
  defaultValue,
  resetLabel,
}: SliderProps) {
  /** 数字框与复位本身就是「定稿」动作：两个回调一起走。 */
  function commit(value: number) {
    onChange(value)
    onCommit?.(value)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <RadixSlider.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit?.(v)}
        // 禁用态靠整条 Root 降透明度 + 禁止光标体现。Radix 把 Track / Range / Thumb 都渲染成
        // `<span>`，`:disabled` 伪类对它们无效（`disabled:` 变体会失配、形同虚设），故这两样都提到
        // Root 一层统一处理。
        className={`relative flex h-control min-w-0 flex-1 touch-none select-none items-center ${
          disabled ? "cursor-not-allowed opacity-40" : ""
        }`}
      >
        {/* 扁平厚圆角矩形轨道：与数字框同高（24）同圆角（7）；已滑过部分用实心 track-fill，
            与未滑过的中性灰底形成明确区分。overflow-hidden 让填充在左端随轨道圆角收口。 */}
        <RadixSlider.Track className="relative h-control w-full grow overflow-hidden rounded-control bg-track">
          {/* 已滑过区域本身不圆角：左端由轨道 overflow-hidden 收口，右端保持直边贴着拇指。 */}
          <RadixSlider.Range className="absolute h-full bg-track-fill" />
        </RadixSlider.Track>
        {/* 竖向圆角矩形手柄（8×24），与轨道同高、无投影。 */}
        <RadixSlider.Thumb className="block h-control w-2 rounded-chip bg-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
      </RadixSlider.Root>
      <NumberField
        value={value}
        onChange={onCommit ? commit : onChange}
        min={min}
        max={max}
        step={step}
        precision={precision}
        disabled={disabled}
      />
      {defaultValue !== undefined && (
        // 等值时置灰（点击无效）。IconButton 本身就是固定的 h-5 w-5 槽位，
        // 其出现与否只由 defaultValue 决定，所以滑杆布局不会因状态变化抖动。
        <IconButton
          icon={RotateCcw}
          label={resetLabel ?? ""}
          disabled={disabled || value === defaultValue}
          onClick={() => commit(defaultValue)}
        />
      )}
    </div>
  )
}
