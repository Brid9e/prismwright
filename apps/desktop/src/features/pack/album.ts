/**
 * 卡册排版的纯逻辑：位置、换位、增删页、存盘整形。
 *
 * 数据落在 `pack.album.pages`：每页恰好 {@link ALBUM_PAGE_SIZE} 格，`null` 是空格。
 * 对话框只负责把拖动事件翻成这里的调用；哪张卡在哪一格全由本模块决定，因而可单测。
 */
import { ALBUM_PAGE_SIZE, type AlbumLayout } from "@cardbara/schema"

/** 一页 9 格；`null` 表示这一格空着。 */
export type AlbumPage = (string | null)[]

/** 一页空格。 */
export function emptyPage(): AlbumPage {
  return new Array<string | null>(ALBUM_PAGE_SIZE).fill(null)
}

/** 找某张卡当前的格子；不在排版里返回 `null`。 */
function findSlot(
  pages: readonly AlbumPage[],
  cardId: string,
): { page: number; slot: number } | null {
  for (let page = 0; page < pages.length; page++) {
    const slot = pages[page].indexOf(cardId)
    if (slot >= 0) return { page, slot }
  }
  return null
}

/**
 * 把磁盘上的排版整形成可编辑状态：每页补满 9 格，丢掉系列里不存在的卡，
 * 同一张卡只认第一次出现的位置。没有排版时给一页空格，对话框才有落脚点。
 */
export function normalizePages(
  pages: readonly (readonly (string | null)[])[] | undefined,
  cardIds: readonly string[],
): AlbumPage[] {
  const known = new Set(cardIds)
  const seen = new Set<string>()
  const out = (pages ?? []).map((raw) => {
    const slots = emptyPage()
    for (let i = 0; i < ALBUM_PAGE_SIZE; i++) {
      const id = (raw ?? [])[i]
      if (typeof id !== "string" || !id || !known.has(id) || seen.has(id)) continue
      seen.add(id)
      slots[i] = id
    }
    return slots
  })
  return out.length > 0 ? out : [emptyPage()]
}

/**
 * 把 `cardId` 放到第 `page` 页第 `slot` 格。
 *
 * - 从托盘拖入空格：直接落位；
 * - 拖到已占用的格子：原卡退回托盘（即被清空）；
 * - 从另一个格子拖来：两张卡交换位置；
 * - 拖回原格：原样返回。
 */
export function placeCard(
  pages: readonly AlbumPage[],
  cardId: string,
  page: number,
  slot: number,
): AlbumPage[] {
  if (!pages[page] || slot < 0 || slot >= ALBUM_PAGE_SIZE) return pages as AlbumPage[]
  const source = findSlot(pages, cardId)
  if (source && source.page === page && source.slot === slot) return pages as AlbumPage[]

  const next = pages.map((p) => p.slice())
  const occupant = next[page][slot]
  for (const slots of next) {
    const at = slots.indexOf(cardId)
    if (at >= 0) slots[at] = null
  }
  if (source) next[source.page][source.slot] = occupant
  next[page][slot] = cardId
  return next
}

/** 清空一个格子；卡回到「未归档」。 */
export function clearSlot(
  pages: readonly AlbumPage[],
  page: number,
  slot: number,
): AlbumPage[] {
  const next = pages.map((p) => p.slice())
  if (!next[page]) return next
  next[page][slot] = null
  return next
}

/** 追加一页空格。 */
export function appendPage(pages: readonly AlbumPage[]): AlbumPage[] {
  return [...pages.map((p) => p.slice()), emptyPage()]
}

/**
 * 删掉一页；该页上的卡自动回到未归档。只剩一页时不再删，换成一张干净的空页。
 */
export function removePage(pages: readonly AlbumPage[], page: number): AlbumPage[] {
  if (pages.length <= 1) return [emptyPage()]
  return pages.filter((_, i) => i !== page).map((p) => p.slice())
}

/** 按系列里的原始顺序列出尚未排进任何格子的卡。 */
export function unplacedCardIds(
  pages: readonly AlbumPage[],
  cardIds: readonly string[],
): string[] {
  const placed = new Set<string>()
  for (const slots of pages) for (const id of slots) if (id) placed.add(id)
  return cardIds.filter((id) => !placed.has(id))
}

/**
 * 存盘整形：去掉末尾的空页（中间的空页保留，作者可以用它留白）。
 *
 * 一张都没排时返回 `{ pages: [] }`——小程序会按系列顺序每页 9 张补位，
 * 这正是「未归档卡自动补到最后一页」的兜底。
 */
export function toAlbum(pages: readonly AlbumPage[]): AlbumLayout {
  const kept = pages.map((p) => p.slice())
  while (kept.length > 0 && kept[kept.length - 1].every((id) => id === null)) kept.pop()
  return { pages: kept }
}
