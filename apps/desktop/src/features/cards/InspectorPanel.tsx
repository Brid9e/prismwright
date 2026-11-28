/**
 * 右栏：卡片头 + 页签（设计 / 属性 / 效果 / 导出）+ 右下角常驻图层面板。
 *
 * 编辑目标由 `previewSide` 决定——正面编当前选中的卡片，背面编系列级 `pack.back`。
 * 因此这里产出一个 `FaceRef` 交给所有子组件，使背面复用同一套 UI。
 *
 * 图层面板像 Photoshop 一样常驻在右栏底部，可拖高度；上方页签只显示当前选中层的属性 /
 * 效果，不再把图层树塞进页签里。
 */
import { useState } from "react"
import { useTranslation } from "react-i18next"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Check, Pencil } from "lucide-react"
import { Panel as ResizePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { createCardFace, findLayerById, flattenLayers, type CardFace } from "@prismwright/schema"
import { isDefaultBackPack } from "../default-back/default-back"
import { useDefaultBackStore } from "../../store/defaultBackStore"
import { findCard, usePackStore, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { Button } from "../../ui/Button"
import { ConfirmDialog } from "../../ui/ConfirmDialog"
import { ScrollArea } from "../../ui/ScrollArea"
import { SectionCard } from "../../ui/Section"
import { Segmented } from "../../ui/Segmented"
import { Tag } from "../../ui/Tag"
import { customizeBackFlow, editDefaultBackFlow } from "../../app/defaultBack"
import { CardFaceFields } from "./CardFaceFields"
import { CardIdentityDialog } from "./CardIdentityDialog"
import { displayCardName } from "./display"
import { INSPECTOR_TABS, resolveInspectorTab, type InspectorTab } from "./inspectorTabs"
import { RARITIES } from "./rarities"
import { LayerList } from "../layers/LayerList"
import { LayerDetail } from "../layers/LayerDetail"
import { TextDetail } from "../layers/TextDetail"
import { displayLayerName } from "./display"

/**
 * 背面尚未创建时用于展示的空卡面。
 *
 * `pack.back` 是可选的，且只由**写入**懒创建（见 `packStore.ts` 的 `withFace`）。
 * 若此处对未创建的背面渲染空态，用户就没有任何字段可编辑，懒创建便永远等不到
 * 那次写入——背面成为死路。故用本常量合成展示用的背面，让字段可达。
 */
const EMPTY_FACE: CardFace = createCardFace()

export function InspectorPanel() {
  const { t } = useTranslation("editor")
  // 默认卡背那份工程的名字归 `settings` 命名空间（与设置面板同一个键）。
  const { t: ts } = useTranslation("settings")
  const { t: tc } = useTranslation("card")
  const { t: tm } = useTranslation("common")
  const { t: tl } = useTranslation("layer")

  const side = useUiStore((s) => s.previewSide)
  const tab = useUiStore((s) => s.inspectorTab)
  const setTab = useUiStore((s) => s.setInspectorTab)
  const pendingConfirm = useUiStore((s) => s.pendingConfirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const requestConfirm = useUiStore((s) => s.requestConfirm)

  const pack = usePackStore((s) => s.pack)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const selectedLayerId = usePackStore((s) => s.selectedLayerId)
  const deleteLayer = usePackStore((s) => s.deleteLayer)
  const deleteLayers = usePackStore((s) => s.deleteLayers)
  const deleteBack = usePackStore((s) => s.deleteBack)
  const updateCard = usePackStore((s) => s.updateCard)

  const card = findCard(pack, selectedCardId)
  const faceRef: FaceRef =
    side === "back" ? { kind: "back" } : { kind: "card", cardId: card?.id ?? "" }
  const face = side === "back" ? (pack?.back ?? EMPTY_FACE) : card

  // 系列没有自己的卡背、但有全系列共用的默认卡背：此时展示空卡面的字段是个陷阱——
  // 改任一字段会按**空卡面**懒创建出一张与本系列预览完全不同的卡背。改为给两条明确的出口。
  const defaultBack = useDefaultBackStore((s) => s.face)
  const usingDefaultBack =
    side === "back" && pack !== null && pack.back === null && defaultBack !== null

  // 正在编辑默认卡背那份工程时，系列宽高比属于「这个工程自己」，与任何系列无关，不展示。
  const packRootDir = usePackStore((s) => s.rootDir)
  const defaultBackRoot = useDefaultBackStore((s) => s.rootDir)
  const editingDefaultBack = isDefaultBackPack(packRootDir, defaultBackRoot)

  // 「删除卡背」只出现在系列自己的卡背上：正在编辑默认卡背工程时，删掉它等于删掉
  // 全系列共用的那一份，不属于这里的语义，故不展示。
  const canDeleteBack = side === "back" && pack !== null && pack.back !== null && !editingDefaultBack

  const hasFace = Boolean(face) && (side === "back" || Boolean(card))
  const activeTab = resolveInspectorTab(tab, hasFace && !usingDefaultBack)

  const pendingLayer =
    pendingConfirm?.kind === "delete-layer"
      ? findLayerById(face?.layers ?? [], pendingConfirm.layerId)
      : undefined
  /** 该层将连带删除的后代层数（不含自身）。 */
  const pendingDescendants = pendingLayer ? flattenLayers(pendingLayer.children).length : 0

  const selectedLayer =
    face && selectedLayerId ? findLayerById(face.layers, selectedLayerId) : undefined
  const [identityOpen, setIdentityOpen] = useState(false)
  // 「属性」页签只服务文字层：普通层的混合 / 透明度已移到右下角图层面板顶部。
  const hasTextLayer = selectedLayer?.kind === "text"
  const tabs = INSPECTOR_TABS.filter((value) => value !== "layers" || hasTextLayer)
  const shownTab = activeTab === "layers" && !hasTextLayer ? "design" : activeTab

  const title =
    side === "back"
      ? (pack?.back ? `${pack.name} · ${t("preview.back")}` : t("preview.back"))
      : card
        ? displayCardName(card, tc)
        : t("preview.noCard")

  // 卡背的标题里已经带了系列名，副行再写一遍是重复。
  const subtitle =
    side === "front" && card
      ? `e${String(card.num).padStart(2, "0")} · ${pack?.name ?? ""}`
      : ""

  const body = usingDefaultBack ? (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-body text-muted">{t("preview.usingDefaultBack")}</p>
      <Button variant="secondary" onClick={() => void editDefaultBackFlow(ts("defaultBack.name"))}>
        {t("preview.editDefaultBack")}
      </Button>
      <Button variant="secondary" onClick={() => void customizeBackFlow()}>
        {t("preview.customizeBack")}
      </Button>
    </div>
  ) : !hasFace || !face ? (
    <div className="p-3 text-body text-disabled">{t("preview.noCard")}</div>
  ) : shownTab === "design" ? (
    <div className="flex flex-col gap-2 p-3">
      <SectionCard title={t("inspector.design")} collapsible={false}>
        <CardFaceFields
          face={face}
          faceRef={faceRef}
          showSeriesAspect={!editingDefaultBack}
        />
      </SectionCard>
      {canDeleteBack && (
        <Button variant="danger" onClick={() => requestConfirm({ kind: "delete-back" })}>
          {t("preview.deleteBack")}
        </Button>
      )}
    </div>
  ) : shownTab === "layers" ? (
    <div className="p-3">
      {selectedLayer?.kind === "text" && selectedLayer.text ? (
        <TextDetail
          faceRef={faceRef}
          layerId={selectedLayer.id}
          text={selectedLayer.text}
        />
      ) : null}
    </div>
  ) : selectedLayer ? (
    <div className="p-3">
      <LayerDetail face={face} faceRef={faceRef} layerId={selectedLayer.id} />
    </div>
  ) : (
    <div className="p-3 text-body text-disabled">{t("inspector.noLayer")}</div>
  )

  const showDock = hasFace && !usingDefaultBack && Boolean(face)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-display text-cardname text-foreground">
            {title}
          </span>
          {side === "front" && card && (
            <>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={tc("field.rarity")}
                    title={tc("field.rarity")}
                    className="shrink-0 rounded-chip outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <Tag tone={card.rarity}>{tc(`rarity.${card.rarity}`)}</Tag>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-32 rounded-control border border-line-soft bg-elevated py-1 popover-shadow"
                  >
                    {RARITIES.map((rarity) => (
                      <DropdownMenu.Item
                        key={rarity}
                        onSelect={() => updateCard(card.id, { rarity })}
                        className="flex cursor-default items-center gap-2 px-2 py-1 outline-none data-[highlighted]:bg-accent-soft"
                      >
                        <Tag tone={rarity}>{tc(`rarity.${rarity}`)}</Tag>
                        {rarity === card.rarity && <Check size={12} className="ml-auto text-accent" />}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <button
                type="button"
                aria-label={tc("identity.edit")}
                title={tc("identity.edit")}
                onClick={() => setIdentityOpen(true)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted outline-none hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Pencil size={13} />
              </button>
            </>
          )}
        </div>
        {subtitle && <span className="truncate text-num text-disabled">{subtitle}</span>}
      </div>

      {hasFace && !usingDefaultBack && (
        <div className="no-scrollbar shrink-0 overflow-x-auto border-b border-line px-3 py-2">
          <Segmented
            value={shownTab}
            ariaLabel={t("panel.inspector")}
            onChange={(value) => setTab(value as InspectorTab)}
            options={tabs.map((value) => ({
              value,
              label: t(`inspector.${value}`),
            }))}
          />
        </div>
      )}

      {showDock && face ? (
        <PanelGroup
          direction="vertical"
          autoSaveId="prismwright-right-dock"
          className="min-h-0 flex-1"
        >
          <ResizePanel id="inspector" order={1} defaultSize={66} minSize={30} className="min-h-0">
            <ScrollArea className="h-full">{body}</ScrollArea>
          </ResizePanel>
          <PanelResizeHandle className="group relative h-2 transition-colors">
            <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-transparent transition-colors group-data-[resize-handle-state=hover]:bg-accent/50 group-data-[resize-handle-state=drag]:bg-accent" />
          </PanelResizeHandle>
          <ResizePanel
            id="layers"
            order={2}
            defaultSize={34}
            minSize={20}
            maxSize={60}
            className="min-h-0"
          >
            <LayerList face={face} faceRef={faceRef} />
          </ResizePanel>
        </PanelGroup>
      ) : (
        <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
      )}

      {card && (
        <CardIdentityDialog
          card={card}
          open={identityOpen}
          onClose={() => setIdentityOpen(false)}
        />
      )}

      <ConfirmDialog
        open={pendingConfirm?.kind === "delete-layer"}
        destructive
        title={t("confirm.deleteLayerTitle")}
        body={
          pendingLayer && pendingDescendants > 0
            ? t("confirm.deleteLayerBodyWithChildren", {
                name: displayLayerName(pendingLayer, tl),
                count: pendingDescendants,
              })
            : t("confirm.deleteLayerBody", {
                name: pendingLayer ? displayLayerName(pendingLayer, tl) : "",
              })
        }
        confirmLabel={tm("action.delete")}
        cancelLabel={tm("action.cancel")}
        onCancel={resolveConfirm}
        onConfirm={() => {
          if (pendingConfirm?.kind === "delete-layer") {
            deleteLayer(pendingConfirm.ref, pendingConfirm.layerId)
          }
          resolveConfirm()
        }}
      />

      <ConfirmDialog
        open={pendingConfirm?.kind === "delete-layers"}
        destructive
        title={t("confirm.deleteLayersTitle")}
        body={t("confirm.deleteLayersBody", {
          count: pendingConfirm?.kind === "delete-layers" ? pendingConfirm.layerIds.length : 0,
        })}
        confirmLabel={tm("action.delete")}
        cancelLabel={tm("action.cancel")}
        onCancel={resolveConfirm}
        onConfirm={() => {
          if (pendingConfirm?.kind === "delete-layers") {
            deleteLayers(pendingConfirm.ref, pendingConfirm.layerIds)
          }
          resolveConfirm()
        }}
      />

      <ConfirmDialog
        open={pendingConfirm?.kind === "delete-back"}
        destructive
        title={t("confirm.deleteBackTitle")}
        body={
          defaultBack ? t("confirm.deleteBackBodyDefault") : t("confirm.deleteBackBodyEmpty")
        }
        confirmLabel={tm("action.delete")}
        cancelLabel={tm("action.cancel")}
        onCancel={resolveConfirm}
        onConfirm={() => {
          deleteBack()
          resolveConfirm()
        }}
      />
    </div>
  )
}
