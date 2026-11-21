/**
 * 卡面元信息区：名称 / 备注 / 稀有度 / 卡面图 / 效果栈。
 *
 * 正面与背面共用，靠 `card` 是否为 `null` 决定显示哪些身份字段——背面在 schema 里只有
 * `front` / `effects` / `layers`，没有身份与分类信息，故传 `null`。
 *
 * 图蒙版不单独设区块：它已作为 `imageMask` 效果并入效果栈，图片字段经 `onPickImage`
 * 拉起原生文件框（见 `pickImage`）。
 */
import { useTranslation } from "react-i18next"
import { ImagePlus, Trash2 } from "lucide-react"
import type { Card, CardFace, CardFinish, FrontFit, Rarity } from "@cardbara/schema"
import { usePackStore, type EffectTarget, type FaceRef } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"
import { ColorField } from "../../ui/ColorField"
import { PropertyRow } from "../../ui/PropertyRow"
import { Select } from "../../ui/Select"
import { IconButton } from "../../ui/IconButton"
import { Slider } from "../../ui/Slider"
import { Switch } from "../../ui/Switch"
import { importErrorMessage } from "../assets/import-error"
import { EffectStack } from "../effects/EffectStack"
import { imageTargetForEffect } from "../effects/effectOps"
import { FaceShapeFields } from "./FaceShapeFields"
import {
  FRONT_FITS,
  FRONT_OFFSET_LIMIT,
  FRONT_OFFSET_STEP,
  FRONT_ROTATION_LIMIT,
  FRONT_ROTATION_STEP,
  FRONT_SCALE_MAX,
  FRONT_SCALE_MIN,
  FRONT_SCALE_STEP,
  clampFrontOffset,
  clampFrontRotation,
  clampFrontScale,
} from "./front-adjust"

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
  // 第二把 t：绑定 `errors` 命名空间。`importErrorMessage` 内部用不带前缀的键
  // （`t("noPack")`），必须传这把；传上面那把 `card` 的 t 会把原始 key 渲染给用户。
  const { t: tErrors } = useTranslation("errors")
  // 第三把 t：绑定 `effect` 命名空间。效果栈图片字段的文案（`imageMask.path`）归 `effect`，
  // 这里取其字段名作原生文件框的过滤器名——用 `card` 的 t 会把原始 key 画到对话框里。
  const { t: tEffect } = useTranslation("effect")
  const updateCard = usePackStore((s) => s.updateCard)
  const updateFace = usePackStore((s) => s.updateFace)
  const importAsset = usePackStore((s) => s.importAsset)
  const addEffect = usePackStore((s) => s.addEffect)
  const removeEffect = usePackStore((s) => s.removeEffect)
  const updateEffect = usePackStore((s) => s.updateEffect)
  const moveEffect = usePackStore((s) => s.moveEffect)
  const requestColorPick = useUiStore((s) => s.requestColorPick)
  const requestErasePaint = useUiStore((s) => s.requestErasePaint)

  // 本面板的效果挂在卡面本身（`CardFace.effects`），与图层的 `{ scope: "layer" }` 相区分。
  const effectTarget: EffectTarget = { scope: "face" }

  async function pickAsset() {
    const src = await packFs.pickFile([
      { name: t("field.front"), extensions: ["png", "jpg", "jpeg", "webp"] },
    ])
    if (!src) return
    const result = await importAsset(faceRef, { kind: "front" }, src)
    // 四种失败原因全部给出反馈（文案由共享的 importErrorMessage 穷尽映射），
    // 不再只处理 unsupported-format 一种——否则其余三种是「点了没反应」。
    if (!result.ok) {
      window.alert(importErrorMessage(result, tErrors))
    }
  }

  /**
   * 为某条带图片字段的效果上传 / 替换图片；由效果栈的图片字段经 `onPickImage` 拉起。
   *
   * 卡面自身的图蒙版挂在 `face.effects`，故 `layerId` 传 `null`（store 据此定位到卡面级效果）。
   * 落盘目标由 `imageTargetForEffect` 按 kind 与字段分流——卡面上只可能出现 `imageMask`，
   * 但字段键照样透传，免得日后卡面也能挂 `image` 时这里静默写错位置。
   */
  async function pickImage(effectId: string, fieldKey: string) {
    const target = imageTargetForEffect(
      face.effects.find((e) => e.id === effectId),
      // 卡面没有图层 id；`imageMask` 目标认 `null` 表示「卡面级效果」。
      "",
      fieldKey,
    )
    if (!target) return
    const src = await packFs.pickFile([
      { name: tEffect("imageMask.path"), extensions: ["png", "jpg", "jpeg", "webp"] },
    ])
    if (!src) return
    const faceTarget =
      target.kind === "maskEffect" ? { ...target, layerId: null as string | null } : target
    const result = await importAsset(faceRef, faceTarget, src)
    if (!result.ok) window.alert(importErrorMessage(result, tErrors))
  }

  /**
   * 上传 / 替换卡面法线图（写 `frontNormalPath`）。首次选择时 store 会把强度从 0 抬到 1，
   * 免得「选了图却什么都看不见」。
   */
  async function pickNormal() {
    const src = await packFs.pickFile([
      { name: t("field.frontNormalPath"), extensions: ["png", "jpg", "jpeg", "webp"] },
    ])
    if (!src) return
    const result = await importAsset(faceRef, { kind: "faceNormal" }, src)
    if (!result.ok) window.alert(importErrorMessage(result, tErrors))
  }

  return (
    <div className="border-b border-border py-1">
      {card && (
        <>
          <PropertyRow label={t("field.name")} grow>
            <input
              value={card.name}
              onChange={(e) => updateCard(card.id, { name: e.target.value })}
              className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-sunken px-1.5 text-[12px] outline-none focus:border-accent"
            />
          </PropertyRow>
          <PropertyRow label={t("field.notes")} grow>
            <input
              value={card.notes}
              onChange={(e) => updateCard(card.id, { notes: e.target.value })}
              className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-sunken px-1.5 text-[12px] outline-none focus:border-accent"
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

      {/* 卡面图：已设置时给「替换」与「删除」两个动作，未设置时只给「上传」。
          删除即清空引用（`front = ""`），原图文件留在系列目录里不删——与 importAsset 的
          「不自动清理孤儿资源」一致，且清空是可撤销的一步历史。 */}
      <PropertyRow label={t("field.front")}>
        <span className="min-w-0 max-w-[16ch] truncate text-[11px] text-muted" title={face.front}>
          {face.front || t("field.notSet")}
        </span>
        {face.front ? (
          <>
            <IconButton
              icon={ImagePlus}
              label={t("field.replace")}
              onClick={() => void pickAsset()}
            />
            <IconButton
              icon={Trash2}
              label={t("field.remove")}
              onClick={() => updateFace(faceRef, { front: "" })}
            />
          </>
        ) : (
          <IconButton icon={ImagePlus} label={t("field.upload")} onClick={() => void pickAsset()} />
        )}
      </PropertyRow>

      {/* 法线贴图：与底图的亮度法线二选一，有贴图时贴图接管（见 bump.ts 的 resolveBump）。
          独立一行、不受「已设置底图」限制——法线自带形状，没有底图时也能让光泽 / 摩尔纹
          显出凹凸。 */}
      <PropertyRow label={t("field.frontNormalPath")}>
        <span
          className="min-w-0 max-w-[16ch] truncate text-[11px] text-muted"
          title={face.frontNormalPath}
        >
          {face.frontNormalPath || t("field.notSet")}
        </span>
        {face.frontNormalPath ? (
          <>
            <IconButton
              icon={ImagePlus}
              label={t("field.frontNormalReplace")}
              onClick={() => void pickNormal()}
            />
            <IconButton
              icon={Trash2}
              label={t("field.frontNormalRemove")}
              onClick={() => updateFace(faceRef, { frontNormalPath: "" })}
            />
          </>
        ) : (
          <IconButton
            icon={ImagePlus}
            label={t("field.frontNormalUpload")}
            onClick={() => void pickNormal()}
          />
        )}
      </PropertyRow>

      {/* 底图调整：只在已设置图片时出现——没有底图时这几个控件改什么都看不见。
          偏移以卡高为单位（与图层图片效果的 x / y 同口径），滑块与数字框共用同一个夹取。 */}
      {face.front && (
        <>
          <PropertyRow label={t("field.frontFit")}>
            <Select
              value={face.frontFit}
              onChange={(value) => updateFace(faceRef, { frontFit: value as FrontFit })}
              options={FRONT_FITS.map((value) => ({
                value,
                label: t(`frontFit.${value}`),
              }))}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontOffsetX")} grow>
            <Slider
              value={face.frontOffsetX}
              onChange={(value) => updateFace(faceRef, { frontOffsetX: clampFrontOffset(value) })}
              min={-FRONT_OFFSET_LIMIT}
              max={FRONT_OFFSET_LIMIT}
              step={FRONT_OFFSET_STEP}
              precision={3}
              defaultValue={0}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontOffsetY")} grow>
            <Slider
              value={face.frontOffsetY}
              onChange={(value) => updateFace(faceRef, { frontOffsetY: clampFrontOffset(value) })}
              min={-FRONT_OFFSET_LIMIT}
              max={FRONT_OFFSET_LIMIT}
              step={FRONT_OFFSET_STEP}
              precision={3}
              defaultValue={0}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          {/* 缩放与旋转叠在填充方式之上：缩放绕图片中心等比放大，旋转也是绕中心，正 = 顺时针。 */}
          <PropertyRow label={t("field.frontScale")} grow>
            <Slider
              value={face.frontScale}
              onChange={(value) => updateFace(faceRef, { frontScale: clampFrontScale(value) })}
              min={FRONT_SCALE_MIN}
              max={FRONT_SCALE_MAX}
              step={FRONT_SCALE_STEP}
              precision={2}
              defaultValue={1}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontRotation")} grow>
            <Slider
              value={face.frontRotation}
              onChange={(value) => updateFace(faceRef, { frontRotation: clampFrontRotation(value) })}
              min={-FRONT_ROTATION_LIMIT}
              max={FRONT_ROTATION_LIMIT}
              step={FRONT_ROTATION_STEP}
              precision={0}
              defaultValue={0}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
        </>
      )}

      {/* 法线（bump）：底图亮度差或法线贴图，扰动光泽 / 摩尔纹的走势，并继承给没有
          自带法线的图层。强度 0 = 关（默认），其余各项在 0 时不起作用；光照 0 = 不出明暗
          （只影响走势），没有光泽 / 摩尔纹时凹凸只靠它显形。
          两个来源有一个就显示——法线贴图不依赖底图。 */}
      {(face.front || face.frontNormalPath) && (
        <>
          <PropertyRow label={t("field.frontBumpStrength")} grow>
            <Slider
              value={face.frontBumpStrength}
              onChange={(value) => updateFace(faceRef, { frontBumpStrength: value })}
              min={0}
              max={10}
              step={0.01}
              precision={2}
              defaultValue={0}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          {/* 细节是亮度法线的取样步长；法线贴图自带形状，这一项在贴图模式下不起作用，故隐去。 */}
          {!face.frontNormalPath && (
            <PropertyRow label={t("field.frontBumpDetail")} grow>
              <Slider
                value={face.frontBumpDetail}
                onChange={(value) => updateFace(faceRef, { frontBumpDetail: value })}
                min={0.001}
                max={0.05}
                step={0.001}
                precision={3}
                defaultValue={0.01}
                resetLabel={t("field.resetOffset")}
              />
            </PropertyRow>
          )}
          {face.frontNormalPath && (
            <PropertyRow label={t("field.frontNormalFlipY")}>
              <Switch
                checked={face.frontNormalFlipY}
                onChange={(checked) => updateFace(faceRef, { frontNormalFlipY: checked })}
                ariaLabel={t("field.frontNormalFlipY")}
              />
            </PropertyRow>
          )}
          <PropertyRow label={t("field.frontBumpFlow")} grow>
            <Slider
              value={face.frontBumpFlow}
              onChange={(value) => updateFace(faceRef, { frontBumpFlow: value })}
              min={0}
              max={1}
              step={0.01}
              precision={2}
              defaultValue={0.5}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontBumpLight")} grow>
            <Slider
              value={face.frontBumpLight}
              onChange={(value) => updateFace(faceRef, { frontBumpLight: value })}
              min={0}
              max={1}
              step={0.01}
              precision={2}
              defaultValue={1}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontBumpLightAngle")} grow>
            <Slider
              value={face.frontBumpLightAngle}
              onChange={(value) => updateFace(faceRef, { frontBumpLightAngle: value })}
              min={-180}
              max={180}
              step={1}
              precision={0}
              defaultValue={127}
              resetLabel={t("field.resetOffset")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontBumpLightColor")}>
            <ColorField
              value={face.frontBumpLightColor}
              onChange={(frontBumpLightColor) => updateFace(faceRef, { frontBumpLightColor })}
              ariaLabel={t("field.frontBumpLightColor")}
            />
          </PropertyRow>
          <PropertyRow label={t("field.frontBumpInvert")}>
            <Switch
              checked={face.frontBumpInvert}
              onChange={(checked) => updateFace(faceRef, { frontBumpInvert: checked })}
              ariaLabel={t("field.frontBumpInvert")}
            />
          </PropertyRow>
        </>
      )}

      {/* 效果栈：注册表驱动，逐条可开关 / 调序 / 改参 / 删——卡面唯一的效果入口。
          图蒙版（imageMask）与程序化蒙版（maskPreset）都在此添加；前者的图片字段
          经 onPickImage 拉起原生文件框（见 pickImage）。 */}
      <EffectStack
        scope="face"
        effects={face.effects}
        onAdd={(kind) => addEffect(faceRef, effectTarget, kind)}
        onRemove={(id) => removeEffect(faceRef, effectTarget, id)}
        onToggle={(id) => {
          // 开关走 updateEffect 的 `enabled`（EffectBase 字段，非 params），需先取当前值再取反。
          const e = face.effects.find((x) => x.id === id)
          if (e) updateEffect(faceRef, effectTarget, id, { enabled: !e.enabled })
        }}
        onMove={(id, toIndex) => moveEffect(faceRef, effectTarget, id, toIndex)}
        onUpdate={(id, patch) => updateEffect(faceRef, effectTarget, id, patch)}
        onPickImage={(id, fieldKey) => void pickImage(id, fieldKey)}
        onPickColor={(id, colorIndex) =>
          requestColorPick({ ref: faceRef, target: effectTarget, effectId: id, colorIndex })
        }
        onPaintErase={(id) =>
          requestErasePaint({ ref: faceRef, target: effectTarget, effectId: id })
        }
      />
    </div>
  )
}
