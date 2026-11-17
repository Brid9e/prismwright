/**
 * 图层树：可展开/折叠、可拖拽「重挂父级 + 同级重排」的嵌套列表。
 *
 * 与扁平列表 `../../ui/TreeList` 分开实现：图层树需要「三态落位（之前 / 之内 / 之后）」与缩进，
 * 而 `TreeList` 只服务卡片树（扁平）。刻意不共用，避免把嵌套语义渗进卡片树。
 *
 * 拖拽期间不重排数组（沿用全局约定）：落点在松手时由 `./drop` 的 `resolveDrop` 解析。
 */
import { useState, type MouseEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical } from "lucide-react"
import { restrictToVerticalAxis } from "../../ui/dnd-modifiers"
import type { LayerRow } from "./order"
import { resolveDrop, type DropZone } from "./drop"

/** 界面上的一个图层行：结构信息 + 展示信息。 */
export interface LayerTreeRow extends LayerRow {
  /** 展示文本（调用方负责翻译与回退）。 */
  label: string
  selected: boolean
  /** 是否显示资源缺失警示徽标。 */
  warn: boolean
  /** 是否处于展开态（仅对有子层的行有意义）。 */
  expanded: boolean
}

/** 单条可拖拽的行。 */
function Row({
  row,
  zone,
  onSelect,
  onToggleExpand,
  onContextMenu,
  trailing,
}: {
  row: LayerTreeRow
  zone: DropZone | null
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
  trailing: ReactNode
}) {
  const { t } = useTranslation("common")
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onSelect(row.id)}
      onContextMenu={(event) => {
        if (!onContextMenu) return
        event.preventDefault()
        // 外层编辑器空白处也有右键菜单，不拦就会被它盖掉。
        event.stopPropagation()
        onContextMenu(row.id, event)
      }}
      className={`group relative flex h-7 items-center gap-1 pr-1 text-[12px] ${
        row.selected ? "bg-accent/15 text-foreground" : "text-muted hover:bg-elevated"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {zone === "top" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />
      )}
      {zone === "bottom" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
      )}
      {/* 「放进里面」的落点用整行填充表示（不用描边细环：细环在深色底上太弱、也难与选中态区分）。 */}
      {zone === "middle" && <div className="pointer-events-none absolute inset-0 bg-accent/25" />}

      {/* 拖拽把手：固定在最左一列（不随层级缩进移动），且常驻显示——任何一行都能随时抓取。 */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("tree.drag")}
        className="flex h-full w-4 shrink-0 cursor-grab items-center justify-center text-disabled"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </button>

      {/* 层级缩进：每层 24px，行首不留基准（叶子行的左间距就是它的缩进）。
          24 必须大于「箭头列 12px + 两侧 4px 间距」，否则父级被箭头推右后，子级反而显得更靠左。 */}
      <span style={{ width: row.depth * 24 }} className="shrink-0" />

      {/* 折叠箭头：仅有子层时才占位。叶子行不渲染（也就不留空间），与旧扁平列表一致。 */}
      {row.childCount > 0 && (
        <button
          type="button"
          aria-label={row.expanded ? t("tree.collapse") : t("tree.expand")}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand(row.id)
          }}
          className="flex h-full w-3 shrink-0 items-center justify-center text-disabled hover:text-foreground"
        >
          {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      )}

      <span className="min-w-0 flex-1 truncate" title={row.label}>
        {row.label}
      </span>

      {row.warn && (
        <span className="shrink-0 text-warning" title={t("tree.missing")}>
          <AlertTriangle size={12} />
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        {trailing}
      </span>
    </div>
  )
}

/**
 * 落点行优先取「指针所在行」，指针移出列表时退回离指针最近的行。
 *
 * 默认的 `closestCenter` 按**被拖行**的中心找最近行；而拖行只是跟着指针走，与指针隔着一个
 * 「抓着这一行哪一处」的固定偏移，于是高亮行常与指针下的行差半行、显得滞后。改用
 * `pointerWithin` 让高亮严格跟住指针；指针到列表外（如贴边自动滚动）时再用 `closestCenter`
 * 兜底，避免高亮突然消失。
 */
const detectCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  return within.length > 0 ? within : closestCenter(args)
}

/**
 * 落点判定的纵向锚点：拖拽中指针的 y。
 *
 * `activatorEvent` 是按下那一下的事件，`delta` 是被拖行自按下以来的位移（水平分量已被竖直轴
 * 修饰器归零），两者相加即当前指针位置。键盘拖拽没有指针坐标，退回被拖行中心。
 */
function dropAnchorY(event: DragMoveEvent): number | null {
  const activator = event.activatorEvent
  if (activator instanceof PointerEvent) return activator.clientY + event.delta.y
  const translated = event.active.rect.current.translated
  return translated ? translated.top + translated.height / 2 : null
}

export interface LayerTreeProps {
  rows: LayerTreeRow[]
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  /** 落位回调：一次拖拽解析出的「重挂父级 + 同级下标」。 */
  onMove: (layerId: string, targetParentId: string | null, targetIndex: number) => void
  /** 行尾操作位（眼睛 / 复制 / 删除按钮）。 */
  trailing: (row: LayerTreeRow) => ReactNode
  emptyText: string
  onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
}

export function LayerTree({
  rows,
  onSelect,
  onToggleExpand,
  onMove,
  trailing,
  emptyText,
  onContextMenu,
}: LayerTreeProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // 当前悬停在哪个行、落在其上缘 / 中段 / 下缘的哪一段——驱动落位高亮。
  const [over, setOver] = useState<{ id: UniqueIdentifier; zone: DropZone } | null>(null)

  function handleDragMove(event: DragMoveEvent) {
    const overRect = event.over?.rect
    const anchorY = dropAnchorY(event)
    if (!overRect || !event.over || anchorY === null) {
      setOver(null)
      return
    }
    // 用**指针**在目标行内的纵向位置判定三段：上 1/4 = 之前、下 1/4 = 之后、中段 = 之内。
    // 中段占到一半行高——「放进里面」是这一操作里最需要对准的动作，判定区给宽才不至于要精准
    // 停住；上下缘各留 1/4，插到行与行之间仍够命中。
    const rel = (anchorY - overRect.top) / overRect.height
    const zone: DropZone = rel < 0.25 ? "top" : rel > 0.75 ? "bottom" : "middle"
    setOver({ id: event.over.id, zone })
  }

  function handleDragEnd(event: DragEndEvent) {
    const zone: DropZone = over && event.over && over.id === event.over.id ? over.zone : "middle"
    setOver(null)
    if (!event.over) return
    const target = resolveDrop(rows, String(event.active.id), String(event.over.id), zone)
    if (!target) return
    onMove(String(event.active.id), target.parentId, target.index)
  }

  if (rows.length === 0) {
    return <div className="px-3 py-2 text-[12px] text-disabled">{emptyText}</div>
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detectCollision}
      modifiers={[restrictToVerticalAxis]}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setOver(null)}
    >
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            zone={over && over.id === row.id ? over.zone : null}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onContextMenu={onContextMenu}
            trailing={trailing(row)}
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}
