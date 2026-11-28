/**
 * 卡册排版对话框：把系列里的卡拖进 3×3 的固定格子，位置写进 `pack.album`。
 *
 * 拖动即落盘（走 `packStore.commit`，可撤销），关掉对话框不需要再点保存。
 * 没排进任何格子的卡留在右侧「未归档」，小程序展示时会自动补到最后一页——
 * 这条兜底写在 `utils/view-model.ts` 的 `albumPages` 里，这里只负责把位置排好。
 *
 * 拖拽用指针事件（pointerdown / move / up）而不是 HTML5 drag/drop：Windows 上
 * Tauri 会用自己的 WebView2 拖放处理器接管 HTML5 拖放，事件根本到不了页面。
 * 指针事件不经过那层，任何窗口里都能用。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import type { Card } from "@prismwright/schema"
import { rarityTone } from "../cards/rarity"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"
import {
  appendPage,
  clearSlot,
  emptyPage,
  normalizePages,
  placeCard,
  removePage,
  toAlbum,
  unplacedCardIds,
  type AlbumPage,
} from "./album"

/** 带隐藏款标记的卡；隐藏款在数据里单独一列，但排版时和普通卡一样占格。 */
type AlbumCard = Card & { hidden: boolean }

/** 拖到哪个目标上；`null` 表示不在任何可放置区域里。 */
type DropTarget = { kind: "slot"; page: number; slot: number } | { kind: "tray" } | null

/** 移动超过这个距离才当成拖拽，轻点是正常的点击。 */
const DRAG_THRESHOLD = 4

export function AlbumDialog() {
  const { t } = useTranslation("editor")
  const open = useUiStore((s) => s.albumOpen)
  const setOpen = useUiStore((s) => s.setAlbumOpen)
  const pack = usePackStore((s) => s.pack)
  const commit = usePackStore((s) => s.commit)
  const [pages, setPages] = useState<AlbumPage[]>([emptyPage()])
  // 正在拖的卡与指针位置（只用于画跟手的名字标签）。
  const [drag, setDrag] = useState<{ cardId: string; x: number; y: number } | null>(null)
  const [hover, setHover] = useState<DropTarget>(null)
  // 指针进入格子/未归档栏时，事件回调里要立刻拿到最新值，故与 state 并行存一份 ref。
  const hoverRef = useRef<DropTarget>(null)
  const draggingRef = useRef<string | null>(null)

  const cards = useMemo<AlbumCard[]>(() => {
    if (!pack) return []
    return [
      ...pack.cards.map((card) => ({ ...card, hidden: false })),
      ...pack.hiddenCards.map((card) => ({ ...card, hidden: true })),
    ]
  }, [pack])
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const unplaced = useMemo(
    () => unplacedCardIds(pages, cards.map((card) => card.id)),
    [pages, cards],
  )

  // 每次打开都从当前 pack 起步；对话框开着时的拖动由本组件自己维护，
  // 不会被外部改动冲掉（与抽卡概率对话框同一口径）。
  useEffect(() => {
    if (!open) return
    const current = usePackStore.getState().pack
    if (!current) return
    setPages(
      normalizePages(current.album.pages, [
        ...current.cards.map((card) => card.id),
        ...current.hiddenCards.map((card) => card.id),
      ]),
    )
  }, [open])

  if (!pack) return null

  /** 落位并立刻提交；同一状态直接返回时不新增撤销步。 */
  function apply(next: AlbumPage[]) {
    if (next === pages) return
    setPages(next)
    commit((draft) => {
      draft.album = toAlbum(next)
    })
  }

  /** 把一张卡从所有格子里拿掉，回到未归档。 */
  function unplace(cardId: string) {
    let next = pages
    for (let page = 0; page < next.length; page++) {
      const slot = next[page].indexOf(cardId)
      if (slot >= 0) {
        next = clearSlot(next, page, slot)
        break
      }
    }
    apply(next)
  }

  function setDropTarget(target: DropTarget) {
    hoverRef.current = target
    setHover(target)
  }

  /** 离开某块区域时只在它仍是当前目标时才清掉，避免「进入新格子」被旧格子的 leave 覆盖。 */
  function clearDropTarget(match: (target: Exclude<DropTarget, null>) => boolean) {
    const current = hoverRef.current
    if (current && match(current)) setDropTarget(null)
  }

  /**
   * 开始一次指针拖拽。
   *
   * 在 pointerdown 时就挂上 window 监听，移动超过阈值才真正进入拖拽态；
   * 松开时按最后悬停的区域落位。整个会话用指针自身的事件，不依赖 HTML5 drag/drop。
   */
  function beginDrag(event: ReactPointerEvent, cardId: string) {
    if (event.button !== 0) return
    // 格子右上角的「移除」按钮是点击操作，别被拖拽抢走。
    if ((event.target as HTMLElement).closest("button")) return
    // 压住按下时的默认行为，免得拖动过程中变成选中卡名文字。
    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    let started = false

    const move = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return
        started = true
        draggingRef.current = cardId
      }
      e.preventDefault()
      setDrag({ cardId, x: e.clientX, y: e.clientY })
    }

    const finish = (commitDrop: boolean) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      const target = hoverRef.current
      draggingRef.current = null
      setDrag(null)
      setDropTarget(null)
      if (!commitDrop || !started || !target) return
      if (target.kind === "slot") apply(placeCard(pages, cardId, target.page, target.slot))
      else unplace(cardId)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }

  const draggedCard = drag ? byId.get(drag.cardId) : undefined

  return (
    <DialogShell
      open={open}
      title={t("album.title")}
      description={t("album.hint")}
      onClose={() => setOpen(false)}
      className="flex max-h-[85vh] w-[46rem] max-w-[calc(100vw-2rem)] flex-col p-3"
    >
      <div className={`flex min-h-0 flex-1 gap-3 ${drag ? "select-none" : ""}`}>
        {/* 页面：全部纵向排列，跨页拖动时不需要先切页。 */}
        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          {cards.length === 0 ? (
            <p className="py-6 text-center text-body text-muted">{t("album.noCards")}</p>
          ) : null}
          {pages.map((slots, page) => (
            <section key={page} className="mb-3">
              <div className="mb-1.5 flex h-6 items-center justify-between">
                <span className="text-body font-medium text-foreground">
                  {t("album.page", { page: page + 1 })}
                </span>
                {pages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => apply(removePage(pages, page))}
                    className="rounded-control px-1.5 text-label text-muted hover:text-danger"
                  >
                    {t("album.removePage")}
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {slots.map((cardId, slot) => {
                  const card = cardId ? byId.get(cardId) : undefined
                  const hovered =
                    hover?.kind === "slot" && hover.page === page && hover.slot === slot
                  return (
                    <div
                      key={slot}
                      onPointerEnter={() => {
                        if (draggingRef.current) setDropTarget({ kind: "slot", page, slot })
                      }}
                      onPointerLeave={() =>
                        clearDropTarget(
                          (target) =>
                            target.kind === "slot" &&
                            target.page === page &&
                            target.slot === slot,
                        )
                      }
                      className={`aspect-[5/7] min-w-0 rounded-control ${
                        hovered ? "ring-2 ring-accent" : ""
                      }`}
                    >
                      {card ? (
                        <AlbumTile
                          card={card}
                          hiddenLabel={t("album.hidden")}
                          removeLabel={t("album.removeCard")}
                          onRemove={() => unplace(card.id)}
                          onPointerDown={beginDrag}
                        />
                      ) : (
                        <div
                          className={`flex h-full items-center justify-center rounded-control border border-dashed text-num ${
                            hovered
                              ? "border-accent bg-accent-soft/40 text-accent"
                              : "border-line-soft text-disabled"
                          }`}
                          title={t("album.emptySlot")}
                        >
                          {slot + 1}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          <button
            type="button"
            onClick={() => apply(appendPage(pages))}
            className="mb-1 h-7 w-full rounded-control border border-dashed border-line-soft text-body text-muted hover:bg-elevated"
          >
            {t("album.addPage")}
          </button>
        </div>

        {/* 未归档卡：拖进格子即落位；留在原地的卡由小程序自动补到最后一页。 */}
        <aside
          className={`flex w-52 shrink-0 flex-col rounded-control border border-line bg-app/40 p-2 ${
            hover?.kind === "tray" ? "ring-2 ring-accent" : ""
          }`}
          onPointerEnter={() => {
            if (draggingRef.current) setDropTarget({ kind: "tray" })
          }}
          onPointerLeave={() => clearDropTarget((target) => target.kind === "tray")}
        >
          <h3 className="text-body font-medium text-foreground">
            {t("album.unplaced", { cards: unplaced.length })}
          </h3>
          <p className="mt-1 text-label leading-relaxed text-muted">{t("album.unplacedHint")}</p>
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {unplaced.map((cardId) => {
              const card = byId.get(cardId)
              if (!card) return null
              return (
                <AlbumTile
                  key={cardId}
                  card={card}
                  hiddenLabel={t("album.hidden")}
                  compact
                  onPointerDown={beginDrag}
                />
              )
            })}
          </div>
        </aside>
      </div>

      <div className="mt-3 flex shrink-0 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-6 rounded-control bg-accent px-3 text-body text-accent-foreground hover:bg-accent-hover"
        >
          {t("common:action.confirm")}
        </button>
      </div>

      {/* 跟手的名字标签：必须挂到 body，对话框外壳带 transform，fixed 会相对它定位。 */}
      {drag && draggedCard
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2 rounded-control border border-accent bg-panel px-2 py-1 text-label text-foreground shadow-lg"
              style={{ left: drag.x, top: drag.y }}
            >
              {draggedCard.name}
            </div>,
            document.body,
          )
        : null}
    </DialogShell>
  )
}

interface AlbumTileProps {
  card: AlbumCard
  hiddenLabel: string
  /** 不传就是不可移除（未归档栏里的卡）。 */
  removeLabel?: string
  onRemove?: () => void
  /** 未归档栏用横条；格子里用竖卡。 */
  compact?: boolean
  onPointerDown: (event: ReactPointerEvent, cardId: string) => void
}

/** 一张可拖动的卡；格子里显示稀有度标记，顶上浮出「放回未归档」按钮。 */
function AlbumTile({
  card,
  hiddenLabel,
  removeLabel,
  onRemove,
  compact,
  onPointerDown,
}: AlbumTileProps) {
  const { t } = useTranslation("editor")
  const tone = rarityTone(card.rarity)
  return (
    <div
      onPointerDown={(event) => onPointerDown(event, card.id)}
      title={card.name}
      className={`group relative flex min-w-0 cursor-grab items-center gap-1.5 rounded-control border border-line border-l-[3px] bg-panel px-1.5 active:cursor-grabbing ${tone.edge} ${
        compact ? "h-8 shrink-0" : "h-full flex-col justify-center"
      }`}
    >
      <span className="min-w-0 max-w-full truncate text-label text-foreground">{card.name}</span>
      <span className={`shrink-0 rounded-control px-1 text-num leading-4 ${tone.text} ${tone.tint}`}>
        {t(`card:rarity.${card.rarity}`)}
      </span>
      {card.hidden ? (
        <span className="shrink-0 rounded-control bg-accent-soft/60 px-1 text-num text-accent">
          {hiddenLabel}
        </span>
      ) : null}
      {onRemove && removeLabel ? (
        <button
          type="button"
          title={removeLabel}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-control bg-panel text-label leading-none text-muted hover:text-danger group-hover:flex"
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
