/**
 * 卡面形状 / 表面 / 底色。
 *
 * 名称 / 备注 / 稀有度已移到标题栏的编辑按钮与卡片信息弹框（见 `CardIdentityDialog`）；
 * 图片、蒙版、效果都在图层里，本面板不再有「卡面图」这一特殊字段。
 */
import { useTranslation } from "react-i18next"
import type { CardFace, CardFinish } from "@prismwright/schema"
import { usePackStore, type FaceRef } from "../../store/packStore"
import { ColorField } from "../../ui/ColorField"
import { PropertyRow } from "../../ui/PropertyRow"
import { Select } from "../../ui/Select"
import { Slider } from "../../ui/Slider"
import { FaceShapeFields } from "./FaceShapeFields"

/** 卡面表面材质，顺序即下拉展示序。 */
const FINISHES = ["standard", "glass"] as const

export interface CardFaceFieldsProps {
  face: CardFace
  faceRef: FaceRef
  /** 是否显示「系列宽高比」一行（编辑默认卡背时隐藏，见 `FaceShapeFields`）。 */
  showSeriesAspect?: boolean
}

export function CardFaceFields({ face, faceRef, showSeriesAspect = true }: CardFaceFieldsProps) {
  const { t } = useTranslation("card")
  const updateFace = usePackStore((s) => s.updateFace)
  return (
    <div className="flex flex-col gap-1">

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
