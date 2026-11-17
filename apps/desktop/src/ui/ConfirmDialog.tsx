/**
 * 破坏性操作的确认对话框。
 *
 * 外壳（遮罩 / 定位 / Esc）来自 `DialogShell`；本组件只负责标题、正文与两个按钮。
 */
import { DialogShell } from "./Dialog"

export interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  /** 确认按钮是否用危险色（删除类操作为真）。 */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <DialogShell open={open} title={title} description={body} onClose={onCancel}>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          autoFocus={destructive}
          onClick={onCancel}
          className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          autoFocus={!destructive}
          onClick={onConfirm}
          className={`h-6 rounded-sm px-3 text-[12px] text-accent-foreground ${
            destructive ? "bg-danger hover:opacity-90" : "bg-accent hover:bg-accent-hover"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  )
}
