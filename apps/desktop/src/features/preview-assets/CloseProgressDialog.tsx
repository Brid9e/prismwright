/**
 * 关闭前的预览生成进度弹窗。
 *
 * 关窗时若预览流水线仍在为变更过的卡片生成资产（见 {@link ./pipeline}），直接放行会让产物
 * 写到一半被进程退出腰斩。故此时先拦下关闭、弹出本框显示「已完成 / 总数」，等队列跑空再真正关闭。
 *
 * 刻意**不**提供 Esc / 点遮罩关闭：关窗的意图已经明确，此时撤下弹窗只会让用户对「到底关没关」
 * 产生困惑。真正需要中途脱身的场景由「强制关闭」按钮承担——万一编码卡死，用户不至于被锁在一个
 * 关不掉的窗口里（丢一次生成可重来，关不掉的窗口不可接受）。
 */
import { useTranslation } from "react-i18next"
import { DialogShell } from "../../ui/Dialog"
import type { PreviewProgress } from "./pipeline"

export interface CloseProgressDialogProps {
  /** 是否显示。 */
  open: boolean
  /** 当前进度；`null` 时按 0 / 0 渲染（弹窗刚打开、首个进度尚未到达）。 */
  progress: PreviewProgress | null
  /** 用户点击「强制关闭」：放弃等待，立即关闭。 */
  onForceClose: () => void
}

export function CloseProgressDialog({ open, progress, onForceClose }: CloseProgressDialogProps) {
  const { t } = useTranslation("editor")
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0

  return (
    <DialogShell
      open={open}
      title={t("closing.title")}
      // 关窗意图已定，Esc / 遮罩一律忽略；脱身只走下方的「强制关闭」。
      onClose={() => {}}
      className="w-80 p-3"
    >
      <p className="text-[12px] leading-relaxed text-muted">{t("closing.body", { done, total })}</p>
      {/* 不确定进度条：单张卡要渲 60 帧、耗时不均，逐卡推进的定值条只会一顿一顿地跳；
          用「色带反复扫过」的加载式动画，进度感交给下方的 `已完成 / 总数` 文字。 */}
      <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div className="h-full w-full animate-indeterminate rounded-full bg-accent" />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onForceClose}
          className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated"
        >
          {t("closing.force")}
        </button>
      </div>
    </DialogShell>
  )
}
