/**
 * 标题栏右侧的设置图标：点开、再点关闭设置视图。
 *
 * 与菜单的 `app.settings` 同源——都走 `uiStore.setSettingsOpen`，两处不可能漂移。打开时按
 * `aria-pressed` 把图标提亮，让用户看得出当前正处在设置里（此刻标题栏仍在，布局图标已让位，
 * 见 `TitleBar`）。
 *
 * 悬停只提亮图标、不铺底色，与同行的 `LayoutControls` 保持一致的轻量观感。
 */
import { useTranslation } from "react-i18next"
import { Settings } from "lucide-react"
import { useUiStore } from "../../store/uiStore"
import { Tooltip } from "../../ui/Tooltip"

/** 设置图标按钮。 */
export function SettingsButton() {
  const { t } = useTranslation("settings")
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  return (
    <Tooltip label={t("title")}>
      <button
        type="button"
        aria-label={t("title")}
        // pressed 表示「设置视图正开着」，与图标提亮同一语义。
        aria-pressed={settingsOpen}
        onClick={() => setSettingsOpen(!settingsOpen)}
        className={`flex h-7 w-7 items-center justify-center rounded-control outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent/50 ${
          settingsOpen ? "bg-elevated text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        <Settings size={14} />
      </button>
    </Tooltip>
  )
}
