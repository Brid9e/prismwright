/**
 * 卡面形状区：宽高比与圆角。
 *
 * 两者对渲染的代价正好相反，所以在界面上的提交时机也不同：
 *
 * - **宽高比**是几何：渲染器的视图按比例创建，改了只能重建（见 `useCardView`）。
 *   因此拖动期间只更新本地草稿，松手（`onCommit`）才写数据——否则每拖一格都重建一次
 *   WebGL 视图，卡面会一路闪。
 * - **圆角**有就地接口（`CardView.setCornerRadius`），逐次写数据即可，预览跟手变化。
 *
 * 宽高比是**系列级**的：正反面共用同一个框，故落在 `pack.aspect` 上；圆角仍逐卡面独立。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { DEFAULT_CARD_ASPECT, DEFAULT_CORNER_RADIUS, type CardFace } from "@prismwright/schema"
import { usePackStore, type FaceRef } from "../../store/packStore"
import { PropertyRow } from "../../ui/PropertyRow"
import { Slider } from "../../ui/Slider"
import {
  ASPECT_MAX,
  ASPECT_MIN,
  ASPECT_STEP,
  clampAspect,
  cornerRadiusToPercent,
  percentToCornerRadius,
} from "./face-shape"

export interface FaceShapeFieldsProps {
  face: CardFace
  faceRef: FaceRef
  /**
   * 是否显示「系列宽高比」这一行。
   *
   * 编辑默认卡背时传 `false`：比例属于**系列**，而默认卡背被所有系列共用——在这里调它
   * 只会改默认卡背工程自己的框，不会影响任何系列，摆出来纯属误导。
   */
  showSeriesAspect?: boolean
}

export function FaceShapeFields({ face, faceRef, showSeriesAspect = true }: FaceShapeFieldsProps) {
  const { t } = useTranslation("card")
  const updateFace = usePackStore((s) => s.updateFace)
  const setSeriesAspect = usePackStore((s) => s.setSeriesAspect)
  // 比例是系列级的，正反面看到的是同一个值；未打开系列时退回默认 5:7。
  const aspect = usePackStore((s) => s.pack?.aspect ?? DEFAULT_CARD_ASPECT)

  // 本地草稿：拖动中不写 store（写一次就重建一次视图）。外部变更（撤销、切换卡片）时同步回来。
  const [aspectDraft, setAspectDraft] = useState(aspect)
  useEffect(() => {
    setAspectDraft(aspect)
  }, [aspect])

  return (
    <>
      {showSeriesAspect && (
        <PropertyRow label={t("field.aspect")} grow>
          <Slider
            value={aspectDraft}
            onChange={setAspectDraft}
            onCommit={(value) => setSeriesAspect(clampAspect(value))}
            min={ASPECT_MIN}
            max={ASPECT_MAX}
            step={ASPECT_STEP}
            precision={2}
            defaultValue={DEFAULT_CARD_ASPECT}
            resetLabel={t("field.resetShape")}
          />
        </PropertyRow>
      )}
      <PropertyRow label={t("field.cornerRadius")} grow>
        <Slider
          value={cornerRadiusToPercent(face.cornerRadius)}
          onChange={(percent) =>
            updateFace(faceRef, { cornerRadius: percentToCornerRadius(percent) })
          }
          min={0}
          max={100}
          step={1}
          precision={0}
          defaultValue={cornerRadiusToPercent(DEFAULT_CORNER_RADIUS)}
          resetLabel={t("field.resetShape")}
        />
      </PropertyRow>
    </>
  )
}
