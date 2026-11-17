/**
 * 设置视图：在编辑器**正文**内打开的整页设置（取代原模态框）。
 *
 * 它不是浮层：由 `App` 在正文里按 `uiStore.settingsOpen` 整块替换渲染，占满标题栏以下的
 * 区域——与「有系列 ? 三栏编辑器 : 起始页」同一处编排，故从起始页也能进入。正文**居中、
 * 最宽 1100px**，字号比紧凑的参数面板大一号；顶部一行是大字标题 + 返回按钮，不加分割线。
 * 左侧分类导航带一条竖向分割线与内容分开，分类是**数组驱动**的（见 `CATEGORIES`），后续加
 * 「编辑器」等只需往数组里添项。退出走返回按钮，或任意焦点下的全局 Esc（见 `app/shortcuts.ts`）。
 *
 * 设置属应用偏好、不是系列数据，故**不进撤销历史**，也不碰 `packStore`。
 * 语言切换的副作用（i18next + 落盘）由 `App` 的语言 effect 统一承担。
 */
import { useTranslation } from "react-i18next"
import { ArrowLeft } from "lucide-react"
import { EDITOR_VERSION_IDS, isEditorVersion } from "../../app/editorVersions"
import { editDefaultBackFlow } from "../../app/defaultBack"
import { chooseNewPackDir } from "../../app/packActions"
import { isLanguage, SUPPORTED_LANGUAGES } from "../../i18n/init"
import { useUiStore, type SettingsCategory } from "../../store/uiStore"
import { Select } from "../../ui/Select"
import { AppearancePanel } from "./AppearancePanel"

/**
 * 设置分类清单。`labelKey` 指向 `settings` 命名空间下的文案键，避免在这里硬编码
 * 已翻译文本而绕开 i18n 的响应式切换。
 */
const CATEGORIES = [
  { id: "general", labelKey: "category.general" },
  { id: "appearance", labelKey: "category.appearance" },
] as const satisfies readonly { id: SettingsCategory; labelKey: string }[]

export function SettingsView() {
  const { t } = useTranslation("settings")
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)
  const editorVersion = useUiStore((s) => s.editorVersion)
  const setEditorVersion = useUiStore((s) => s.setEditorVersion)
  const newPackDir = useUiStore((s) => s.newPackDir)
  // 分类放在 uiStore：发布对话框的「去设置」要能直接落到「云开发」。
  const category = useUiStore((s) => s.settingsCategory)
  const setCategory = useUiStore((s) => s.setSettingsCategory)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app text-foreground">
      {/* 大字标题 + 返回按钮。内层与正文同宽同心，读起来标题落在正文左缘上；不加分割线。 */}
      <header className="flex h-10 shrink-0 items-center px-4">
        <div className="mx-auto flex w-full max-w-[1100px] items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            // 提示回落到编辑器；用 aria-label 而非可见文字，保持标题行紧凑。
            aria-label={t("back")}
            title={t("back")}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="select-none text-[15px] font-medium text-foreground">{t("title")}</span>
        </div>
      </header>

      {/* 正文居中、最宽 1100px；内层撑满高度，好让左侧栏的分割线通体到底。 */}
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pb-4">
        <div className="flex w-full max-w-[1100px]">
          <nav className="w-32 shrink-0 border-r border-border pr-2" aria-label={t("title")}>
            {CATEGORIES.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-[13px] ${
                  category === id
                    ? "bg-accent/20 text-foreground"
                    : "text-muted hover:bg-elevated hover:text-foreground"
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 pl-6">
            {category === "general" ? (
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <span className="shrink-0 text-[13px] text-muted">{t("language.label")}</span>
                  <Select
                    value={language}
                    options={SUPPORTED_LANGUAGES.map((value) => ({
                      value,
                      label: t(`language.${value}`),
                    }))}
                    onChange={(value) => {
                      // Select 回调的值是宽 `string`；经类型守卫收窄为 `Language`，避免不安全断言。
                      if (isLanguage(value)) setLanguage(value)
                    }}
                  />
                </div>
                {/* 编辑器版本：编辑器与渲染器成套发布，当前只有 v1；选择暂不改变行为。 */}
                <div>
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <span className="shrink-0 text-[13px] text-muted">
                      {t("editorVersion.label")}
                    </span>
                    <Select
                      value={editorVersion}
                      options={EDITOR_VERSION_IDS.map((value) => ({
                        value,
                        label: t(`editorVersion.${value}`),
                      }))}
                      onChange={(value) => {
                        // Select 回调的值是宽 `string`；守卫收窄，避免越界值写进偏好。
                        if (isEditorVersion(value)) setEditorVersion(value)
                      }}
                    />
                  </div>
                  <p className="py-1 text-[12px] text-muted">{t("editorVersion.hint")}</p>
                </div>
                {/* 新建系列的落盘基目录：新建流程不再弹目录框，全靠这里的值。 */}
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <span className="shrink-0 text-[13px] text-muted">{t("newPackDir.label")}</span>
                  <div className="flex min-w-0 items-center gap-1">
                    <span
                      className="min-w-0 max-w-[420px] truncate text-[13px] text-foreground"
                      title={newPackDir}
                    >
                      {newPackDir || "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void chooseNewPackDir()}
                      className="shrink-0 rounded-sm border border-border-subtle px-2 py-1 text-[13px] text-foreground hover:bg-elevated"
                    >
                      {t("newPackDir.choose")}
                    </button>
                  </div>
                </div>
                {/* 全系列共用的默认卡背：进入编辑 = 打开应用数据目录里那份工程（见 app/defaultBack）。 */}
                <div>
                  <div className="flex items-center justify-between gap-2 py-1.5">
                    <span className="shrink-0 text-[13px] text-muted">{t("defaultBack.label")}</span>
                    <button
                      type="button"
                      onClick={() => void editDefaultBackFlow(t("defaultBack.name"))}
                      className="shrink-0 rounded-sm border border-border-subtle px-2 py-1 text-[13px] text-foreground hover:bg-elevated"
                    >
                      {t("defaultBack.edit")}
                    </button>
                  </div>
                  <p className="py-1 text-[12px] text-muted">{t("defaultBack.hint")}</p>
                </div>
              </div>
            ) : category === "appearance" ? (
              <AppearancePanel />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
