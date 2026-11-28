/**
 * 导出对话框：把「格式 + 尺寸 + 帧率 + 质量 + 背景」编排成一次导出。
 *
 * 打开由菜单驱动（预选格式），参数在此编辑；点「导出」先弹系统「另存为」选路径，拿到路径后跑
 * {@link runExport}，框内显示进度；成功给出路径提示、失败给出错误。导出进行中禁止关闭（避免帧
 * 写到一半）。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { findCard, usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"
import { NumberField } from "../../ui/NumberField"
import { PropertyRow } from "../../ui/PropertyRow"
import { Select } from "../../ui/Select"
import { Slider } from "../../ui/Slider"
import { Switch } from "../../ui/Switch"
import { exportFs } from "../../tauri/export-fs"
import { createResolveAsset } from "../preview/resolve-asset"
import type { PreviewAssetsHandle } from "../preview-assets/pipeline"
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FPS_OPTIONS,
  EXPORT_SIZE_PRESETS,
  exportFileName,
  saveFilters,
  type ExportFormat,
  type ExportOptions,
} from "./exportOptions"
import { runExport, type ExportProgress } from "./runExport"

export interface ExportDialogProps {
  /** 后台预览流水线句柄；导出前等它跑空。`null` 时跳过等待。 */
  previews: PreviewAssetsHandle | null
}

export function ExportDialog({ previews }: ExportDialogProps) {
  const { t } = useTranslation("export")
  const open = useUiStore((s) => s.exportDialog.open)
  const closeExportDialog = useUiStore((s) => s.closeExportDialog)
  const markMissing = useUiStore((s) => s.markMissing)
  const pack = usePackStore((s) => s.pack)
  const rootDir = usePackStore((s) => s.rootDir)
  const selectedCardId = usePackStore((s) => s.selectedCardId)

  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS)
  /** 导出进行中：禁止关闭与再次提交。 */
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 只在「打开」这条边上重置一次，并把当时菜单预选的格式读进来：上一次的选择不该污染下一次。
  // 刻意**不**依赖 `exportDialog.format`——导出进行中从原生菜单（在 Radix 遮罩之外，仍可点）切格式会
  // 重跑本效果、把 busy 清掉、放行第二次导出，而两次导出共用同一个帧目录（见 paths.ts）→ 互相踩帧。
  useEffect(() => {
    if (!open) return
    const { format } = useUiStore.getState().exportDialog
    setOptions({ ...DEFAULT_EXPORT_OPTIONS, format })
    setBusy(false)
    setProgress(null)
    setMessage(null)
    setError(null)
  }, [open])

  const card = findCard(pack, selectedCardId)
  const patch = (part: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...part }))

  async function run() {
    if (!card || !pack || !rootDir || busy) return
    setBusy(true)
    setProgress(null)
    setMessage(null)
    setError(null)
    try {
      const path = await exportFs.pickSaveFile(
        exportFileName(card.name, options.format),
        saveFilters(options.format),
      )
      // 用户在「另存为」里取消：静默收场，保留参数供再试。
      if (path === null) return
      const resolveAsset = createResolveAsset({ rootDir, onMissing: markMissing })
      await runExport({
        card,
        aspect: pack.aspect,
        rootDir,
        resolveAsset,
        options,
        outPath: path,
        onProgress: setProgress,
        waitForPreviewIdle: () => previews?.idle() ?? Promise.resolve(),
      })
      setMessage(t("done", { path }))
    } catch (e) {
      setError(t("failed", { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const sizeValue = (EXPORT_SIZE_PRESETS as readonly number[]).includes(options.width)
    ? String(options.width)
    : "custom"
  const pct = progress && progress.total ? (progress.done / progress.total) * 100 : 0

  return (
    <DialogShell
      open={open}
      title={t("title")}
      // 导出进行中不放行关闭：帧写到一半被撤下会留下残帧。
      onClose={() => {
        if (!busy) closeExportDialog()
      }}
      className="w-96 p-3"
    >
      <div className="flex flex-col gap-0.5">
        <PropertyRow label={t("format")} grow>
          <Select
            grow
            value={options.format}
            options={[
              { value: "gif", label: t("formatGif") },
              { value: "png", label: t("formatPng") },
              { value: "webm", label: t("formatWebm") },
            ]}
            onChange={(v) => patch({ format: v as ExportFormat })}
          />
        </PropertyRow>

        <PropertyRow label={t("size")} grow>
          <Select
            grow
            value={sizeValue}
            options={[
              ...EXPORT_SIZE_PRESETS.map((w) => ({ value: String(w), label: String(w) })),
              { value: "custom", label: t("sizeCustom") },
            ]}
            onChange={(v) => patch({ width: v === "custom" ? options.width : Number(v) })}
          />
          <NumberField
            value={options.width}
            min={64}
            max={4096}
            step={1}
            precision={0}
            onChange={(w) => patch({ width: w })}
          />
        </PropertyRow>

        {options.format !== "png" && (
          <PropertyRow label={t("fps")} grow>
            <Select
              grow
              value={String(options.fps)}
              options={EXPORT_FPS_OPTIONS.map((f) => ({ value: String(f), label: String(f) }))}
              onChange={(v) => patch({ fps: Number(v) })}
            />
          </PropertyRow>
        )}

        {options.format === "gif" && (
          <>
            <PropertyRow label={t("gifColors")} grow>
              <Slider
                value={options.gifColors}
                min={2}
                max={256}
                step={1}
                precision={0}
                ariaLabel={t("gifColors")}
                onChange={(v) => patch({ gifColors: Math.round(v) })}
              />
            </PropertyRow>
            <PropertyRow label={t("gifDither")}>
              <Switch
                checked={options.gifDither}
                ariaLabel={t("gifDither")}
                onChange={(b) => patch({ gifDither: b })}
              />
            </PropertyRow>
          </>
        )}

        {options.format === "webm" && (
          <PropertyRow label={t("webmCrf")} grow>
            <Slider
              value={options.webmCrf}
              min={0}
              max={63}
              step={1}
              precision={0}
              ariaLabel={t("webmCrf")}
              onChange={(v) => patch({ webmCrf: Math.round(v) })}
            />
          </PropertyRow>
        )}

        <PropertyRow label={t("background")}>
          <Switch
            checked={options.background === "transparent"}
            ariaLabel={t("transparent")}
            // 背景色是写进导出像素的**数据**而非主题色，没有语义 token 可对应（同 colors.ts 的豁免立场），
            // 故此处对「禁止硬编码色值」规则做定点豁免，值必须保持为合法 hex。
            // eslint-disable-next-line no-restricted-syntax
            onChange={(b) => patch({ background: b ? "transparent" : "#000000" })}
          />
          <span className="text-label text-muted">{t("transparent")}</span>
          {options.background !== "transparent" && (
            <input
              type="color"
              value={options.background}
              aria-label={t("background")}
              onChange={(e) => patch({ background: e.target.value })}
              className="h-6 w-8 shrink-0 rounded-control border border-line bg-sunken"
            />
          )}
        </PropertyRow>
        {options.format === "gif" && options.background === "transparent" && (
          <p className="px-2 pb-1 text-label leading-relaxed text-muted">{t("transparentHint")}</p>
        )}
      </div>

      {busy && progress && (
        <div className="mt-2 px-2">
          <div className="text-label text-muted">
            {t("progress", { done: progress.done, total: progress.total })}
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      {message && (
        <p className="mt-2 truncate px-2 text-label text-accent" title={message}>
          {message}
        </p>
      )}
      {error && <p className="mt-2 px-2 text-label text-danger">{error}</p>}
      {!card && <p className="mt-2 px-2 text-label text-muted">{t("noCard")}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={closeExportDialog}
          className="h-6 rounded-control border border-line-soft px-3 text-body text-foreground hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("common:action.cancel")}
        </button>
        <button
          type="button"
          disabled={!card || !rootDir || busy}
          onClick={() => void run()}
          className="h-6 rounded-control bg-accent px-3 text-body text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("export")}
        </button>
      </div>
    </DialogShell>
  )
}
