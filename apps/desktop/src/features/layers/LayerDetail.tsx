/**
 * 图层效果：把选中层的 `EffectStack` 铺在一张 `SectionCard` 里。
 *
 * 名称 / 混合模式 / 透明度已移到右下角图层面板顶部；名称另支持行内双击与右键重命名。
 * 文字层的字体 / 颜色等详细属性留在检查器的「属性」页签（见 `InspectorPanel`）。
 *
 * 图蒙版不再由本面板单独承载：它已作为 `imageMask` 效果并入效果栈，与「程序化蒙版」并列，
 * 故此处没有独立的蒙版区块——上传入口由效果栈的图片字段给出（见 `onPickImage`）。
 */
import { Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import { findLayerById, type CardFace } from "@prismwright/schema"
import { usePackStore, type EffectTarget, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"
import { EmptyState } from "../../ui/EmptyState"
import { SectionCard } from "../../ui/Section"
import { displayLayerName } from "../cards/display"
import { importErrorMessage } from "../assets/import-error"
import { EffectStack } from "../effects/EffectStack"
import { imageTargetForEffect } from "../effects/effectOps"

export function LayerDetail({
  face,
  faceRef,
  layerId,
}: {
  face: CardFace
  faceRef: FaceRef
  layerId: string
}) {
  const { t } = useTranslation("layer")
  // 第二把 t：绑定 `errors` 命名空间。`importErrorMessage` 内部用不带前缀的键
  // （如 `t("noPack")`），必须传这把；传上面那把 `layer` 的 t 会把原始 key 渲染给用户。
  const { t: tErrors } = useTranslation("errors")
  // 第三把 t：绑定 `effect` 命名空间。效果栈图片字段的文案（`imageMask.path`）归 `effect`，
  // 这里取其字段名作原生文件框的过滤器名——用 `layer` 的 t 会把原始 key 画到对话框里。
  const { t: tEffect } = useTranslation("effect")
  const importAsset = usePackStore((s) => s.importAsset)
  const addEffect = usePackStore((s) => s.addEffect)
  const removeEffect = usePackStore((s) => s.removeEffect)
  const updateEffect = usePackStore((s) => s.updateEffect)
  const moveEffect = usePackStore((s) => s.moveEffect)
  const requestErasePaint = useUiStore((s) => s.requestErasePaint)

  const layer = findLayerById(face.layers, layerId)
  if (!layer) return null

  // 本面板的效果挂在本图层上（`Layer.effects`），与卡面的 `{ scope: "face" }` 相区分。
  const effectTarget: EffectTarget = { scope: "layer", layerId }
  // 闭包里 `layer` 的类型收窄不保留，提前取好效果列表（上方已判空）。
  const layerEffects = layer.effects

  /**
   * 为某条带图片字段的效果上传 / 替换图片（`imageMask` / `image` 共用）；由效果栈经
   * `onPickImage` 拉起。
   *
   * 落盘后把结果路径写回该效果的 `path`：蒙版图落到 `maskEffect` 目标、图片贴片落到
   * `imageEffect` 目标（分流见 `imageTargetForEffect`）——图片不是图层 / 卡面的专属字段，
   * 而是效果参数的一部分。
   */
  async function pickImage(effectId: string, fieldKey: string) {
    // 图片字段的控件是共享的（imageMask / image 都用它），落盘目标由效果的 kind 与字段决定。
    const target = imageTargetForEffect(
      layerEffects.find((e) => e.id === effectId),
      layerId,
      fieldKey,
    )
    // 条目已消失、或该 kind 没有图片字段：不拉起文件框，也不留空动作。
    if (!target) return
    const src = await packFs.pickFile([
      // 过滤器名称显示在原生对话框里，属用户可见文案，走 effect 命名空间取其字段名。
      { name: tEffect("imageMask.path"), extensions: ["png", "jpg", "jpeg", "webp"] },
    ])
    if (!src) return
    const result = await importAsset(faceRef, target, src)
    // 四种失败原因全部给出反馈（文案由共享的 importErrorMessage 穷尽映射），
    // 不再只处理 unsupported-format 一种——否则其余三种是「点了没反应」。
    if (!result.ok) window.alert(importErrorMessage(result, tErrors))
  }
  if (layer.kind === "text") {
    return <EmptyState icon={Sparkles} title={t("effectsOnText")} />
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionCard title={displayLayerName(layer, t)}>
        <EffectStack
          scope="layer"
          adjustment={layer.kind === "adjustment"}
          effects={layer.effects}
          onAdd={(kind) => addEffect(faceRef, effectTarget, kind)}
          onRemove={(id) => removeEffect(faceRef, effectTarget, id)}
          onToggle={(id) => {
            const e = layer.effects.find((x) => x.id === id)
            if (e) updateEffect(faceRef, effectTarget, id, { enabled: !e.enabled })
          }}
          onMove={(id, toIndex) => moveEffect(faceRef, effectTarget, id, toIndex)}
          onUpdate={(id, patch) => updateEffect(faceRef, effectTarget, id, patch)}
          onPickImage={(id, fieldKey) => void pickImage(id, fieldKey)}
          onPaintErase={(id) =>
            requestErasePaint({ ref: faceRef, target: effectTarget, effectId: id })
          }
        />
      </SectionCard>
    </div>
  )
}
