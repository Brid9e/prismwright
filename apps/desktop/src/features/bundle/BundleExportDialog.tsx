/**
 * 工程文件导出对话框（`.cards` / `.card`）。
 *
 * 对话框本身只负责「选路径 + 报结果」；打包与加密全在 Rust（`runBundleExport` 落盘后
 * 收集条目再交给 `bundleFs.export`）。这样前端永远拿不到明文 ZIP，也不会把素材读进
 * JS 内存——大系列导出不占渲染进程的内存。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { exportFs } from "../../tauri/export-fs"
import { DialogShell } from "../../ui/Dialog"
import { bundleFileName, formatBytes } from "./model"
import { runBundleExport } from "./runBundleExport"

export function BundleExportDialog() {
  const { t } = useTranslation("bundle")
  const request = useUiStore((s) => s.bundleExport)
  const close = useUiStore((s) => s.closeBundleExport)
  const pack = usePackStore((s) => s.pack)
  const rootDir = usePackStore((s) => s.rootDir)
  /** 正在导出：期间禁止重复提交、也不响应关闭。 */
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  // 每次弹出都回到干净状态：上一次的成功/失败提示不该跟着下一次出现。
  useEffect(() => {
    if (!request.open) return
    setBusy(false)
    setMessage("")
    setError("")
  }, [request.open])

  const kind = request.cardId ? "card" : "series"
  const card = request.cardId ? pack?.cards.find((c) => c.id === request.cardId) : null
  const displayName = kind === "card" ? (card?.name ?? "") : (pack?.name ?? "")

  async function confirm() {
    if (busy || !rootDir) return
    const path = await exportFs.pickSaveFile(bundleFileName(displayName, kind), [
      { name: t("filterName"), extensions: ["card", "cards"] },
    ])
    if (!path) return
    setBusy(true)
    setMessage("")
    setError("")
    try {
      const result = await runBundleExport(kind, request.cardId, path)
      setMessage(t("export.done", { path, size: formatBytes(result.bytes) }))
    } catch (e) {
      setError(t("export.failed", { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      open={request.open}
      title={kind === "card" ? t("export.titleCard") : t("export.titleSeries")}
      description={kind === "card" ? t("export.hintCard") : t("export.hintSeries")}
      // 导出中不允许 Esc / 点遮罩关闭：Rust 侧还在读文件，关掉对话框只会让用户
      // 以为操作被取消了，而实际上还在写盘。
      onClose={() => {
        if (!busy) close()
      }}
      className="w-96 p-3"
    >
      <p className="truncate text-[12px] text-foreground" title={displayName}>
        {displayName}
      </p>
      {message && <p className="mt-2 break-all text-[11px] text-muted">{message}</p>}
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
          disabled={busy || !rootDir}
          onClick={() => void confirm()}
          className="h-6 rounded-sm bg-accent px-3 text-[12px] text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("export.action")}
        </button>
      </div>
    </DialogShell>
  )
}
