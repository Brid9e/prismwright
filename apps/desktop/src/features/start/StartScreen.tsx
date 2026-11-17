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
      {/* logo 单独放，下面不再带字标；外层 gap-5 把标与「最近打开」拉开。 */}
      <div className="select-none">
        {/* aria-label 取本地化的应用名（SVG 文件本身不带 aria-label）。 */}
        <CardbaraLogo
          className="h-16 w-auto"
          role="img"
          aria-label={tc("app.name")}
        />
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
