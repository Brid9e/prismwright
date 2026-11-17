/**
 * 菜单的共用样式：标题栏菜单条（Radix Menubar）与自绘右键菜单必须长得一模一样。
 *
 * 度量照 Windows 11 原生菜单：整块 8px 圆角套 4px 内边距，行高 24px，高亮是内缩进去的
 * 4px 圆角块。
 */

/** 弹层：8px 圆角 + 4px 内边距——留出那圈边，高亮块才是「浮在里面」而不是糊满一条。 */
export const MENU_CONTENT_CLASS =
  "min-w-[10rem] rounded-lg border border-border-subtle bg-elevated p-1 shadow-lg"

/** 一项：24px 行高、4px 圆角的高亮块（`select-none`/`cursor-default` 照抄下拉，免得选中文字）。 */
export const MENU_ITEM_CLASS =
  "flex h-6 w-full cursor-default select-none items-center gap-4 rounded-md px-2 text-left text-[12px] text-foreground outline-none data-[disabled]:text-disabled data-[highlighted]:bg-accent/25"
