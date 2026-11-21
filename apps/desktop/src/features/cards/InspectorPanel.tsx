/**
 * 右栏：卡面元信息 + 图层列表 + 图层详情。
 *
 * 编辑目标由 `previewSide` 决定——正面编当前选中的卡片，背面编系列级 `pack.back`。
 * 因此这里产出一个 `FaceRef` 交给所有子组件，使背面复用同一套 UI（设计文档偏离 D3）。
 */
import { useTranslation } from "react-i18next"
import { createCardFace, findLayerById, flattenLayers, type CardFace } from "@prismwright/schema"
import { isDefaultBackPack } from "../default-back/default-back"
import { useDefaultBackStore } from "../../store/defaultBackStore"
import { findCard, usePackStore, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { Panel } from "../../ui/Panel"
import { ConfirmDialog } from "../../ui/ConfirmDialog"
import { customizeBackFlow, editDefaultBackFlow } from "../../app/defaultBack"
import { CardFaceFields } from "./CardFaceFields"
import { LayerList } from "../layers/LayerList"
import { LayerDetail } from "../layers/LayerDetail"
import { displayLayerName } from "./display"

/**
 * 背面尚未创建时用于展示的空卡面。
 *
 * `pack.back` 是可选的，且只由**写入**懒创建（见 `packStore.ts` 的 `withFace`：
 * `if (!pack.back) pack.back = createCardFace()`）。
 * 若此处对未创建的背面渲染空态，用户就没有任何字段可编辑，懒创建便永远等不到
 * 那次写入——背面成为死路（且与 `preview.backNotSet`「编辑任一字段即会创建」的
 * 承诺矛盾）。故用本常量合成展示用的背面，让字段可达。
 *
 * 用 `createCardFace()` 而非手写字面量：默认值里有嵌套的 `effects` / `layers`，
 * 手写会与 schema 兜底两处漂移（与 `withFace` 的懒创建同源）。
 */
const EMPTY_FACE: CardFace = createCardFace()

export function InspectorPanel() {
  const { t } = useTranslation("editor")
  const { t: tl } = useTranslation("layer")
  // 默认卡背那份工程的名字归 `settings` 命名空间（与设置面板同一个键）。
  const { t: ts } = useTranslation("settings")

  // 标题栏箭头折的是**面板内容**（标题栏保留），与「整栏隐藏」的 `collapsed` 分开：
  // 后者由顶部菜单栏控制，二者互不影响（见 uiStore 的 folded / collapsed 说明）。
  const folded = useUiStore((s) => s.folded.right)
  const toggleFolded = useUiStore((s) => s.toggleFolded)
  const side = useUiStore((s) => s.previewSide)
  const pendingConfirm = useUiStore((s) => s.pendingConfirm)
  const resolveConfirm = useUiStore((s) => s.resolveConfirm)
  const requestConfirm = useUiStore((s) => s.requestConfirm)

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
  const usingDefaultBack = side === "back" && pack !== null && pack.back === null && defaultBack !== null

  // 正在编辑默认卡背那份工程时，系列宽高比属于「这个工程自己」，与任何系列无关，不展示。
  const packRootDir = usePackStore((s) => s.rootDir)
  const defaultBackRoot = useDefaultBackStore((s) => s.rootDir)
  const editingDefaultBack = isDefaultBackPack(packRootDir, defaultBackRoot)

  // 「删除卡背」只出现在系列自己的卡背上：正在编辑默认卡背工程时，删掉它等于删掉
  // 全系列共用的那一份，不属于这里的语义，故不展示。
  const canDeleteBack = side === "back" && pack !== null && pack.back !== null && !editingDefaultBack

  const pendingLayer =
    pendingConfirm?.kind === "delete-layer"
      ? findLayerById(face?.layers ?? [], pendingConfirm.layerId)
      : undefined
  /** 该层将连带删除的后代层数（不含自身）。 */
  const pendingDescendants = pendingLayer ? flattenLayers(pendingLayer.children).length : 0

  return (
    <Panel
      title={t("panel.inspector")}
      collapsed={folded}
      onToggleCollapsed={() => toggleFolded("right")}
    >
      {usingDefaultBack ? (
        <div className="flex flex-col gap-2 p-3">
          <p className="text-[12px] text-muted">{t("preview.usingDefaultBack")}</p>
          <button
            type="button"
            onClick={() => void editDefaultBackFlow(ts("defaultBack.name"))}
            className="rounded-sm border border-border-subtle px-2 py-1 text-[12px] text-foreground hover:bg-elevated"
          >
            {t("preview.editDefaultBack")}
          </button>
          <button
            type="button"
            onClick={() => void customizeBackFlow()}
            className="rounded-sm border border-border-subtle px-2 py-1 text-[12px] text-foreground hover:bg-elevated"
          >
            {t("preview.customizeBack")}
          </button>
        </div>
      ) : !face || (side === "front" && !card) ? (
        <div className="p-3 text-[12px] text-disabled">{t("preview.noCard")}</div>
      ) : (
        <>
          <CardFaceFields
            face={face}
            faceRef={faceRef}
            card={side === "back" ? null : card}
            showSeriesAspect={!editingDefaultBack}
          />
          <LayerList face={face} faceRef={faceRef} />
          {selectedLayerId && findLayerById(face.layers, selectedLayerId) ? (
            <LayerDetail face={face} faceRef={faceRef} layerId={selectedLayerId} />
          ) : (
            <div className="p-3 text-[12px] text-disabled">{tl("empty")}</div>
          )}
          {canDeleteBack && (
            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => requestConfirm({ kind: "delete-back" })}
                className="w-full rounded-sm border border-border-subtle px-2 py-1 text-[12px] text-danger hover:bg-elevated"
              >
                {t("preview.deleteBack")}
              </button>
            </div>
          )}
        </>
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
        confirmLabel={t("common:action.delete")}
        cancelLabel={t("common:action.cancel")}
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
          defaultBack
            ? t("confirm.deleteBackBodyDefault")
            : t("confirm.deleteBackBodyEmpty")
        }
        confirmLabel={t("common:action.delete")}
        cancelLabel={t("common:action.cancel")}
        onCancel={resolveConfirm}
        onConfirm={() => {
          deleteBack()
          resolveConfirm()
        }}
      />
    </Panel>
  )
}
