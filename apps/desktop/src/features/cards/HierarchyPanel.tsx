/**
 * 左栏：系列区 + 卡片树 + 删除确认。
 */
import { useTranslation } from "react-i18next"
import { findCard, usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { Panel } from "../../ui/Panel"
import { ConfirmDialog } from "../../ui/ConfirmDialog"
import { CardTree } from "./CardTree"
import { displayCardName } from "./display"

export function HierarchyPanel() {
  const { t } = useTranslation("editor")
  const { t: tc } = useTranslation("card")

  // 标题栏箭头折的是**面板内容**（标题栏保留），与「整栏隐藏」的 `collapsed` 分开：
  // 后者由顶部菜单栏控制，二者互不影响（见 uiStore 的 folded / collapsed 说明）。
  const folded = useUiStore((s) => s.folded.left)
  const toggleFolded = useUiStore((s) => s.toggleFolded)
  const pendingConfirm = useUiStore((s) => s.pendingConfirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const pack = usePackStore((s) => s.pack)
  const deleteCard = usePackStore((s) => s.deleteCard)

  const pendingCard =
    pendingConfirm?.kind === "delete-card"
      ? (findCard(pack, pendingConfirm.cardId) ?? undefined)
      : undefined

  return (
    <Panel
      title={t("panel.pack")}
      collapsed={folded}
      onToggleCollapsed={() => toggleFolded("left")}
      scroll={false}
    >
      <div className="flex h-full min-h-0 flex-col">
        <CardTree />
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
    </Panel>
  )
}
