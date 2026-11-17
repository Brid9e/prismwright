/**
 * 工程文件导入对话框：展示清单摘要，确认后交给对应的导入流程。
 *
 * 系列与单卡是两条路：系列装到磁盘上的新目录、整包替换当前工作区；单卡则并进当前
 * 系列（没有系列时按卡名新建）。对话框只负责分派与报错，真正的解包/落盘在各
 * `import*` 模块里。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"
import { formatBundleError } from "./bundleActions"
import { importCardBundle } from "./importCard"
import { importSeriesBundle } from "./importSeries"
import { formatBytes } from "./model"

export function BundleImportDialog() {
  const { t } = useTranslation("bundle")
  const request = useUiStore((s) => s.bundleImport)
  const close = useUiStore((s) => s.closeBundleImport)
  const newPackDir = useUiStore((s) => s.newPackDir)
  const hasPack = usePackStore((s) => s.pack !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!request.open) return
    setBusy(false)
    setError("")
  }, [request.open])

  const info = request.info
  const isSeries = info?.kind === 2

  async function confirm() {
    if (busy || !info || !request.sourcePath) return
    setBusy(true)
    setError("")
    try {
      if (info.kind === 2) {
        await importSeriesBundle(request.sourcePath, info.manifest, newPackDir)
      } else {
        await importCardBundle(request.sourcePath, info.manifest)
      }
      close()
    } catch (e) {
      // 失败就地显示、保留对话框：用户可能选错了文件，重选比重新走一遍菜单更顺。
      setError(formatBundleError(e))
    } finally {
      setBusy(false)
    }
  }

  const detail = !info
    ? ""
    : info.kind === 2
      ? t("import.seriesDetail", {
          name: info.manifest.series?.name ?? "",
          cards: info.manifest.series?.cardCount ?? 0,
        })
      : t("import.cardDetail", {
          name: info.manifest.card?.name ?? "",
          series: info.manifest.series?.name ?? "",
        })

  const hint = isSeries
    ? t("import.hintSeries")
    : hasPack
      ? t("import.hintCard")
      : t("import.hintCardNewPack")

  return (
    <DialogShell
      open={request.open}
      title={t("import.title")}
      onClose={() => {
        if (!busy) close()
      }}
      className="w-96 p-3"
    >
      <p className="truncate text-[12px] text-foreground" title={detail}>
        {detail}
      </p>
      {info && (
        <p className="mt-1 text-[11px] text-muted">
          {t("import.size", { size: formatBytes(info.size) })}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{hint}</p>
      {error && <p className="mt-2 break-all text-[11px] text-danger">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={close}
          className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("common:action.cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !info}
          onClick={() => void confirm()}
          className="h-6 rounded-sm bg-accent px-3 text-[12px] text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("import.action")}
        </button>
      </div>
    </DialogShell>
  )
}
