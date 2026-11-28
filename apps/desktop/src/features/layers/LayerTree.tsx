/**
 * 图层树：可展开/折叠、可拖拽「重挂父级 + 同级重排」的嵌套列表。
 *
 * 与扁平列表 `../../ui/TreeList` 分开实现：图层树需要「三态落位（之前 / 之内 / 之后）」与缩进，
 * 而 `TreeList` 只服务卡片树（扁平）。刻意不共用，避免把嵌套语义渗进卡片树。
 *
 * 拖拽期间不重排数组（沿用全局约定）：落点在松手时由 `./drop` 的 `resolveDrop` 解析。
 *
 * 命中用 `DragOverlay` + 指针真实位置：被拖行不再跟着指针遮住目标；每行的矩形在拖拽中
 * 不位移（没有 SortableContext 的排序变换），三段判定因此稳定。键盘拖拽仍交给 dnd-kit。
 */
import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical } from "lucide-react"
import { restrictToVerticalAxis } from "../../ui/dnd-modifiers"
import type { LayerRow } from "./order"
import { dropZoneAt, resolveDrop, type DropZone } from "./drop"

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
  registerRow,
}: {
  row: LayerTreeRow
  zone: DropZone | null
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
  trailing: ReactNode
  registerRow: (id: string, el: HTMLDivElement | null) => void
}) {
  const { t } = useTranslation("common")
  // 拖拽节点是整行（overlay 才有正确宽度）；监听器只挂在把手上，点行其它位置仍是选中。
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: row.id,
  })
  const { setNodeRef: setDropRef } = useDroppable({ id: row.id })
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      setDragRef(el)
      setDropRef(el)
      registerRow(row.id, el)
    },
    [registerRow, row.id, setDragRef, setDropRef],
  )

  return (
    <div
      ref={setRef}
      onClick={() => onSelect(row.id)}
      onContextMenu={(event) => {
        if (!onContextMenu) return
        event.preventDefault()
        // 外层编辑器空白处也有右键菜单，不拦就会被它盖掉。
        event.stopPropagation()
        onContextMenu(row.id, event)
      }}
      className={`group relative mx-1 flex h-row items-center gap-1 rounded-control pr-1 text-body ${
        row.selected ? "bg-accent-soft text-foreground" : "text-muted hover:bg-elevated"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {zone === "top" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />
      )}
      {zone === "bottom" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
      )}
      {/* 「放进里面」的落点用整行填充表示（不用描边细环：细环在深色底上太弱、也难与选中态区分）。 */}
      {zone === "middle" && <div className="pointer-events-none absolute inset-0 rounded-control bg-accent-soft" />}

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
  // 行元素的真实矩形：指针命中按它计算，不使用 dnd-kit 的碰撞 / 排序变换结果。
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const registerRow = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }, [])
  const [activeId, setActiveId] = useState<string | null>(null)
  // 当前悬停在哪个行、落在其上缘 / 中段 / 下缘的哪一段——驱动落位高亮。
  const [over, setOver] = useState<{ id: string; zone: DropZone } | null>(null)

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    setOver(null)
  }

  function handleDragMove(event: DragMoveEvent) {
    const active = String(event.active.id)
    const anchorY = pointerY(event)
    if (anchorY === null) return

    // 找指针下的行；落在行间空隙时保留上一次有效目标，不跳到 closestCenter 的最近行。
    let hit: { id: string; relativeY: number } | null = null
    for (const row of rows) {
      const el = rowEls.current.get(row.id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (anchorY >= rect.top && anchorY <= rect.bottom) {
        hit = {
          id: row.id,
          relativeY: rect.height > 0 ? (anchorY - rect.top) / rect.height : 0.5,
        }
        break
      }
    }
    if (!hit) return

    const zone = dropZoneAt(hit.relativeY)
    // 拖进自身 / 自己的子树、或会形成环的组合：不显示落点，松手也不会改结构。
    if (!resolveDrop(rows, active, hit.id, zone)) {
      setOver(null)
      return
    }
    setOver({ id: hit.id, zone })
  }

  function handleDragEnd(event: DragEndEvent) {
    const active = String(event.active.id)
    const target = over
    setOver(null)
    setActiveId(null)
    if (!target) return
    const resolved = resolveDrop(rows, active, target.id, target.zone)
    if (!resolved) return
    onMove(active, resolved.parentId, resolved.index)
  }

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : undefined

  if (rows.length === 0) {
    return <div className="px-3 py-2 text-body text-disabled">{emptyText}</div>
  }

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setOver(null)
        setActiveId(null)
      }}
    >
      {rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          zone={over && over.id === row.id ? over.zone : null}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onContextMenu={onContextMenu}
          trailing={trailing(row)}
          registerRow={registerRow}
        />
      ))}
      {/* 跟手的是覆盖层，不是原行；原行留在原位半透明，指针因此不会被它遮住。 */}
      <DragOverlay dropAnimation={null}>
        {activeRow ? (
          <div className="flex h-row items-center gap-2 rounded-control border border-line-soft bg-panel px-2 text-body text-foreground popover-shadow">
            <GripVertical size={12} className="shrink-0 text-disabled" />
            <span className="min-w-0 flex-1 truncate">{activeRow.label}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * 拖拽中指针的纵向锚点。
 *
 * `activatorEvent` 是按下那一下的事件，`delta` 是被拖行自按下以来的位移；键盘拖拽没有
 * 指针坐标，退回被拖行中心。坐标是视口坐标，与 `getBoundingClientRect()` 同域。
 */
function pointerY(event: DragMoveEvent): number | null {
  const activator = event.activatorEvent
  if (activator instanceof PointerEvent) return activator.clientY + event.delta.y
  const translated = event.active.rect.current.translated
  return translated ? translated.top + translated.height / 2 : null
}
