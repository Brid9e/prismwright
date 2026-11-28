/**
 * 左栏：卡片库（搜索 + 分组 + 列表 + 新建）。
 *
 * 搜索词与分组状态放在这里而不是 `CardTree`：它们属于「库」这一层，列表只消费结果。
 * 新建卡片的类型跟随当前分组——在「隐藏款」里点新建，建出来的就是隐藏款。
 */
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import { findCard, usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { Button } from "../../ui/Button"
import { ConfirmDialog } from "../../ui/ConfirmDialog"
import { Segmented } from "../../ui/Segmented"
import { CardTree, Thumbnail } from "./CardTree"
import { type CardSection } from "./cardFilter"
import { displayCardName } from "./display"

export interface HierarchyPanelProps {
  /** 紧凑布局：只渲染缩略图条，不含搜索、分组与新建。 */
  compact?: boolean
}

export function HierarchyPanel({ compact = false }: HierarchyPanelProps) {
  const { t } = useTranslation("editor")
  const { t: tc } = useTranslation("card")

  const pendingConfirm = useUiStore((s) => s.pendingConfirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const pack = usePackStore((s) => s.pack)
  const addCard = usePackStore((s) => s.addCard)
  const deleteCard = usePackStore((s) => s.deleteCard)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const selectCard = usePackStore((s) => s.selectCard)
  const setPreviewSide = useUiStore((s) => s.setPreviewSide)

  const [query, setQuery] = useState("")
  const [section, setSection] = useState<CardSection>("all")

  const count = pack ? pack.cards.length + pack.hiddenCards.length : 0

  if (compact) {
    const all = pack ? [...pack.cards, ...pack.hiddenCards] : []
    return (
      <div className="flex h-full min-h-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden p-1">
        {all.map((card) => (
          <button
            key={card.id}
            type="button"
            aria-label={displayCardName(card, tc)}
            aria-pressed={card.id === selectedCardId}
            onClick={() => {
              selectCard(card.id)
              setPreviewSide("front")
            }}
            className={`shrink-0 rounded-chip p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              card.id === selectedCardId
                ? "bg-accent-soft ring-1 ring-accent"
                : "hover:bg-elevated"
            }`}
          >
            <Thumbnail card={card} />
          </button>
        ))}
      </div>
    )
  }

  const pendingCard =
    pendingConfirm?.kind === "delete-card"
      ? (findCard(pack, pendingConfirm.cardId) ?? undefined)
      : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <span className="text-title font-semibold text-foreground">{t("library.title")}</span>
        <span className="text-num text-disabled">{count}</span>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("library.search")}
          aria-label={t("library.search")}
          className="h-control w-full rounded-control border border-line-soft bg-sunken px-2 text-body text-foreground outline-none placeholder:text-disabled hover:border-line focus:border-accent"
        />
      </div>

      <div className="no-scrollbar shrink-0 overflow-x-auto px-3 pb-2">
        <Segmented
          value={section}
          ariaLabel={t("library.title")}
          onChange={(value) => setSection(value as CardSection)}
          options={[
            { value: "all", label: t("library.all") },
            { value: "hidden", label: t("library.hidden") },
            { value: "back", label: t("library.back") },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1">
        <CardTree section={section} query={query} />
      </div>

      <div className="shrink-0 border-t border-line p-2">
        {/* 卡背页签没有「卡片」可建，落回普通卡并切到「全部」，否则新卡落在看不见的分组/
            被搜索词滤掉，用户以为没建出来。 */}
        <Button
          variant="secondary"
          size="sm"
          align="start"
          className="w-full"
          onClick={() => {
            addCard(section === "hidden")
            if (section === "back") setSection("all")
            setQuery("")
          }}
        >
          <Plus size={14} />
          {t("library.newCard")}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingConfirm?.kind === "delete-card"}
        destructive
        title={t("confirm.deleteCardTitle")}
        body={t("confirm.deleteCardBody", {
          name: pendingCard ? displayCardName(pendingCard, tc) : "",
        })}
        confirmLabel={t("common:action.delete")}
        cancelLabel={t("common:action.cancel")}
        onCancel={resolveConfirm}
        onConfirm={() => {
          if (pendingConfirm?.kind === "delete-card") void deleteCard(pendingConfirm.cardId)
          resolveConfirm()
        }}
      />
    </div>
  )
}
