/**
 * 图层列表：树形的拖拽重挂/重排、展开折叠、眼睛开关、复制、删除。
 *
 * 界面顺序是绘制顺序的**倒序**（顶行 = 最上层）；换算集中在 `order.ts`。折叠态是本组件的
 * 局部 UI 状态（不入 store、不进历史）。落点在松手时由 `drop.ts` 解析，深度上限由
 * `exceedsNestDepth` 复核——超限时拒绝并提示，不静默改结构。
 */
import { useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Copy, Eye, EyeOff, ImagePlus, Plus, SlidersHorizontal, Trash2, Type } from "lucide-react"
import {
  MAX_NEST_DEPTH,
  ancestorChain,
  exceedsNestDepth,
  findLayerById,
  type BlendMode,
  type CardFace,
} from "@prismwright/schema"
import { IMAGE_EXTENSIONS, usePackStore, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"
import { layerContextItems } from "../../ui/contextMenuModel"
import { IconButton } from "../../ui/IconButton"
import { ScrollArea } from "../../ui/ScrollArea"
import { Select } from "../../ui/Select"
import { Slider } from "../../ui/Slider"
import { Tooltip } from "../../ui/Tooltip"
import { importErrorMessage } from "../assets/import-error"
import { displayLayerName } from "../cards/display"
import { toDisplayOrder } from "./order"
import { LayerTree, type LayerTreeRow } from "./LayerTree"
import { layerHasMissingAsset } from "./warn"

/** 混合模式取值，与 `layer.blend.*` 的 i18n key 一一对应。「正常」置首：它是新建层的默认。 */
const BLEND_MODES: BlendMode[] = ["normal", "shadow", "add", "screen", "multiply"]

export function LayerList({ face, faceRef }: { face: CardFace; faceRef: FaceRef }) {
  const { t } = useTranslation("layer")
  const { t: tErrors } = useTranslation("errors")
  const { t: tEffect } = useTranslation("effect")
  const addLayer = usePackStore((s) => s.addLayer)
  const addTextLayer = usePackStore((s) => s.addTextLayer)
  const addAdjustmentLayer = usePackStore((s) => s.addAdjustmentLayer)
  const addImageLayer = usePackStore((s) => s.addImageLayer)
  const importAsset = usePackStore((s) => s.importAsset)
  const duplicateLayer = usePackStore((s) => s.duplicateLayer)
  const moveLayer = usePackStore((s) => s.moveLayer)
  const setLayerEnabled = usePackStore((s) => s.setLayerEnabled)
  const updateLayer = usePackStore((s) => s.updateLayer)
  const selectedLayerId = usePackStore((s) => s.selectedLayerId)
  const selectLayer = usePackStore((s) => s.selectLayer)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const openContextMenu = useUiStore((s) => s.openContextMenu)
  const missingAssets = useUiStore((s) => s.missingAssets)
  /** 已折叠的图层 id（局部 UI 状态）。 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  /** 正在就地重命名的图层 id（局部 UI 状态）。 */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const selectedLayer = selectedLayerId
    ? findLayerById(face.layers, selectedLayerId)
    : undefined

  function commitRename(id: string, name: string) {
    const layer = findLayerById(face.layers, id)
    // 名字没变就不入历史点（双击后又原样提交是常见操作）。
    if (layer && layer.name !== name) updateLayer(faceRef, id, { name })
    setRenamingId(null)
  }

  function toggleExpand(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 快捷入口：选图 → 建「图层 + 图片效果」→ 落盘并写入 path。
   *
   * 先选文件再建数据：用户取消对话框时不该留下任何空图层。选图之后的导入失败
   * （扩展名 / 拷贝失败等）保留空图片层，用户可在效果面板里重选。
   */
  async function addImage() {
    const src = await packFs.pickFile([
      { name: tEffect("image.path"), extensions: [...IMAGE_EXTENSIONS] },
    ])
    if (!src) return
    const created = addImageLayer(faceRef)
    if (!created) return
    const result = await importAsset(
      faceRef,
      { kind: "imageEffect", layerId: created.layerId, effectId: created.effectId },
      src,
    )
    if (!result.ok) window.alert(importErrorMessage(result, tErrors))
  }

  const rows: LayerTreeRow[] = []
  for (const row of toDisplayOrder(face.layers, collapsed)) {
    const layer = findLayerById(face.layers, row.id)
    if (!layer) continue
    // 图蒙版与图片都挂在效果列表里，故从效果解析而非图层字段；任一有图且该图缺失时告警。
    rows.push({
      ...row,
      label: displayLayerName(layer, t),
      selected: row.id === selectedLayerId,
      warn: layerHasMissingAsset(layer.effects, missingAssets),
      expanded: !collapsed.has(row.id),
    })
  }

  /** 落位前复核深度上限：超限则提示并拒绝，不静默改结构。 */
  function handleMove(layerId: string, targetParentId: string | null, targetIndex: number) {
    const moved = findLayerById(face.layers, layerId)
    if (!moved) return
    const ancestorCount =
      targetParentId === null ? 0 : (ancestorChain(face.layers, targetParentId)?.length ?? 0) + 1
    if (exceedsNestDepth(moved, ancestorCount)) {
      window.alert(t("nest.tooDeep", { max: MAX_NEST_DEPTH }))
      return
    }
    moveLayer(faceRef, layerId, targetParentId, targetIndex)
    // 落位后展开目标父，让刚落进去的子层可见。
    if (targetParentId !== null) {
      setCollapsed((prev) => {
        if (!prev.has(targetParentId)) return prev
        const next = new Set(prev)
        next.delete(targetParentId)
        return next
      })
    }
  }

  /** 右键某一行：先选中它，再按这个图层出菜单。 */
  function handleContextMenu(layerId: string, event: MouseEvent<HTMLDivElement>): void {
    selectLayer(layerId)
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: layerContextItems({
        layerId,
        t,
        renameLayer: setRenamingId,
        duplicateLayer: (id) => duplicateLayer(faceRef, id),
        deleteLayer: (id) => requestConfirm({ kind: "delete-layer", ref: faceRef, layerId: id }),
      }),
    })
  }

  function trailingFor(layerId: string, enabled: boolean) {
    return (
      <>
        <Tooltip label={t("action.toggle")}>
          <button
            type="button"
            aria-label={t("action.toggle")}
            onClick={(e) => {
              e.stopPropagation()
              setLayerEnabled(faceRef, layerId, !enabled)
            }}
            className="flex h-5 w-5 items-center justify-center rounded-chip text-muted hover:bg-elevated hover:text-foreground"
          >
            {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </Tooltip>
        <Tooltip label={t("action.duplicate")}>
          <button
            type="button"
            aria-label={t("action.duplicate")}
            onClick={(e) => {
              e.stopPropagation()
              duplicateLayer(faceRef, layerId)
            }}
            className="flex h-5 w-5 items-center justify-center rounded-chip text-muted hover:bg-elevated hover:text-foreground"
          >
            <Copy size={12} />
          </button>
        </Tooltip>
        <Tooltip label={t("action.delete")}>
          <button
            type="button"
            aria-label={t("action.delete")}
            onClick={(e) => {
              e.stopPropagation()
              requestConfirm({ kind: "delete-layer", ref: faceRef, layerId })
            }}
            className="flex h-5 w-5 items-center justify-center rounded-chip text-muted hover:bg-elevated hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </Tooltip>
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-line">
      <div className="flex shrink-0 items-center px-3 pb-1 pt-2">
        <span className="select-none text-body font-semibold text-muted">
          {t("section.layers")}
        </span>
      </div>
      {/* 选中层的属性：两列一行，带小标签。没选中层时保留控件但禁用，面板高度不跳动。
          名称在行内双击 / 右键重命名，不在这里再占一行。透明度不挂复位图标，给滑轨留宽度。 */}
      <div className="grid shrink-0 grid-cols-2 gap-2 px-3 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-muted">{t("blend.label")}</span>
          <Select
            value={selectedLayer?.blend ?? "normal"}
            disabled={!selectedLayer || selectedLayer.kind === "adjustment"}
            grow
            onChange={(value) => {
              if (selectedLayer) updateLayer(faceRef, selectedLayer.id, { blend: value as BlendMode })
            }}
            options={BLEND_MODES.map((value) => ({
              value,
              label: t(`blend.${value}`),
            }))}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-muted">{t("field.opacity")}</span>
          <Slider
            value={selectedLayer?.opacity ?? 1}
            disabled={!selectedLayer || selectedLayer.kind === "adjustment"}
            min={0}
            max={1}
            step={0.01}
            ariaLabel={t("field.opacity")}
            onChange={(opacity) => {
              if (selectedLayer) updateLayer(faceRef, selectedLayer.id, { opacity })
            }}
          />
        </div>
      </div>
      {/* 添加动作收成一排图标：不占一整行文字宽度。 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <IconButton icon={ImagePlus} label={t("action.addImage")} onClick={() => void addImage()} />
        <IconButton
          icon={Type}
          label={t("action.addText")}
          onClick={() => addTextLayer(faceRef, t("text.defaultContent"))}
        />
        <IconButton
          icon={SlidersHorizontal}
          label={t("action.addAdjustment")}
          onClick={() => addAdjustmentLayer(faceRef)}
        />
        <IconButton icon={Plus} label={t("action.add")} onClick={() => addLayer(faceRef)} />
      </div>
      {/* 纵向滚动的树列表同样不该出现横向滚动条（行内文本已 `truncate`）：只放开 y、裁掉 x，
          避免极窄栏 + 深层嵌套时挤出一条横向滚动条。滚动条走覆盖式。 */}
      <ScrollArea className="min-h-0 flex-1 bg-sunken">
        <LayerTree
          rows={rows}
          onSelect={selectLayer}
          onToggleExpand={toggleExpand}
          onMove={handleMove}
          onContextMenu={handleContextMenu}
          emptyText={t("empty")}
          renamingId={renamingId}
          onStartRename={setRenamingId}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          trailing={(row) => {
            const layer = findLayerById(face.layers, row.id)
            return layer ? trailingFor(row.id, layer.enabled) : null
          }}
        />
      </ScrollArea>
    </div>
  )
}
