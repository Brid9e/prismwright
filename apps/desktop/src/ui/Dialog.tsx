/**
 * 共用模态框外壳。
 *
 * 基于 Radix Dialog：遮罩、Esc 关闭、焦点陷阱都由它保证。`ConfirmDialog` /
 * `NewPackDialog` 共用本壳，避免两处各写一遍遮罩与定位。
 */
import type { ReactNode } from "react"
import * as Dialog from "@radix-ui/react-dialog"

export interface DialogShellProps {
  open: boolean
  /** 标题文本（调用方负责翻译）。 */
  title: string
  /**
   * 请求关闭（Esc / 点遮罩）。
   */
  onClose: () => void
  /**
   * 可选的说明文本。传入时会渲染成 `Dialog.Description`，供屏幕阅读器朗读。
   *
   * 不传时本壳不会渲染 `Description`，而是显式把 `aria-describedby` 置为 `undefined`，
   * 声明「本模态确实没有说明」。这是 Radix 官方的约定写法：旧版 Radix 在既无
   * `Dialog.Description`、又无 `aria-describedby` 时会打开发警告，显式置 `undefined`
   * 可静默；当前锁定的 1.2.0 已不再告警，此处仍按约定书写以兼容版本升降。像设置、
   * 新建系列这类只有标题没有正文的弹窗即可不传。
   */
  description?: ReactNode
  /**
   * 面板的尺寸/内边距类。
   *
   * 注意：一旦传入就会**整体替换**默认值 `w-80 p-3`（而非合并），因此调用方
   * 必须同时把宽度与内边距都写全；留空则回落到默认的窄面板。
   */
  className?: string
  children: ReactNode
}

export function DialogShell({
  open,
  title,
  onClose,
  description,
  className,
  children,
}: DialogShellProps) {
  // 同时排除 undefined 与 null：调用方显式传 `description={null}` 视同「无说明」。
  const hasDescription = description !== undefined && description !== null
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim/60" />
        <Dialog.Content
          // 无说明时显式声明 aria-describedby={undefined}，抑制 Radix 的缺说明警告（见 description 注释）；
          // 有说明时交给 Radix 自动把 Description 关联到 aria-describedby，故不传该属性。
          {...(hasDescription ? null : { "aria-describedby": undefined })}
          className={`fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-sm border border-border-strong bg-panel shadow-xl ${
            className ?? "w-80 p-3"
          }`}
        >
          <Dialog.Title className="mb-2 text-[13px] font-medium text-foreground">
            {title}
          </Dialog.Title>
          {hasDescription ? (
            <Dialog.Description className="mb-3 text-[12px] leading-relaxed text-muted">
              {description}
            </Dialog.Description>
          ) : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
