/**
 * 卡片元信息 / 形状 / 表面 / 底色。
 *
 * 正面与背面共用，靠 `card` 是否为 `null` 决定显示哪些身份字段。图片、蒙版、效果都在
 * 图层里，本面板不再有「卡面图」这一特殊字段。
 */
import { useTranslation } from "react-i18next"
import type { Card, CardFace, CardFinish, Rarity } from "@prismwright/schema"
import { usePackStore, type FaceRef } from "../../store/packStore"
import { ColorField } from "../../ui/ColorField"
import { PropertyRow } from "../../ui/PropertyRow"
import { Select } from "../../ui/Select"
import { Slider } from "../../ui/Slider"
import { FaceShapeFields } from "./FaceShapeFields"

/** 与 `card.rarity.*` 的 i18n key 一一对应的稀有度取值，顺序即由低到高。 */
const RARITIES = ["common", "rare", "epic", "legendary"] as const
/** 卡面表面材质，顺序即下拉展示序。 */
const FINISHES = ["standard", "glass"] as const

export interface CardFaceFieldsProps {
  face: CardFace
  faceRef: FaceRef
  /** 卡片对象；背面为 `null`（背面没有身份与分类字段）。 */
  card: Card | null
  /** 是否显示「系列宽高比」一行（编辑默认卡背时隐藏，见 `FaceShapeFields`）。 */
  showSeriesAspect?: boolean
}

export function CardFaceFields({ face, faceRef, card, showSeriesAspect = true }: CardFaceFieldsProps) {
  const { t } = useTranslation("card")
  const updateCard = usePackStore((s) => s.updateCard)
  const updateFace = usePackStore((s) => s.updateFace)
  return (
    <div className="flex flex-col gap-1">
      {card && (
        <>
          <PropertyRow label={t("field.name")} grow>
            <input
              value={card.name}
              onChange={(e) => updateCard(card.id, { name: e.target.value })}
              className="h-control min-w-0 flex-1 rounded-control border border-line-soft bg-sunken px-2 text-body outline-none focus:border-accent"
            />
          </PropertyRow>
          <PropertyRow label={t("field.notes")} grow>
            <input
              value={card.notes}
              onChange={(e) => updateCard(card.id, { notes: e.target.value })}
              className="h-control min-w-0 flex-1 rounded-control border border-line-soft bg-sunken px-2 text-body outline-none focus:border-accent"
            />
          </PropertyRow>
          <PropertyRow label={t("field.rarity")}>
            <Select
              value={card.rarity}
              onChange={(value) => updateCard(card.id, { rarity: value as Rarity })}
              options={RARITIES.map((value) => ({ value, label: t(`rarity.${value}`) }))}
            />
          </PropertyRow>
        </>
      )}

      {/* 形状：宽高比决定整张卡的几何、圆角决定边缘弧度；正反面各自独立。 */}
      <FaceShapeFields face={face} faceRef={faceRef} showSeriesAspect={showSeriesAspect} />

      {/* 表面材质：玻璃会叠一层内置环境反射（见渲染器 glass-overlay），参数只在这一档出现。 */}
      <PropertyRow label={t("field.finish")}>
        <Select
          value={face.finish}
          onChange={(value) => updateFace(faceRef, { finish: value as CardFinish })}
          options={FINISHES.map((value) => ({ value, label: t(`finish.${value}`) }))}
        />
      </PropertyRow>
      {face.finish === "glass" && (
        <>
          <PropertyRow label={t("field.glassStrength")} grow>
            <Slider
              value={face.glassStrength}
              onChange={(value) => updateFace(faceRef, { glassStrength: value })}
              min={0}
              max={1}
              step={0.01}
              precision={2}
              defaultValue={0.6}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.glassRoughness")} grow>
            <Slider
              value={face.glassRoughness}
              onChange={(value) => updateFace(faceRef, { glassRoughness: value })}
              min={0}
              max={1}
              step={0.01}
              precision={2}
              defaultValue={0.15}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.glassTint")}>
            <ColorField
              value={face.glassTint}
              onChange={(glassTint) => updateFace(faceRef, { glassTint })}
              ariaLabel={t("field.glassTint")}
            />
          </PropertyRow>
        </>
      )}

      {/* 卡片画布底色：没有图层覆盖时整张卡垫的颜色。 */}
      <PropertyRow label={t("field.baseColor")}>
        <ColorField
          value={face.baseColor}
          onChange={(baseColor) => updateFace(faceRef, { baseColor })}
          ariaLabel={t("field.baseColor")}
        />
      </PropertyRow>

    </div>
  )
}
