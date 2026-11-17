/**
 * 卡片树：普通卡与隐藏款两组，名字右侧的稀有度色标、行尾操作、缺失卡面徽标。
 */
import type { MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Copy, Download, Plus, Trash2 } from "lucide-react"
import type { Card } from "@cardbara/schema"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { cardContextItems } from "../../ui/contextMenuModel"
import { TreeList, type TreeNode } from "../../ui/TreeList"
import { Tooltip } from "../../ui/Tooltip"
import { displayCardName } from "./display"
import { rarityTone } from "./rarity"

export function CardTree() {
  const { t } = useTranslation("card")
  const { t: te } = useTranslation("editor")

  const pack = usePackStore((s) => s.pack)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const selectCard = usePackStore((s) => s.selectCard)
  const addCard = usePackStore((s) => s.addCard)
  const duplicateCard = usePackStore((s) => s.duplicateCard)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const openBundleExport = useUiStore((s) => s.openBundleExport)
  const openContextMenu = useUiStore((s) => s.openContextMenu)
  const missingAssets = useUiStore((s) => s.missingAssets)

  if (!pack) {
    return (
      <div className="p-3 text-[12px] leading-relaxed text-disabled">{te("pack.emptyHint")}</div>
    )
  }

  // 两个分组拼成一个列表：TreeList 在 section 变化处自动插标题，故「普通卡 / 隐藏款」
  // 两组共用一个实例即可，不必各建一个。
  const nodes: TreeNode[] = [
    ...pack.cards.map((card) => toNode(card, t("section.normal"))),
    ...pack.hiddenCards.map((card) => toNode(card, t("section.hidden"))),
  ]

  function toNode(card: Card, section: string): TreeNode {
    const tone = rarityTone(card.rarity)
    return {
      id: card.id,
      label: `${card.num}. ${displayCardName(card, t)}`,
      section,
      selected: card.id === selectedCardId,
      // 稀有度小色标：一眼看出每张卡挂的档位，颜色与卡册、小程序一致。
      tag: (
        <span className={`shrink-0 rounded-sm px-1 text-[9px] leading-4 ${tone.text} ${tone.tint}`}>
          {t(`rarity.${card.rarity}`)}
        </span>
      ),
      warn: card.front !== "" && missingAssets[card.front] === true,
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
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted hover:text-foreground"
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
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted hover:text-foreground"
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
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </>
      ),
    }
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-1">
        {[
          { hidden: false, label: t("section.normal") },
          { hidden: true, label: t("section.hidden") },
        ].map((group) => (
          <Tooltip key={group.label} label={`${t("common:action.new")} · ${group.label}`}>
            <button
              type="button"
              aria-label={`${t("common:action.new")} · ${group.label}`}
              onClick={() => addCard(group.hidden)}
              className="flex h-5 items-center gap-0.5 rounded-sm px-1.5 text-[11px] text-muted hover:bg-elevated hover:text-foreground"
            >
              <Plus size={12} />
              {group.label}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <TreeList
          nodes={nodes}
          onSelect={selectCard}
          onContextMenu={handleContextMenu}
          emptyText={te("pack.emptyHint")}
        />
      </div>
    </div>
  )
}
