/**
 * 新建系列对话框：输入系列名。
 *
 * 新建只需输名字——落盘目录由设置在启动时解析好的**默认目录**决定（见
 * `app/packDir.ts`），用户不再碰原生目录框。名字下方的「位置」行只读展示它将被建到
 * 哪个目录下，免去「建了却找不到」的困惑。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { confirmNewPack } from "../../app/packActions"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"

export function NewPackDialog() {
  const { t } = useTranslation("editor")
  const pending = useUiStore((s) => s.pendingNewPack)
  const resolveNewPack = useUiStore((s) => s.resolveNewPack)
  const [name, setName] = useState("")
  /** 正在落盘：期间禁止再次提交，避免回车连按触发两次新建。 */
  const [busy, setBusy] = useState(false)

  // 每次弹出都从空名字起步：用户输入的是新系列名，复用上一次的值只会添乱。
  useEffect(() => {
    setName("")
    setBusy(false)
  }, [pending])

  const trimmed = name.trim()

  async function confirm() {
    if (!pending || trimmed === "" || busy) return
    setBusy(true)
    try {
      // 成功才关窗：名字非法 / 同名目录已存在时保持弹窗开启，留住用户已输入的名字。
      if (await confirmNewPack(pending.baseDir, trimmed)) resolveNewPack()
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      open={pending !== null}
      title={t("pack.nameLabel")}
      onClose={resolveNewPack}
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
      <div className="mt-2 flex items-baseline gap-1.5 text-[11px] text-muted">
        <span className="shrink-0">{t("pack.location")}</span>
        <span className="min-w-0 flex-1 truncate" title={pending?.baseDir}>
          {pending?.baseDir}
        </span>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={resolveNewPack}
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
