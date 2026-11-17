/**
 * 标题栏右侧的布局图标：切换左 / 右栏的显示与隐藏。
 *
 * VSCode 式：两个图标，点击显隐对应的一栏。动作与「视图」菜单的 `view.left` /
 * `view.right` 同源——都走 `uiStore.toggleCollapsed`，两处不可能漂移。
 *
 * 图标随栏状态变化：栏隐藏时压暗（`text-disabled` 再叠 `opacity`，比常规灰更深一档），
 * 与 VSCode「切掉的那一栏图标变灰」一致；tooltip 与 `aria-label` 也随状态切换
 * （「隐藏系列栏」↔「显示系列栏」）。
 *
 * 悬停只提亮图标本身，不给按钮铺底色——这两个是标题栏里的小控件，底色块会显得重。
 */
import { useTranslation } from "react-i18next"
import { PanelLeft, PanelRight } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useUiStore } from "../../store/uiStore"
import { Tooltip } from "../../ui/Tooltip"

/** 一侧的布局按钮配置。 */
interface LayoutSide {
  side: "left" | "right"
  icon: LucideIcon
  /** 该栏文案的 i18n key（带命名空间前缀）。 */
  labelKey: { show: string; hide: string }
}

const SIDES: LayoutSide[] = [
  {
    side: "left",
    icon: PanelLeft,
    labelKey: { show: "common:menu.showLeft", hide: "common:menu.hideLeft" },
  },
  {
    side: "right",
    icon: PanelRight,
    labelKey: { show: "common:menu.showRight", hide: "common:menu.hideRight" },
  },
]

/** 布局图标组。 */
export function LayoutControls() {
  const { t } = useTranslation()
  const collapsed = useUiStore((s) => s.collapsed)
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)

  return (
    <>
      {SIDES.map(({ side, icon: Icon, labelKey }) => {
        // 隐藏时按钮的提示要变成「显示」（此刻点击会把它显示出来）。
        const hidden = collapsed[side]
        const label = t(hidden ? labelKey.show : labelKey.hide)
        return (
          <Tooltip key={side} label={label}>
            <button
              type="button"
              aria-label={label}
              // pressed 表示「该栏当前被切掉」，与图标变暗同一语义。
              aria-pressed={hidden}
              onClick={() => toggleCollapsed(side)}
              className={`flex h-full w-6 items-center justify-center ${
                hidden
                  ? "text-disabled opacity-60 hover:text-muted hover:opacity-100"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon size={14} />
            </button>
          </Tooltip>
        )
      })}
    </>
  )
}
