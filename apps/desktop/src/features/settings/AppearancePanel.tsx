/**
 * 外观设置面板：主题下拉选择 + 导入主题。
 *
 * 主题用编辑器统一的 {@link Select}（Radix 下拉，非原生 `<select>`，理由见 ui/Select）单选切换：
 * `selectedId` 即当前选中项，改动即调 `themeStore.select`。切换是即时的——整个编辑器随之变色，
 * 本身就是最直观的预览，故不再另设色板缩略。下拉按内容自适应宽度、行内右对齐，不撑满整行。
 *
 * 错误提示走 `errors` 命名空间（`themeInvalid` / `themeConflict` / `themeImportFailed`），
 * 由 store 给出的 key 决定，`message` 填进 `{{message}}`。
 */
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useThemeStore } from "../../store/themeStore"
import { useUiStore } from "../../store/uiStore"
import { themeDisplayName } from "../../themes/registry"
import { Select } from "../../ui/Select"

/** 外观面板。 */
export function AppearancePanel() {
  const { t } = useTranslation("settings")
  const { t: tErr } = useTranslation("errors")
  const themes = useThemeStore((s) => s.themes)
  const selectedId = useThemeStore((s) => s.selectedId)
  const importError = useThemeStore((s) => s.importError)
  const select = useThemeStore((s) => s.select)
  const importFromFile = useThemeStore((s) => s.importFromFile)
  const clearImportError = useThemeStore((s) => s.clearImportError)
  const language = useUiStore((s) => s.language)

  // 打开面板即清掉上一次的导入错误：本面板是错误唯一的展示处，留着它会在关闭设置再打开后
  // 显示一条早已过时的报错（错误应是一次导入尝试的即时反馈，不该跨次残留）。
  useEffect(() => {
    clearImportError()
  }, [clearImportError])

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 py-1.5">
        <span className="shrink-0 text-[13px] text-muted">{t("appearance.title")}</span>
        <div className="flex min-w-0 items-center gap-1">
          <Select
            value={selectedId}
            options={themes.map((theme) => ({
              value: theme.meta.id,
              label: themeDisplayName(theme.meta, t, language),
            }))}
            onChange={(id) => void select(id)}
          />
          <button
            type="button"
            onClick={() => void importFromFile()}
            className="shrink-0 rounded-sm border border-border-subtle px-2 py-1 text-[13px] text-foreground hover:bg-elevated"
          >
            {t("appearance.import")}
          </button>
        </div>
      </div>

      {importError && (
        <p className="pt-1 text-[11px] text-danger">
          {tErr(importError.key, { message: importError.message ?? "" })}
        </p>
      )}
    </div>
  )
}
