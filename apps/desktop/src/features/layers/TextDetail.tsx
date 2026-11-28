/**
 * 文字图层的排版面板：内容、蒙版开关、字体、外观、描边、投影、排版、位置。
 *
 * 图层级的三项（名称 / 混合模式 / 不透明度）仍由 `LayerDetail` 承载——它们对普通图层与
 * 文字层是同一套语义。本面板只管文字自己的参数，故没有效果栈：效果加到子层（见 spec §6.2）。
 *
 * 所有滑块的复位目标取自 `TextParamsSchema` 的默认值（`TEXT_DEFAULTS`），不在 UI 另抄数字。
 */
import { useTranslation } from "react-i18next"
import {
  TextParamsSchema,
  type TextParams,
  type TextShadowParams,
  type TextStrokeParams,
} from "@prismwright/schema"
import { usePackStore, type FaceRef } from "../../store/packStore"
import { ColorField } from "../../ui/ColorField"
import { PropertyRow } from "../../ui/PropertyRow"
import { Section } from "../../ui/Section"
import { Select } from "../../ui/Select"
import { Slider } from "../../ui/Slider"
import { Switch } from "../../ui/Switch"
import { textFontOptions } from "./fonts"

/** schema 里的默认值（只解析一次）：滑块的复位目标与「开启描边 / 投影」的初值。 */
const TEXT_DEFAULTS = TextParamsSchema.parse({})
const STROKE_DEFAULTS = TextParamsSchema.parse({ stroke: {} }).stroke as TextStrokeParams
const SHADOW_DEFAULTS = TextParamsSchema.parse({ shadow: {} }).shadow as TextShadowParams

/** 字重档位：按 spec §6.2 的四档给下拉，避免 100–900 的滑块落不出整数档。 */
const WEIGHTS = [300, 400, 700, 900] as const

/** 字重档位 → i18n key。 */
const WEIGHT_KEYS: Record<number, string> = {
  300: "text.weight.light",
  400: "text.weight.regular",
  700: "text.weight.bold",
  900: "text.weight.black",
}

const ALIGNS: TextParams["align"][] = ["left", "center", "right"]

export function TextDetail({
  faceRef,
  layerId,
  text,
}: {
  faceRef: FaceRef
  layerId: string
  text: TextParams
}) {
  const { t } = useTranslation("layer")
  const updateTextLayer = usePackStore((s) => s.updateTextLayer)
  const update = (patch: Partial<TextParams>) => updateTextLayer(faceRef, layerId, patch)
  // 取成局部 const：`const` 的非空收窄能带进下面的回调，故不必写非空断言。
  const stroke = text.stroke
  const shadow = text.shadow

  return (
    <div className="flex flex-col gap-2">
      <Section title={t("text.section.content")}>
        <PropertyRow label={t("text.field.content")} grow>
          <textarea
            value={text.content}
            onChange={(e) => update({ content: e.target.value })}
            rows={3}
            className="min-h-14 w-full min-w-0 resize-y rounded-control border border-line-soft bg-sunken px-2 py-1 text-body outline-none focus:border-accent"
          />
        </PropertyRow>
        <PropertyRow label={t("text.mask.label")} reserveControlSpace>
          <Switch
            checked={text.asMask}
            onChange={(asMask) => update({ asMask })}
            ariaLabel={t("text.mask.label")}
          />
        </PropertyRow>
        {text.asMask && (
          <p className="px-0 pb-1 text-num leading-tight text-disabled">{t("text.mask.hint")}</p>
        )}
      </Section>

      <Section title={t("text.section.font")}>
        <PropertyRow label={t("text.field.fontFamily")}>
          <Select
            value={text.fontFamily}
            onChange={(fontFamily) => update({ fontFamily })}
            options={textFontOptions(text.fontFamily)}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.customFont")} grow>
          <input
            value={text.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value })}
            className="h-control min-w-0 flex-1 rounded-control border border-line-soft bg-sunken px-2 text-body outline-none focus:border-accent"
          />
        </PropertyRow>
        <p className="px-0 pb-1 text-num leading-tight text-disabled">{t("text.field.fontHint")}</p>
      </Section>

      <Section title={t("text.section.appearance")}>
        <PropertyRow label={t("text.field.fontSize")} grow reserveControlSpace>
          <Slider
            value={text.fontSize}
            min={0.02}
            max={0.6}
            step={0.01}
            defaultValue={TEXT_DEFAULTS.fontSize}
            resetLabel={t("reset")}
            onChange={(fontSize) => update({ fontSize })}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.fontWeight")}>
          <Select
            value={String(text.fontWeight)}
            onChange={(value) => update({ fontWeight: Number(value) })}
            options={WEIGHTS.map((weight) => ({
              value: String(weight),
              label: t(WEIGHT_KEYS[weight]),
            }))}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.italic")} reserveControlSpace>
          <Switch
            checked={text.italic}
            onChange={(italic) => update({ italic })}
            ariaLabel={t("text.field.italic")}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.color")} reserveControlSpace>
          <ColorField
            value={text.color}
            onChange={(color) => update({ color })}
            ariaLabel={t("text.field.color")}
            size="md"
          />
        </PropertyRow>
      </Section>

      <Section title={t("text.section.stroke")} defaultOpen={false}>
        <PropertyRow label={t("text.field.strokeOn")} reserveControlSpace>
          <Switch
            checked={stroke !== null}
            onChange={(on) => update({ stroke: on ? { ...STROKE_DEFAULTS } : null })}
            ariaLabel={t("text.field.strokeOn")}
          />
        </PropertyRow>
        {stroke && (
          <>
            <PropertyRow label={t("text.field.strokeColor")} reserveControlSpace>
              <ColorField
                value={stroke.color}
                onChange={(color) => update({ stroke: { ...stroke, color } })}
                ariaLabel={t("text.field.strokeColor")}
                size="md"
              />
            </PropertyRow>
            <PropertyRow label={t("text.field.strokeWidth")} grow reserveControlSpace>
              <Slider
                value={stroke.width}
                min={0.001}
                max={0.05}
                step={0.001}
                defaultValue={STROKE_DEFAULTS.width}
                resetLabel={t("reset")}
                onChange={(width) => update({ stroke: { ...stroke, width } })}
              />
            </PropertyRow>
          </>
        )}
      </Section>

      <Section title={t("text.section.shadow")} defaultOpen={false}>
        <PropertyRow label={t("text.field.shadowOn")} reserveControlSpace>
          <Switch
            checked={shadow !== null}
            onChange={(on) => update({ shadow: on ? { ...SHADOW_DEFAULTS } : null })}
            ariaLabel={t("text.field.shadowOn")}
          />
        </PropertyRow>
        {shadow && (
          <>
            <PropertyRow label={t("text.field.shadowColor")} reserveControlSpace>
              <ColorField
                value={shadow.color}
                onChange={(color) => update({ shadow: { ...shadow, color } })}
                ariaLabel={t("text.field.shadowColor")}
                size="md"
              />
            </PropertyRow>
            <PropertyRow label={t("text.field.shadowOpacity")} grow reserveControlSpace>
              <Slider
                value={shadow.opacity}
                min={0}
                max={1}
                step={0.01}
                defaultValue={SHADOW_DEFAULTS.opacity}
                resetLabel={t("reset")}
                onChange={(opacity) => update({ shadow: { ...shadow, opacity } })}
              />
            </PropertyRow>
            <PropertyRow label={t("text.field.shadowOffsetX")} grow reserveControlSpace>
              <Slider
                value={shadow.offsetX}
                min={-0.2}
                max={0.2}
                step={0.002}
                defaultValue={SHADOW_DEFAULTS.offsetX}
                resetLabel={t("reset")}
                onChange={(offsetX) => update({ shadow: { ...shadow, offsetX } })}
              />
            </PropertyRow>
            <PropertyRow label={t("text.field.shadowOffsetY")} grow reserveControlSpace>
              <Slider
                value={shadow.offsetY}
                min={-0.2}
                max={0.2}
                step={0.002}
                defaultValue={SHADOW_DEFAULTS.offsetY}
                resetLabel={t("reset")}
                onChange={(offsetY) => update({ shadow: { ...shadow, offsetY } })}
              />
            </PropertyRow>
            <PropertyRow label={t("text.field.shadowBlur")} grow reserveControlSpace>
              <Slider
                value={shadow.blur}
                min={0}
                max={0.3}
                step={0.002}
                defaultValue={SHADOW_DEFAULTS.blur}
                resetLabel={t("reset")}
                onChange={(blur) => update({ shadow: { ...shadow, blur } })}
              />
            </PropertyRow>
          </>
        )}
      </Section>

      <Section title={t("text.section.layout")} defaultOpen={false}>
        <PropertyRow label={t("text.field.letterSpacing")} grow reserveControlSpace>
          <Slider
            value={text.letterSpacing}
            min={0}
            max={0.3}
            step={0.005}
            defaultValue={TEXT_DEFAULTS.letterSpacing}
            resetLabel={t("reset")}
            onChange={(letterSpacing) => update({ letterSpacing })}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.lineHeight")} grow reserveControlSpace>
          <Slider
            value={text.lineHeight}
            min={0.8}
            max={3}
            step={0.05}
            defaultValue={TEXT_DEFAULTS.lineHeight}
            resetLabel={t("reset")}
            onChange={(lineHeight) => update({ lineHeight })}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.align")}>
          <Select
            value={text.align}
            onChange={(align) => update({ align: align as TextParams["align"] })}
            options={ALIGNS.map((align) => ({
              value: align,
              label: t(`text.field.align${align[0].toUpperCase()}${align.slice(1)}`),
            }))}
          />
        </PropertyRow>
      </Section>

      <Section title={t("text.section.position")} defaultOpen={false}>
        <PropertyRow label={t("text.field.x")} grow reserveControlSpace>
          <Slider
            value={text.x}
            min={-1}
            max={1}
            step={0.01}
            defaultValue={TEXT_DEFAULTS.x}
            resetLabel={t("reset")}
            onChange={(x) => update({ x })}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.y")} grow reserveControlSpace>
          <Slider
            value={text.y}
            min={-1}
            max={1}
            step={0.01}
            defaultValue={TEXT_DEFAULTS.y}
            resetLabel={t("reset")}
            onChange={(y) => update({ y })}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.scale")} grow reserveControlSpace>
          <Slider
            value={text.scale}
            min={0.1}
            max={4}
            step={0.05}
            defaultValue={TEXT_DEFAULTS.scale}
            resetLabel={t("reset")}
            onChange={(scale) => update({ scale })}
          />
        </PropertyRow>
        <PropertyRow label={t("text.field.rotation")} grow reserveControlSpace>
          <Slider
            value={text.rotation}
            min={-180}
            max={180}
            step={1}
            defaultValue={TEXT_DEFAULTS.rotation}
            resetLabel={t("reset")}
            onChange={(rotation) => update({ rotation })}
          />
        </PropertyRow>
      </Section>
    </div>
  )
}
