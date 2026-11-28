/**
 * 图层详情：图层名、混合模式、合成参数（折叠）、效果栈。
 *
 * 「合成参数」一块（混合度 / 不透明度 / 图层不透明度）收进默认折叠的 `Section`，让面板首屏只铺开
 * 常用项（名称、混合模式）——面板窄且属性多，折叠能显著降低滚动。
 *
 * 图蒙版不再由本面板单独承载：它已作为 `imageMask` 效果并入效果栈，与「程序化蒙版」并列，
 * 故此处没有独立的蒙版区块——上传入口由效果栈的图片字段给出（见 `onPickImage`）。
 *
 * 文字层（`kind === "text"`）走 `TextDetail`：名称 / 混合模式 / 不透明度仍在这里（两类图层同一套
 * 语义），文字参数与效果栈换成文字面板——文字层没有全息，效果加到子层（见 spec §6.2）。
 *
 * 所有滑块共用一个规律：`updateLayer(ref, id, patch)` 的合并键按字段自动区分，
 * 因此拖动同一个滑块会被合并成一步历史，松手后再拖是新的一步。
 */
import { Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import { findLayerById, type BlendMode, type CardFace, type Layer } from "@prismwright/schema"
import { usePackStore, type EffectTarget, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"
import { EmptyState } from "../../ui/EmptyState"
import { PropertyRow } from "../../ui/PropertyRow"
import { Slider } from "../../ui/Slider"
import { Select } from "../../ui/Select"
import { Section, SectionCard } from "../../ui/Section"
import { displayLayerName } from "../cards/display"
import { importErrorMessage } from "../assets/import-error"
import { EffectStack } from "../effects/EffectStack"
import { imageTargetForEffect } from "../effects/effectOps"
import { TextDetail } from "./TextDetail"

/** 混合模式取值，与 `layer.blend.*` 的 i18n key 一一对应。「正常」置首：它是新建层的默认。 */
const BLEND_MODES: BlendMode[] = ["normal", "shadow", "add", "screen", "multiply"]

/**
 * 三个合成滑块的取值范围与提交方式；范围与 schema 的字段约束保持一致。
 *
 * `toPatch` 逐字段显式写出键名，而不是用 `{ [field]: value }`：计算属性在
 * 键是联合类型时会被推成索引签名，无法赋给 `Partial<Omit<Layer, "id">>`。
 */
const NUMERIC_FIELDS: ReadonlyArray<{
  /** 字段名；兼作 React key 与 `layer[field]` 的取值键。 */
  field: "holoMix" | "holoAlpha" | "opacity"
  /** `layer` 命名空间下的 i18n key。 */
  labelKey: string
  min: number
  max: number
  step: number
  /** 滑块复位图标的目标值；与 schema 的字段默认值一致。 */
  defaultValue: number
  toPatch: (value: number) => Partial<Omit<Layer, "id">>
}> = [
  {
    field: "holoMix",
    labelKey: "field.holoMix",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.9,
    toPatch: (holoMix) => ({ holoMix }),
  },
  {
    field: "holoAlpha",
    labelKey: "field.holoAlpha",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 1,
    toPatch: (holoAlpha) => ({ holoAlpha }),
  },
  {
    field: "opacity",
    labelKey: "field.opacity",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 1,
    toPatch: (opacity) => ({ opacity }),
  },
]

export function LayerDetail({
  face,
  faceRef,
  layerId,
  section = "properties",
}: {
  face: CardFace
  faceRef: FaceRef
  layerId: string
  /**
   * 渲染哪一半：`properties` 画名称/混合/合成（图层页签），`effects` 画效果栈（效果页签）。
   * 默认 `properties`——检查器两个页签各渲染一半，没有任何调用方需要「两半都画」。
   */
  section?: "properties" | "effects"
}) {
  const { t } = useTranslation("layer")
  // 第二把 t：绑定 `errors` 命名空间。`importErrorMessage` 内部用不带前缀的键
  // （如 `t("noPack")`），必须传这把；传上面那把 `layer` 的 t 会把原始 key 渲染给用户。
  const { t: tErrors } = useTranslation("errors")
  // 第三把 t：绑定 `effect` 命名空间。效果栈图片字段的文案（`imageMask.path`）归 `effect`，
  // 这里取其字段名作原生文件框的过滤器名——用 `layer` 的 t 会把原始 key 画到对话框里。
  const { t: tEffect } = useTranslation("effect")
  const updateLayer = usePackStore((s) => s.updateLayer)
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

  if (section === "effects") {
    if (layer.kind === "text") {
      return (
        <div className="p-3">
          <EmptyState icon={Sparkles} title={t("effectsOnText")} />
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-2">
        <SectionCard title={displayLayerName(layer, t)}>
          <EffectStack
            scope="layer"
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

  return (
    <div className="flex flex-col gap-2">
      <div className="select-none px-0 py-1 text-num font-medium uppercase tracking-wide text-disabled">
        {displayLayerName(layer, t)}
      </div>

      <PropertyRow label={t("field.name")} grow>
        <input
          value={layer.name}
          onChange={(e) => updateLayer(faceRef, layerId, { name: e.target.value })}
          className="h-control min-w-0 flex-1 rounded-control border border-line-soft bg-sunken px-1.5 text-body text-foreground outline-none focus:border-accent"
        />
      </PropertyRow>

      {/* 混合模式上移到前部（原在面板最末）：它与「名称」同为图层级属性，比效果栈里的参数更常用。 */}
      <PropertyRow label={t("blend.label")}>
        <Select
          value={layer.blend}
          onChange={(value) => updateLayer(faceRef, layerId, { blend: value as BlendMode })}
          options={BLEND_MODES.map((value) => ({ value, label: t(`blend.${value}`) }))}
        />
      </PropertyRow>

      {/* 三个合成参数：默认折叠收起，避免首屏被滑块铺满。
          文字层没有全息（`holoMix` / `holoAlpha` 对它无意义），只保留图层不透明度。 */}
      <Section title={t("section.composite")} defaultOpen={false}>
        {(layer.kind === "text" ? NUMERIC_FIELDS.filter((f) => f.field === "opacity") : NUMERIC_FIELDS).map(
          ({ field, labelKey, min, max, step, defaultValue, toPatch }) => (
            <PropertyRow key={field} label={t(labelKey)} grow reserveControlSpace>
              <Slider
                value={layer[field]}
                min={min}
                max={max}
                step={step}
                defaultValue={defaultValue}
                resetLabel={t("reset")}
                onChange={(value) => updateLayer(faceRef, layerId, toPatch(value))}
              />
            </PropertyRow>
          ),
        )}
      </Section>

      {layer.kind === "text" && layer.text && (
        <TextDetail faceRef={faceRef} layerId={layerId} text={layer.text} />
      )}
    </div>
  )
}
