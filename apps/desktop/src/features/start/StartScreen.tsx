/**
 * 启动屏：没有打开系列时的整窗内容。
 *
 * 应用名 + 「最近打开」+ 底部常驻「新建 / 打开」。底部按钮**常驻**是有意的——
 * 没有最近项时它就是唯一的入口。
 */
import { useTranslation } from "react-i18next"
import { FolderOpen, Plus } from "lucide-react"
import CardbaraLogo from "../../assets/cardbara-logo.svg?react"
import { newPackFlow, openPackFlow } from "../../app/packActions"
import { RecentList } from "./RecentList"

export function StartScreen() {
  const { t } = useTranslation("editor")
  const { t: tc } = useTranslation("common")

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 bg-app px-6">
      {/* logo + 字标组成一套品牌锁形：两者贴紧（gap-2.5）成一整体，再与下方「最近打开」拉开
          （外层 gap-5）。logo 用品牌绿 + 纸色的双色标；字标仍用 text-disabled，跟着主题走。 */}
      <div className="flex flex-col select-none items-center gap-2.5">
        {/* aria-label 取本地化的应用名（SVG 文件本身不带 aria-label）。 */}
        <CardbaraLogo
          className="h-16 w-auto"
          role="img"
          aria-label={tc("app.name")}
        />
        {/* 字标固定为拉丁文、任何语言下都不变，故不进 i18n（同 TitleBar 的 APP_BRAND）。
            aria-hidden：上方 logo 的 aria-label 已报出应用名，避免读屏重复念一遍。
            `-mr` 抵消 tracking 留在末字之后的空隙，否则整行进位会偏左一点。
            字标走系统字体，不启用加粗，保持与标题栏一致的观感。 */}
        <div
          aria-hidden="true"
          className="-mr-[0.15em] font-display text-2xl tracking-[0.15em] text-disabled"
        >
          Cardbara
        </div>
      </div>

      <RecentList />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void newPackFlow()}
          className="flex h-7 items-center gap-1.5 rounded-sm bg-accent px-3 text-[12px] text-accent-foreground hover:bg-accent-hover"
        >
          <Plus size={13} />
          {t("start.newPack")}
        </button>
        <button
          type="button"
          onClick={() => void openPackFlow()}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated"
        >
          <FolderOpen size={13} />
          {t("start.openPack")}
        </button>
      </div>
    </div>
  )
}
