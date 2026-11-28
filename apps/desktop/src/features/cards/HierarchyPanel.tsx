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
import { CardTree } from "./CardTree"
import { type CardSection } from "./cardFilter"
import { displayCardName } from "./display"

export function HierarchyPanel() {
  const { t } = useTranslation("editor")
  const { t: tc } = useTranslation("card")

  const pendingConfirm = useUiStore((s) => s.pendingConfirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const pack = usePackStore((s) => s.pack)
  const addCard = usePackStore((s) => s.addCard)
  const deleteCard = usePackStore((s) => s.deleteCard)

  const [query, setQuery] = useState("")
  const [section, setSection] = useState<CardSection>("all")

  const count = pack ? pack.cards.length + pack.hiddenCards.length : 0

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

      <div className="shrink-0 px-3 pb-2">
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
        {/* 卡背页签没有「卡片」可建，落回普通卡，避免按钮变成空动作。 */}
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => addCard(section === "hidden")}
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
