/**
 * 启动屏的「最近打开」列表。
 *
 * 进入即探测各条是否仍有效（目录被移动/删除就置灰），并提供逐条手动移除——
 * 外接盘没挂载时不该把记录自动删掉，故只置灰、删不删由用户决定。
 */
import { useEffect } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { openRecentFlow } from "../../app/packActions"
import { formatRelativeTime, type RelativeTime } from "../../app/relativeTime"
import { useRecentStore } from "../../store/recentStore"

/** 把相对时间描述子翻成当前语言的文案。 */
function relativeLabel(rt: RelativeTime, t: TFunction): string {
  switch (rt.kind) {
    case "today":
      return t("start.today")
    case "yesterday":
      return t("start.yesterday")
    case "daysAgo":
      return t("start.daysAgo", { days: rt.days })
    case "date":
      // 具体日期不含语言成分，直接用。
      return rt.text
  }
}

export function RecentList() {
  const { t } = useTranslation("editor")
  const { t: tc } = useTranslation("common")
  const recent = useRecentStore((s) => s.recent)
  const missing = useRecentStore((s) => s.missing)
  const remove = useRecentStore((s) => s.remove)

  // 列表一变就重新探测：新加入的条目也要过一遍有效性。
  useEffect(() => {
    void useRecentStore.getState().probeMissing()
  }, [recent])

  if (recent.length === 0) {
    return <p className="text-[12px] text-muted">{t("start.empty")}</p>
  }

  const now = Date.now()
  return (
    <div className="flex w-80 flex-col gap-1">
      <div className="select-none px-1 text-[10px] font-medium uppercase tracking-wide text-disabled">
        {tc("menu.recent")}
      </div>
      {recent.map((r) => {
        const gone = missing[r.rootDir] === true
        return (
          <div
            key={r.rootDir}
            className="group flex items-center gap-2 rounded-sm border border-border px-2 py-1.5"
          >
            <button
              type="button"
              disabled={gone}
              onClick={() => void openRecentFlow(r.rootDir)}
              title={r.rootDir}
              className={`min-w-0 flex-1 text-left ${
                gone ? "cursor-default" : "hover:text-accent"
              }`}
            >
              <span
                className={`block truncate text-[12px] ${gone ? "text-disabled" : "text-foreground"}`}
              >
                {r.name}
              </span>
              <span className="block truncate text-[10px] text-muted">
                {
                  // 失效项的主按钮是 disabled、进不了 Tab 序，若只靠 title 提示路径会让
                  // 键盘/触屏用户无从知道它指向哪，故在副标签里显式带上路径（truncate 让长路径省略）。
                  gone
                    ? `${t("start.missing")} · ${r.rootDir}`
                    : relativeLabel(formatRelativeTime(r.openedAt, now), t)
                }
              </span>
            </button>
            <button
              type="button"
              aria-label={t("start.remove")}
              onClick={() => void remove(r.rootDir)}
              // 隐藏用 opacity 而不是 hidden：仍然要让 × 留在 Tab 序里可键盘触达；
              // 但纯 opacity-0 会让键盘用户 Tab 到一个「看不见」的按钮，故补 focus-visible:opacity-100
              // 让它在获得键盘焦点时显形（并保留浏览器默认焦点环），悬停行为不变。
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted opacity-0 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
