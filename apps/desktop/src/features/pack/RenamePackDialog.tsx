/**
 * 重命名系列对话框：只改显示名（`pack.json` 的 `name`），磁盘目录不动。
 *
 * 系列身份靠 `pack.id`，目录名只是新建时顺手取的名字，故两者不必一致——对话框下方
 * 明说这一点，免去「改完去文件夹里找不到」的困惑。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { confirmRenamePack } from "../../app/packActions"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"

export function RenamePackDialog() {
  const { t } = useTranslation("editor")
  const open = useUiStore((s) => s.pendingRenamePack)
  const resolve = useUiStore((s) => s.resolveRenamePack)
  const [name, setName] = useState("")
  /** 正在落盘：期间禁止再次提交，避免回车连按触发两次改名。 */
  const [busy, setBusy] = useState(false)

  // 每次弹出都从当前名字起步：改名是在原名上微调，不该从空框开始。
  // 只在打开时刻取一次 store 里的名字，避免打开期间外部改动（如撤销）把输入冲掉。
  useEffect(() => {
    if (!open) return
    setName(usePackStore.getState().pack?.name ?? "")
    setBusy(false)
  }, [open])

  const trimmed = name.trim()

  async function confirm() {
    if (!open || trimmed === "" || busy) return
    setBusy(true)
    try {
      // 成功才关窗：系列在对话框开着时被关掉等失败情形，留住输入让用户重试。
      if (await confirmRenamePack(trimmed)) resolve()
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      open={open}
      title={t("pack.renameTitle")}
      onClose={resolve}
      className="w-80 p-3"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void confirm()
        }}
        className="h-6 w-full rounded-sm border border-border bg-sunken px-1.5 text-[12px] outline-none focus:border-accent"
      />
      <p className="mt-2 text-[11px] text-muted">{t("pack.renameHint")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={resolve}
          className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated"
        >
          {t("common:action.cancel")}
        </button>
        <button
          type="button"
          disabled={trimmed === "" || busy}
          onClick={() => void confirm()}
          className="h-6 rounded-sm bg-accent px-3 text-[12px] text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("common:action.confirm")}
        </button>
      </div>
    </DialogShell>
  )
}
