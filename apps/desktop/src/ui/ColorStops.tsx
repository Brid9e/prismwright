/**
 * 渐变色板编辑器：一行一个颜色 + 顶部只读预览带。
 *
 * 交互按「一个一个加颜色」设计：
 * - 拖把手排序（颜色换到别的行，百分比留在原来的行上）；
 * - 每行一个看得见的系统取色块，点了就地弹出取色板；
 * - 每行一个吸管按钮（放在控件外面，与其它颜色字段一致），从画面拾取颜色；
 * - 百分比输入的是**色标位置**（这个颜色停在色带的百分之几处，与 CSS 渐变一致），
 *   改一行只改这一行，其它行的数字原样不动；
 * - 透明度仍存在色值本身里（`#rrggbbaa`），与其它颜色控件同一套语义。
 *
 * 所有增删改排序都走 `features/layers/colors.ts` 的纯函数，组件本身不实现规则——
 * 上限、合法性、邻居夹取只有一处定义，也才有测试覆盖。
 *
 * 取色用系统原生 `<input type="color">`：它是受控、可见的，`onChange` 里直接写回 store。
 * 不再有旧实现那只「隐藏控件 + 定位盒 + showPicker」的锚定逻辑——那套是为了从自绘游标上
 * 弹面板，控件不可见时取色板的位置与关闭行为都依赖 WebView 的实现细节，正是「十字光标关不掉」
 * 一类问题的温床。
 */
import { useTranslation } from "react-i18next"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Pipette, Plus, X } from "lucide-react"
import { alphaOf, withAlpha, type ColorStop } from "@cardbara/schema"
import {
  DEFAULT_NEW_STOP,
  addStop,
  canAddStop,
  canRemoveStop,
  gradientCss,
  removeStop,
  replaceStop,
  reorderStop,
  setStopPosition,
  toSixDigitHex,
} from "../features/layers/colors"
import { IconButton } from "./IconButton"
import { NumberField } from "./NumberField"
import { Tooltip } from "./Tooltip"

export interface ColorStopsProps {
  colors: ColorStop[]
  onChange: (colors: ColorStop[]) => void
  /** 某行的吸管：进入「从画面拾色」，写回这一行的色值。 */
  onPick: (index: number) => void
}

/** 一行色标：把手 + 取色块 + 透明度 + 位置百分比 + 删除。 */
function StopRow({
  index,
  stop,
  canRemove,
  onColor,
  onAlpha,
  onPosition,
  onPick,
  onRemove,
}: {
  index: number
  stop: ColorStop
  canRemove: boolean
  onColor: (hex: string) => void
  onAlpha: (alpha: number) => void
  onPosition: (at: number) => void
  onPick: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation("layer")
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: index,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 rounded-sm px-1 py-0.5 ${
        isDragging ? "relative z-10 bg-elevated shadow" : ""
      }`}
    >
      {/* 拖动柄：监听只挂在把手上，行里的输入控件才不会一碰就起拖。 */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("colors.drag", { index: index + 1 })}
        className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-disabled"
      >
        <GripVertical size={12} />
      </button>

      {/* 可见的系统取色块：点开面板改色。绑值前过 toSixDigitHex，6/8 位或 3 位旧数据都能显示。 */}
      <input
        type="color"
        value={toSixDigitHex(stop.color)}
        aria-label={t("colors.color", { index: index + 1 })}
        onChange={(e) => onColor(withAlpha(e.target.value, alphaOf(stop.color)))}
        className="h-6 w-7 shrink-0 cursor-pointer rounded-sm border border-border bg-sunken p-0"
      />

      {/* 吸管：与其它颜色字段一样，拾色按钮放在控件外面、点一下从画面取色。 */}
      <IconButton
        icon={Pipette}
        label={t("colors.pick", { index: index + 1 })}
        onClick={onPick}
      />

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={alphaOf(stop.color)}
        aria-label={t("colors.alpha", { index: index + 1 })}
        onChange={(e) => onAlpha(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted">
        {Math.round(alphaOf(stop.color) * 100)}%
      </span>

      {/* 位置百分比：这个颜色停在色带的百分之几处；只影响这一行。 */}
      <NumberField
        value={Math.round(stop.at * 1000) / 10}
        onChange={(percent) => onPosition(percent / 100)}
        min={0}
        max={100}
        precision={1}
        aria-label={t("colors.percent", { index: index + 1 })}
      />
      <span className="shrink-0 text-[10px] text-muted">%</span>

      <button
        type="button"
        disabled={!canRemove}
        onClick={onRemove}
        aria-label={t("colors.remove")}
        className="flex h-6 w-4 shrink-0 items-center justify-center text-muted hover:text-danger disabled:opacity-40 disabled:hover:text-muted"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function ColorStops({ colors, onChange, onPick }: ColorStopsProps) {
  const { t } = useTranslation("layer")
  const full = !canAddStop(colors)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onChange(reorderStop(colors, Number(active.id), Number(over.id)))
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* 只读预览：颜色排列的示意。渲染器在 linear-light 里插值，这里退回 sRGB，不追求逐像素一致。 */}
      <div
        role="img"
        aria-label={t("colors.preview")}
        className="h-4 w-full rounded-sm border border-border-subtle"
        style={{ backgroundImage: gradientCss(colors) }}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={colors.map((_, i) => i)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {colors.map((stop, index) => (
              <StopRow
                // 色标没有稳定 id，下标就是它的身份；增删后整行重建是预期行为。
                key={index}
                index={index}
                stop={stop}
                canRemove={canRemoveStop(colors)}
                onColor={(hex) => onChange(replaceStop(colors, index, hex))}
                onAlpha={(alpha) =>
                  onChange(replaceStop(colors, index, withAlpha(stop.color, alpha)))
                }
                onPosition={(at) => onChange(setStopPosition(colors, index, at))}
                onPick={() => onPick(index)}
                onRemove={() => onChange(removeStop(colors, index))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center gap-1.5">
        <Tooltip label={full ? t("colors.max") : t("colors.add")}>
          <button
            type="button"
            disabled={full}
            onClick={() => onChange(addStop(colors, DEFAULT_NEW_STOP))}
            aria-label={t("colors.add")}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-dashed border-border-subtle text-muted hover:border-accent hover:text-foreground disabled:opacity-40 disabled:hover:border-border-subtle disabled:hover:text-muted"
          >
            <Plus size={13} />
          </button>
        </Tooltip>
        {full && <span className="text-[11px] text-muted">{t("colors.max")}</span>}
      </div>
    </div>
  )
}
