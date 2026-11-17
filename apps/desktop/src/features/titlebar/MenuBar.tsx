/**
 * 自绘标题栏里的菜单条（仅 Windows）。
 *
 * 结构与原生菜单**同一棵树**：`buildMenuModel(ctx, "titlebar")` 出模型、`menuActions.ts`
 * 出动作表，所以两个界面上「文件里有什么、点了会怎样」不会各改一半；快捷键的显示与匹配
 * 也都取自模型本身（`accelerators.ts`）。
 *
 * 为什么用 Radix 的 `menubar` 而不是自己拿 `dropdown-menu` 拼：菜单栏的手感全挂在「哪个
 * 菜单开着」这一件**所有顶层菜单共享**的事上，而 `menubar` 正是为此存在的原语。自拼版栽的
 * 就是这个：一个菜单关闭时会把焦点还给自己的触发器，那份焦点落在**兄弟触发器**上，在刚划
 * 过去的那个菜单看来就是「焦点跑到弹层外面了」，于是它被当场关掉（点击却没事——点击路径有
 * `hasInteractedOutsideRef` 挡着，而划过没有）。`menubar` 的两处处理正好防这个：触发器
 * `onPointerEnter` 先把焦点交给新触发器，弹层 `onFocusOutside` 见到事件落在触发器上就
 * `preventDefault`。←/→ 换菜单也是它内置的，不必再挂窗口级监听。
 *
 * 样式往 Windows 11 的原生菜单靠：整块 8px 圆角（`rounded-lg`）套 4px 内边距，行高 24px，
 * 高亮是内缩进去的 4px 圆角块（`rounded-md`），分隔线两侧留白。原生菜单条的下拉是**不透明**
 * 的（半透明的亚克力只用于 Win11 的右键菜单），所以这里不用背景模糊。
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import * as Menubar from "@radix-ui/react-menubar"
import { Check, ChevronRight } from "lucide-react"
import { useRecentStore } from "../../store/recentStore"
import { useUiStore } from "../../store/uiStore"
import { formatAccelerator } from "../../app/accelerators"
import { buildMenuModel, resolveMenuText, type MenuNode } from "../../app/menuModel"
import { dispatch } from "../../app/menuActions"
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS } from "../../ui/menuStyles"

/** 顶层节点（标题栏形态下都是子菜单，这里只为收窄类型）。 */
type SubmenuNode = Extract<MenuNode, { kind: "submenu" }>

/** 弹层：与右键菜单共用同一套度量（见 `ui/menuStyles`）。 */
const CONTENT_CLASS = `z-50 ${MENU_CONTENT_CLASS}`

/** 一项：24px 行高、4px 圆角的高亮块。 */
const ITEM_CLASS = MENU_ITEM_CLASS

/** 展开的子菜单：父项跟着保持高亮，跟原生一致。 */
const SUBTRIGGER_CLASS = `${ITEM_CLASS} data-[state=open]:bg-accent/25`

/**
 * 勾选项左侧的留白槽：原生菜单在左边留一栏放勾，**没勾的项也占着**，同一个菜单里的文字
 * 才对得齐。整份模型里只有「视图」是勾选项（且它没有普通项），不会出现有槽没槽混排。
 */
const CHECK_SLOT = "flex w-4 shrink-0 items-center justify-center"

/** 顶层触发器：与弹层里的项同一套度量（高 24px、4px 圆角），只多一个悬停/展开底色。 */
const TRIGGER_CLASS =
  "flex h-6 select-none items-center rounded-md px-2 text-[12px] text-foreground outline-none hover:bg-elevated data-[state=open]:bg-elevated"

/** 在项的右侧显示快捷键（统一按 Windows 惯例排序，见 `formatAccelerator`）。 */
function ShortcutHint({ accelerator }: { accelerator?: string }) {
  if (!accelerator) return null
  return (
    <span className="ml-auto pl-4 text-[11px] text-muted">{formatAccelerator(accelerator)}</span>
  )
}

/** 把一个模型节点渲染成弹层里的一项。 */
function MenuEntry({ node, t }: { node: MenuNode; t: (key: string) => string }) {
  switch (node.kind) {
    case "separator":
      return <Menubar.Separator className="mx-1 my-1 h-px bg-border-subtle" />
    case "check":
      return (
        <Menubar.CheckboxItem
          checked={node.checked}
          onSelect={() => dispatch(node.id)}
          className={`${ITEM_CLASS} pl-1`}
        >
          <span className={CHECK_SLOT} aria-hidden>
            {node.checked && <Check size={13} />}
          </span>
          <span>{resolveMenuText(node.text, t)}</span>
          <ShortcutHint accelerator={node.accelerator} />
        </Menubar.CheckboxItem>
      )
    case "item":
    case "predefined":
      // 系统预置项（退出）在这里没有系统可托付，当普通项渲染、动作走同一张表。
      return (
        <Menubar.Item
          disabled={node.kind === "item" ? node.enabled === false : false}
          onSelect={() => dispatch(node.id)}
          className={ITEM_CLASS}
        >
          <span>{resolveMenuText(node.text, t)}</span>
          <ShortcutHint accelerator={node.kind === "item" ? node.accelerator : undefined} />
        </Menubar.Item>
      )
    case "submenu":
      return (
        <Menubar.Sub>
          <Menubar.SubTrigger className={SUBTRIGGER_CLASS}>
            <span>{resolveMenuText(node.text, t)}</span>
            <ChevronRight size={14} className="ml-auto shrink-0 text-muted" />
          </Menubar.SubTrigger>
          <Menubar.Portal>
            <Menubar.SubContent sideOffset={2} className={CONTENT_CLASS}>
              {node.items.map((child, i) => (
                <MenuEntry key={i} node={child} t={t} />
              ))}
            </Menubar.SubContent>
          </Menubar.Portal>
        </Menubar.Sub>
      )
  }
}

/** 标题栏菜单条。 */
export function MenuBar() {
  const { t } = useTranslation()
  const collapsed = useUiStore((s) => s.collapsed)
  const showChecker = useUiStore((s) => s.showChecker)
  const recent = useRecentStore((s) => s.recent)
  const missing = useRecentStore((s) => s.missing)

  /** 当前展开的顶层菜单 id；`null` = 都没展开（`menubar` 用空串表示「没开」）。 */
  const [openId, setOpenId] = useState<string | null>(null)

  const menus = useMemo(() => {
    const model = buildMenuModel(
      {
        showLeft: !collapsed.left,
        showRight: !collapsed.right,
        showChecker,
        recent,
        missing,
      },
      "titlebar",
    )
    return model.filter((n): n is SubmenuNode => n.kind === "submenu")
  }, [collapsed, showChecker, recent, missing])

  // 菜单没了（比如语言切换导致重建）：别留着悬空的 openId。
  useEffect(() => {
    if (openId && !menus.some((m) => m.id === openId)) setOpenId(null)
  }, [menus, openId])

  return (
    // 受控的 `value`：「哪个菜单开着」要在外面看得见，才谈得上「再点一次收起」。
    <Menubar.Root
      value={openId ?? ""}
      onValueChange={(value) => setOpenId(value || null)}
      className="flex h-full items-center"
    >
      {menus.map((menu) => (
        <Menubar.Menu key={menu.id} value={menu.id}>
          <Menubar.Trigger
            className={TRIGGER_CLASS}
            // 再点一次已经展开的菜单要收起（原生菜单栏如此）。Radix 的 pointerdown 只负责
            // 「打开」；而它自己那半段的 `composeEventHandlers` 见到 props 侧已经
            // `preventDefault` 就不会再调，所以这里拦一下就能把「收起」补上。
            onPointerDown={(event) => {
              if (openId !== menu.id) return
              event.preventDefault()
              setOpenId(null)
            }}
          >
            {resolveMenuText(menu.text, t)}
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content align="start" sideOffset={2} className={CONTENT_CLASS}>
              {menu.items.map((node, i) => (
                <MenuEntry key={i} node={node} t={t} />
              ))}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  )
}
