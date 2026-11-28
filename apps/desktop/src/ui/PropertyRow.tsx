/**
 * 属性行：左标签 + 右控件。
 *
 * 编辑器里几十个参数都长这样，统一成一个组件才能保证标签宽度、行高、间隔一致。
 */
import type { ReactNode } from "react"

export interface PropertyRowProps {
  /** 标签文本（调用方负责翻译）。 */
  label: string
  /** 右侧控件。 */
  children: ReactNode
  /** 控件区是否撑满（滑杆/输入框用）；`false` 时按内容宽度右对齐（开关/下拉用）。 */
  grow?: boolean
  /**
   * 控件区的最小宽度保护：窄面板下优先压缩标签，而不是裁掉控件。
   *
   * 给内含「不可再压缩」控件的行用（如带复位图标的滑杆：数字框 4rem + 图标 1.25rem + 间距
   * 在 flex 里都设了 shrink-0）。不开启时控件区仍是 `min-w-0`，让长文本自行 truncate——两者
   * 的取舍见下面容器上的注释。
   */
  reserveControlSpace?: boolean
}

export function PropertyRow({
  label,
  children,
  grow = false,
  reserveControlSpace = false,
}: PropertyRowProps) {
  return (
    <div className="flex min-h-row items-center gap-2 px-2">
      {/*
        标签宽 60px（`w-label`），但仍是「首选」而非「固定」：配合 `min-w-0 shrink` 让它在
        极窄面板下让位给控件。若写死不可收缩，1024px 窗口把右栏拖窄时，滑杆尾部的复位图标
        会被 Panel 的 `overflow-x-hidden` 裁掉。标签自身 truncate + title，压缩后仍可悬停看全名。
      */}
      <span
        className="w-label min-w-0 shrink select-none truncate text-label text-muted"
        title={label}
      >
        {label}
      </span>
      {/*
        控件区默认带 min-w-0：flex 项的自动最小尺寸默认等于内容宽度，于是控件区里一段长文本
        （如 `assets/<uuid>.png` 这样的资源路径）会把整行顶出面板右缘，把尾部图标按钮挤没。
        min-w-0 放开这个下限，长文本才能在控件区内被 truncate 收窄，图标始终留在行内。
        `reserveControlSpace` 的行例外：改用 min-w-fit 让控件区的内在最小宽度参与 flex 分配
        （标签因此收缩），保证不可压缩的尾部图标不被裁掉。
      */}
      <div
        className={`flex items-center gap-2 ${
          grow ? `flex-1 ${reserveControlSpace ? "min-w-fit" : "min-w-0"}` : "min-w-0 ml-auto"
        }`}
      >
        {children}
      </div>
    </div>
  )
}
