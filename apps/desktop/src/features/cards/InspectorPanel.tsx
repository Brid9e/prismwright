/**
 * 右栏：卡片头 + 四个页签（设计 / 图层 / 效果 / 导出）。
 *
 * 编辑目标由 `previewSide` 决定——正面编当前选中的卡片，背面编系列级 `pack.back`。
 * 因此这里产出一个 `FaceRef` 交给所有子组件，使背面复用同一套 UI。
 *
 * 页签化的目的：旧版把「身份字段 + 图层树 + 图层详情」叠在一条长滚动里，参数一多就要
 * 来回滚。现在按「这张卡是什么 / 由什么组成 / 有什么效果 / 怎么导出」切开，每页只铺一类内容。
 */
import { useTranslation } from "react-i18next"
import { createCardFace, findLayerById, flattenLayers, type CardFace } from "@prismwright/schema"
import { isDefaultBackPack } from "../default-back/default-back"
import { useDefaultBackStore } from "../../store/defaultBackStore"
import { findCard, usePackStore, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { Button } from "../../ui/Button"
import { ConfirmDialog } from "../../ui/ConfirmDialog"
import { SectionCard } from "../../ui/Section"
import { Segmented } from "../../ui/Segmented"
import { Tag } from "../../ui/Tag"
import { customizeBackFlow, editDefaultBackFlow } from "../../app/defaultBack"
import { CardFaceFields } from "./CardFaceFields"
import { displayCardName } from "./display"
import { INSPECTOR_TABS, resolveInspectorTab, type InspectorTab } from "./inspectorTabs"
import { LayerList } from "../layers/LayerList"
import { LayerDetail } from "../layers/LayerDetail"
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
  const { t: tl } = useTranslation("layer")
  // 默认卡背那份工程的名字归 `settings` 命名空间（与设置面板同一个键）。
  const { t: ts } = useTranslation("settings")
  const { t: tc } = useTranslation("card")
  const { t: tm } = useTranslation("common")

  const side = useUiStore((s) => s.previewSide)
  const tab = useUiStore((s) => s.inspectorTab)
  const setTab = useUiStore((s) => s.setInspectorTab)
  const pendingConfirm = useUiStore((s) => s.pendingConfirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const openExportDialog = useUiStore((s) => s.openExportDialog)
  const openBundleExport = useUiStore((s) => s.openBundleExport)

  const pack = usePackStore((s) => s.pack)
  const selectedCardId = usePackStore((s) => s.selectedCardId)
  const selectedLayerId = usePackStore((s) => s.selectedLayerId)
  const deleteLayer = usePackStore((s) => s.deleteLayer)
  const deleteBack = usePackStore((s) => s.deleteBack)

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

  const title =
    side === "back"
      ? (pack?.back ? `${pack.name} · ${t("preview.back")}` : t("preview.back"))
      : card
        ? displayCardName(card, tc)
        : t("preview.noCard")

  const subtitle =
    side === "front" && card
      ? `e${String(card.num).padStart(2, "0")} · ${pack?.name ?? ""}`
      : (pack?.name ?? "")

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-display text-cardname text-foreground">
            {title}
          </span>
          {side === "front" && card && (
            <Tag tone={card.rarity}>{tc(`rarity.${card.rarity}`)}</Tag>
          )}
        </div>
        {subtitle && <span className="truncate text-num text-disabled">{subtitle}</span>}
      </div>

      {hasFace && !usingDefaultBack && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <Segmented
            value={activeTab}
            ariaLabel={t("panel.inspector")}
            onChange={(value) => setTab(value as InspectorTab)}
            options={INSPECTOR_TABS.map((value) => ({
              value,
              label: t(`inspector.${value}`),
            }))}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {usingDefaultBack ? (
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
        ) : activeTab === "design" ? (
          <div className="flex flex-col gap-2 p-2">
            <SectionCard title={t("inspector.design")} collapsible={false}>
              <CardFaceFields
                face={face}
                faceRef={faceRef}
                card={side === "back" ? null : card}
                showSeriesAspect={!editingDefaultBack}
              />
            </SectionCard>
            {canDeleteBack && (
              <Button variant="danger" onClick={() => requestConfirm({ kind: "delete-back" })}>
                {t("preview.deleteBack")}
              </Button>
            )}
          </div>
        ) : activeTab === "layers" ? (
          <div className="flex flex-col">
            <LayerList face={face} faceRef={faceRef} />
            {selectedLayer ? (
              <LayerDetail face={face} faceRef={faceRef} layerId={selectedLayer.id} section="properties" />
            ) : (
              <div className="p-3 text-body text-disabled">{tl("empty")}</div>
            )}
          </div>
        ) : activeTab === "effects" ? (
          selectedLayer ? (
            <LayerDetail face={face} faceRef={faceRef} layerId={selectedLayer.id} section="effects" />
          ) : (
            <div className="p-3 text-body text-disabled">{t("inspector.noLayer")}</div>
          )
        ) : (
          <div className="flex flex-col gap-2 p-2">
            <SectionCard title={t("inspector.exportCard")} collapsible={false}>
              <div className="flex flex-col gap-2">
                <Button variant="secondary" onClick={() => openExportDialog("png")}>
                  {tm("menu.exportPng")}
                </Button>
                <Button variant="secondary" onClick={() => openExportDialog("gif")}>
                  {tm("menu.exportGif")}
                </Button>
                <Button variant="secondary" onClick={() => openExportDialog("webm")}>
                  {tm("menu.exportWebm")}
                </Button>
              </div>
            </SectionCard>
            <SectionCard title={t("inspector.exportSeries")} collapsible={false}>
              <Button className="w-full" onClick={() => openBundleExport(null)}>
                {t("inspector.exportSeries")}
              </Button>
            </SectionCard>
          </div>
        )}
      </div>

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
