/**
 * 卡片名称 / 备注编辑框。
 *
 * 身份字段不再占设计页的常驻行：标题右侧一个编辑按钮打开本框，名称和备注一起提交。
 * 同一张卡的名称 / 备注合并成一次 `updateCard`，只产生一个撤销点。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Card, Rarity } from "@prismwright/schema"
import { usePackStore } from "../../store/packStore"
import { Button } from "../../ui/Button"
import { DialogShell } from "../../ui/Dialog"
import { Select } from "../../ui/Select"
import { RARITIES } from "./rarities"

export interface CardIdentityDialogProps {
  card: Card
  open: boolean
  onClose: () => void
}

export function CardIdentityDialog({ card, open, onClose }: CardIdentityDialogProps) {
  const { t } = useTranslation("card")
  const { t: tc } = useTranslation("common")
  const updateCard = usePackStore((s) => s.updateCard)
  const [name, setName] = useState(card.name)
  const [notes, setNotes] = useState(card.notes)
  const [rarity, setRarity] = useState<Rarity>(card.rarity)

  // 打开时从卡片拉一次草稿；关闭后外部撤销 / 换卡也不会把草稿带回来。
  useEffect(() => {
    if (!open) return
    setName(card.name)
    setNotes(card.notes)
    setRarity(card.rarity)
  }, [open, card.id, card.name, card.notes, card.rarity])

  function save() {
    if (name !== card.name || notes !== card.notes || rarity !== card.rarity) {
      updateCard(card.id, { name, notes, rarity })
    }
    onClose()
  }

  return (
    <DialogShell
      open={open}
      title={t("identity.title")}
      onClose={onClose}
      className="w-96 p-3"
    >
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-label text-muted">{t("field.name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
            className="h-control w-full rounded-control border border-line-soft bg-sunken px-2 text-body text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label text-muted">{t("field.notes")}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="min-h-20 w-full resize-y rounded-control border border-line-soft bg-sunken px-2 py-1 text-body text-foreground outline-none focus:border-accent"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted">{t("field.rarity")}</span>
          <Select
            value={rarity}
            onChange={(value) => setRarity(value as Rarity)}
            options={RARITIES.map((value) => ({ value, label: t(`rarity.${value}`) }))}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {tc("action.cancel")}
          </Button>
          <Button onClick={save}>{tc("action.confirm")}</Button>
        </div>
      </div>
    </DialogShell>
  )
}
