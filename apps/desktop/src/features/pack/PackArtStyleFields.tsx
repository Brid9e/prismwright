/**
 * 卡包图合成参数：混合方式、两层滤镜、取景与反相。
 *
 * 每项改完立刻写回 `pack.packArtStyle`（`updatePackArtStyle` 按字段做合并键，
 * 连拖一串只进一次撤销栈），旁边的预览随改随变。取值与小程序抽卡页完全同一套
 * 算法（见 `pack-art-style.ts`），这里调成什么样，真机就是什么样。
 */
import { useTranslation } from "react-i18next"
import {
  DEFAULT_PACK_ART_STYLE,
  type PackArtBlend,
  type PackArtFit,
  type PackArtStyle,
} from "@prismwright/schema"
import { usePackStore } from "../../store/packStore"
import { PropertyRow } from "../../ui/PropertyRow"
import { Select } from "../../ui/Select"
import { Slider } from "../../ui/Slider"
import { Switch } from "../../ui/Switch"
import { PACK_ART_BLENDS, PACK_ART_FITS } from "./pack-art-style"

export function PackArtStyleFields() {
  const { t } = useTranslation("editor")
  const style = usePackStore((s) => s.pack?.packArtStyle)
  const hasArt = usePackStore((s) => !!s.pack?.packArt)
  const update = usePackStore((s) => s.updatePackArtStyle)
  if (!style) return null

  const set = (patch: Partial<PackArtStyle>) => update(patch)
  const resetLabel = t("pack.cover.style.reset")

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="shrink-0 text-body font-medium text-foreground">
          {t("pack.cover.style.title")}
        </span>
        <button
          type="button"
          onClick={() => set({ ...DEFAULT_PACK_ART_STYLE })}
          className="h-5 shrink-0 rounded-control px-1.5 text-label text-muted hover:bg-elevated hover:text-foreground"
        >
          {t("pack.cover.style.resetAll")}
        </button>
      </div>
      {!hasArt && (
        <p className="px-2 pb-1 text-label leading-relaxed text-muted">
          {t("pack.cover.style.needArt")}
        </p>
      )}

      <PropertyRow label={t("pack.cover.style.blend")} grow>
        <Select
          grow
          value={style.blend}
          options={PACK_ART_BLENDS.map((blend) => ({
            value: blend,
            label: t(`pack.cover.style.blendValue.${blend}`),
          }))}
          onChange={(value) => set({ blend: value as PackArtBlend })}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.opacity")} grow reserveControlSpace>
        <Slider
          min={0}
          max={1}
          step={0.01}
          precision={2}
          value={style.opacity}
          onChange={(opacity) => set({ opacity })}
          defaultValue={DEFAULT_PACK_ART_STYLE.opacity}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.opacity")}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.packBrightness")} grow reserveControlSpace>
        <Slider
          min={0.2}
          max={2}
          precision={2}
          value={style.packBrightness}
          onChange={(packBrightness) => set({ packBrightness })}
          defaultValue={DEFAULT_PACK_ART_STYLE.packBrightness}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.packBrightness")}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.packContrast")} grow reserveControlSpace>
        <Slider
          min={0.2}
          max={2}
          precision={2}
          value={style.packContrast}
          onChange={(packContrast) => set({ packContrast })}
          defaultValue={DEFAULT_PACK_ART_STYLE.packContrast}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.packContrast")}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.packInvert")}>
        <Switch
          checked={style.packInvert}
          onChange={(packInvert) => set({ packInvert })}
          ariaLabel={t("pack.cover.style.packInvert")}
        />
      </PropertyRow>

      <PropertyRow label={t("pack.cover.style.fit")} grow>
        <Select
          grow
          value={style.fit}
          options={PACK_ART_FITS.map((fit) => ({
            value: fit,
            label: t(`pack.cover.style.fitValue.${fit}`),
          }))}
          onChange={(value) => set({ fit: value as PackArtFit })}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.x")} grow reserveControlSpace>
        <Slider
          min={0}
          max={100}
          step={1}
          precision={0}
          value={style.x}
          onChange={(x) => set({ x })}
          defaultValue={DEFAULT_PACK_ART_STYLE.x}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.x")}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.y")} grow reserveControlSpace>
        <Slider
          min={0}
          max={100}
          step={1}
          precision={0}
          value={style.y}
          onChange={(y) => set({ y })}
          defaultValue={DEFAULT_PACK_ART_STYLE.y}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.y")}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.artBrightness")} grow reserveControlSpace>
        <Slider
          min={0.2}
          max={2}
          precision={2}
          value={style.artBrightness}
          onChange={(artBrightness) => set({ artBrightness })}
          defaultValue={DEFAULT_PACK_ART_STYLE.artBrightness}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.artBrightness")}
        />
      </PropertyRow>
      <PropertyRow label={t("pack.cover.style.artSaturate")} grow reserveControlSpace>
        <Slider
          min={0}
          max={2}
          precision={2}
          value={style.artSaturate}
          onChange={(artSaturate) => set({ artSaturate })}
          defaultValue={DEFAULT_PACK_ART_STYLE.artSaturate}
          resetLabel={resetLabel}
          ariaLabel={t("pack.cover.style.artSaturate")}
        />
      </PropertyRow>
    </div>
  )
}
