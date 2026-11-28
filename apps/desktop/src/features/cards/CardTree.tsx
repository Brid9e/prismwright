/**
 * 卡片库列表：缩略图 + 名字 + 编号，行尾操作与缺失资源徽标。
 *
 * 只负责「把过滤后的卡片画出来」；搜索词与分组由 `HierarchyPanel` 持有——那里还有
 * 搜索框与分段控件，状态跟着控件走，列表只消费结果。
 */
import type { MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Copy, Download, SearchX, Trash2 } from "lucide-react"
import { collectCardAssets, type Card } from "@prismwright/schema"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { cardContextItems } from "../../ui/contextMenuModel"
import { EmptyState } from "../../ui/EmptyState"
import { Tag } from "../../ui/Tag"
import { Tooltip } from "../../ui/Tooltip"
import { TreeList, type TreeNode } from "../../ui/TreeList"
import { filterCards, type CardSection } from "./cardFilter"
import { displayCardName } from "./display"
import { useCardThumbnail } from "./useCardThumbnail"

export interface CardTreeProps {
  /** 当前分组（全部 / 隐藏款 / 卡背）。 */
  section: CardSection
  /** 搜索词；空串表示不筛。 */
  query: string
}

/**
 * 行首缩略图：有预览 PNG 就显示，没有就退回「编号 + 稀有度色」的色块。
 *
 * 单独成组件是为了让 `useCardThumbnail` 的 Hook 只跟随**这一张卡**——放进循环里手写
 * Hook 会把所有卡的加载状态挤在同一个组件里，一张图变化就让整列重渲染。
 */
function Thumbnail({ card }: { card: Card }) {
  const url = useCardThumbnail(card)
  return (
    <span className="flex h-thumb w-thumb shrink-0 items-center justify-center overflow-hidden rounded-chip border border-line-soft bg-sunken">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-num text-disabled">{card.num}</span>
      )}
    </span>
  )
}

export function CardTree({ section, query }: CardTreeProps) {
  const { t } = useTranslation("card")
  const { t: te } = useTranslation("editor")

  const pack = usePackStore((s) => s.pack)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const selectCard = usePackStore((s) => s.selectCard)
  const duplicateCard = usePackStore((s) => s.duplicateCard)
  const previewSide = useUiStore((s) => s.previewSide)
  const setPreviewSide = useUiStore((s) => s.setPreviewSide)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const openBundleExport = useUiStore((s) => s.openBundleExport)
  const openContextMenu = useUiStore((s) => s.openContextMenu)
  const missingAssets = useUiStore((s) => s.missingAssets)

  if (!pack) {
    return (
      <div className="p-3 text-body leading-relaxed text-disabled">{te("pack.emptyHint")}</div>
    )
  }

  // 卡背不在卡片池里：它是系列级的单个对象，选中即切预览到背面。
  if (section === "back") {
    return (
      <div className="p-1">
        <button
          type="button"
          onClick={() => setPreviewSide("back")}
          aria-pressed={previewSide === "back"}
          className={`flex w-full items-center gap-2 rounded-control px-2 py-3 text-left text-body ${
            previewSide === "back"
              ? "bg-accent-soft text-foreground"
              : "text-muted hover:bg-elevated"
          }`}
        >
          <span className="flex h-thumb w-thumb shrink-0 items-center justify-center rounded-chip border border-line-soft bg-sunken text-num text-disabled">
            ⇄
          </span>
          <span>{te("library.back")}</span>
        </button>
      </div>
    )
  }

  const cards = filterCards(pack, { query, section })
  // 只有「全部」把两个池子混在一起，才需要分组标题；隐藏款单独一屏时标题是噪声。
  const showSections = section === "all"

  if (cards.length === 0) {
    return <EmptyState icon={SearchX} title={te("library.noMatch")} />
  }

  const nodes: TreeNode[] = cards.map((card) =>
    toNode(
      card,
      showSections
        ? pack.cards.includes(card)
          ? t("section.normal")
          : t("section.hidden")
        : undefined,
    ),
  )

  function toNode(card: Card, sectionLabel: string | undefined): TreeNode {
    return {
      id: card.id,
      label: displayCardName(card, t),
      sublabel: `e${String(card.num).padStart(2, "0")}`,
      section: sectionLabel,
      selected: card.id === selectedCardId,
      leading: <Thumbnail card={card} />,
      // 稀有度：一眼看出每张卡挂的档位，颜色与卡册、小程序一致。
      tag: <Tag tone={card.rarity}>{t(`rarity.${card.rarity}`)}</Tag>,
      warn: collectCardAssets(card).some((rel) => missingAssets[rel] === true),
      trailing: (
        <>
          <Tooltip label={t("bundle:export.titleCard")}>
            <button
              type="button"
              aria-label={t("bundle:export.titleCard")}
              onClick={(e) => {
                e.stopPropagation()
                openBundleExport(card.id)
              }}
              className="flex h-5 w-5 items-center justify-center rounded-chip text-muted hover:bg-panel hover:text-foreground"
            >
              <Download size={12} />
            </button>
          </Tooltip>
          <Tooltip label={t("common:action.duplicate")}>
            <button
              type="button"
              aria-label={t("common:action.duplicate")}
              onClick={(e) => {
                e.stopPropagation()
                duplicateCard(card.id)
              }}
              className="flex h-5 w-5 items-center justify-center rounded-chip text-muted hover:bg-panel hover:text-foreground"
            >
              <Copy size={12} />
            </button>
          </Tooltip>
          <Tooltip label={t("common:action.delete")}>
            <button
              type="button"
              aria-label={t("common:action.delete")}
              onClick={(e) => {
                e.stopPropagation()
                requestConfirm({ kind: "delete-card", cardId: card.id })
              }}
              className="flex h-5 w-5 items-center justify-center rounded-chip text-muted hover:bg-panel hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </>
      ),
    }
  }

  /** 选中卡片时回到正面：用户点卡片列表的意图是看这张卡的正面。 */
  function handleSelect(cardId: string): void {
    selectCard(cardId)
    setPreviewSide("front")
  }

  /** 右键某一行：先选中它（与系统列表一致），再按这张卡出菜单。 */
  function handleContextMenu(cardId: string, event: MouseEvent<HTMLDivElement>): void {
    selectCard(cardId)
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: cardContextItems({
        cardId,
        t,
        exportCard: openBundleExport,
        duplicateCard,
        deleteCard: (id) => requestConfirm({ kind: "delete-card", cardId: id }),
      }),
    })
  }

  return (
    <div className="py-1">
      <TreeList
        nodes={nodes}
        onSelect={handleSelect}
        onContextMenu={handleContextMenu}
        emptyText={te("pack.emptyHint")}
      />
    </div>
  )
}
