/**
 * 顶栏右侧的布局切换：工作室 / 专注 / 紧凑。
 *
 * 三个模式是同一套面板的不同配比（见 `app/layoutMode.ts`）：工作室两侧都开，专注收掉
 * 左栏放大预览，紧凑把左栏压成缩略图条。与「视图」菜单的显隐同源——`setLayout` 会一并
 * 设置 `collapsed`，所以切换模式后菜单里的勾选状态仍然正确。
 */
import { useTranslation } from "react-i18next"
import { Columns2, Maximize2, PanelLeft } from "lucide-react"
import type { LayoutMode } from "../../app/layoutMode"
import { useUiStore } from "../../store/uiStore"
import { Segmented } from "../../ui/Segmented"

const OPTIONS = [
  { value: "studio", icon: Columns2, labelKey: "layout.studio" },
  { value: "focus", icon: Maximize2, labelKey: "layout.focus" },
  { value: "compact", icon: PanelLeft, labelKey: "layout.compact" },
] as const

/** 布局模式切换。 */
export function LayoutControls() {
  const { t } = useTranslation("editor")
  const layout = useUiStore((s) => s.layout)
  const setLayout = useUiStore((s) => s.setLayout)

  return (
    <Segmented
      value={layout}
      ariaLabel={t("layout.label")}
      onChange={(value) => setLayout(value as LayoutMode)}
      options={OPTIONS.map(({ value, icon, labelKey }) => ({
        value,
        icon,
        label: "",
        ariaLabel: t(labelKey),
      }))}
    />
  )
}
