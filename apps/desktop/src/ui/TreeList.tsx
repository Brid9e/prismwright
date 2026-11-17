/**
 * 扁平列表：卡片树用的可选中条目列表。
 *
 * 每条有选中态、行尾操作位；`section` 字段变化处插入一个分组标题行，用于「普通卡 / 隐藏款」
 * 这类分组。**不含拖拽排序**：卡片顺序目前不需要用户调整，故这里只做展示与选中。需要「三态
 * 落位（之前 / 之内 / 之后）」的图层排序另见 `features/layers/LayerTree`，那是另一套实现。
 */
import type { MouseEvent, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle } from "lucide-react"

/** 列表中的一个条目。 */
export interface TreeNode {
  id: string
  /** 展示文本（调用方负责翻译与回退处理）。 */
  label: string
  /** 分组标题；与上一条不同时插入标题行。 */
  section?: string
  selected?: boolean
  /** 是否显示警示徽标（资源缺失）。 */
  warn?: boolean
  /** 名字右侧的小标记（如稀有度色标），不参与截断。 */
  tag?: ReactNode
  /** 行尾操作位。 */
  trailing?: ReactNode
}

/** 单行。 */
function Row({
  node,
  onSelect,
  onContextMenu,
}: {
  node: TreeNode
  onSelect: (id: string) => void
  onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
}) {
  const { t } = useTranslation("common")

  return (
    <div
      onClick={() => onSelect(node.id)}
      onContextMenu={(event) => {
        if (!onContextMenu) return
        event.preventDefault()
        // 拦在这里：外层（编辑器空白处）也有自己的右键菜单，不拦就会把它盖掉。
        event.stopPropagation()
        onContextMenu(node.id, event)
      }}
      className={`group flex h-7 items-center gap-1 pl-2 pr-1 text-[12px] ${
        node.selected ? "bg-accent/15 text-foreground" : "text-muted hover:bg-elevated"
      }`}
    >
      <span className="min-w-0 flex-1 truncate" title={node.label}>
        {node.label}
      </span>
      {node.tag}
      {node.warn && (
        <span className="shrink-0 text-warning" title={t("tree.missing")}>
          <AlertTriangle size={12} />
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        {node.trailing}
      </span>
    </div>
  )
}

export interface TreeListProps {
  nodes: TreeNode[]
  onSelect: (id: string) => void
  /** 列表为空时的提示（调用方负责翻译）。 */
  emptyText: string
  onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
}

export function TreeList({ nodes, onSelect, emptyText, onContextMenu }: TreeListProps) {
  if (nodes.length === 0) {
    return <div className="px-3 py-2 text-[12px] text-disabled">{emptyText}</div>
  }

  return (
    <>
      {nodes.map((node, index) => {
        const previous = nodes[index - 1]
        const showSection = node.section !== undefined && node.section !== previous?.section
        return (
          <div key={node.id}>
            {showSection && (
              <div className="select-none px-2 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-disabled">
                {node.section}
              </div>
            )}
            <Row node={node} onSelect={onSelect} onContextMenu={onContextMenu} />
          </div>
        )
      })}
    </>
  )
}
