/**
 * 系列封面的纯校验逻辑：比例、常用尺寸描述与体积上限。
 *
 * 系列页把两张封面裁成固定比例：大封面（系列头图）用 5:2，小封面（列表缩略）用 1:1。
 * 卡包图不限比例——它整张铺到袋面上，超出的部分由袋子皮肤裁掉。
 * 这里只产出「错了」与「错在哪」所需的素材，提示文案与上传交互留给对话框；
 * 不碰文件系统、不 `invoke`，因而可单测。
 */

/**
 * 系列图片类型：`large` 头图、`small` 列表缩略、`pack` 抽卡页袋面里的卡包图、
 * `frame` 集齐后解锁的头像框、`achievement` 系列成就图标、`seriesAvatar` 系列头像。
 */
export type CoverKind = "large" | "small" | "pack" | "frame" | "achievement" | "seriesAvatar"

/** 图片类型 → `Pack` 上对应的相对路径字段。 */
export function coverFieldOf(
  kind: CoverKind,
): "coverLarge" | "coverSmall" | "packArt" | "avatarFrame" | "achievementIcon" | "seriesAvatar" {
  if (kind === "large") return "coverLarge"
  if (kind === "small") return "coverSmall"
  if (kind === "pack") return "packArt"
  if (kind === "frame") return "avatarFrame"
  if (kind === "achievement") return "achievementIcon"
  return "seriesAvatar"
}

/** 图片类型 → 落盘目录（卡包图、头像框、成就图标、系列头像各自单独一层，封面仍留在 `covers/`）。 */
export function coverDirOf(kind: CoverKind): string {
  if (kind === "pack") return "pack-art"
  if (kind === "frame") return "frames"
  if (kind === "achievement") return "achievement-icons"
  if (kind === "seriesAvatar") return "series-avatars"
  return "covers"
}

/** 允许作为封面的扩展名（不含 `webm`——它是视频，不会被当成图片解码）。 */
export const COVER_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "webp", "gif"]

/** 长边上限（像素）；超过它会把全尺寸贴图撑爆显存。 */
export const COVER_MAX_EDGE = 4096

/** 文件体积上限（字节）：5MB。 */
export const COVER_MAX_BYTES = 5 * 1024 * 1024

/**
 * 常见比例表，成对的互为倒置（1:1 自倒置）。
 *
 * `formatAspect` 命中这里就用可读的 `w:h`，否则退化为小数。
 */
const COMMON_ASPECTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [16, 9],
  [9, 16],
  [5, 7],
  [7, 5],
  [2, 1],
  [1, 2],
  [5, 2],
  [2, 5],
  [5, 4],
  [4, 5],
]

/** 欧几里得算法；任一参数为 0 时返回另一个。 */
function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y > 0) [x, y] = [y, x % y]
  return x
}

/** 有固定比例的封面类型；卡包图不限比例，不在其中。 */
type RatioKind = Exclude<CoverKind, "pack">

/**
 * 某个类型封面的目标宽高比。
 *
 * @param kind - 大封面或小封面。
 * @returns 大封面 `5/2`（首页横幅 2.5:1），小封面 `1`。
 */
function coverRatio(kind: RatioKind): number {
  return kind === "large" ? 5 / 2 : 1
}

/**
 * 把尺寸描述成可读的比例。
 *
 * 先按最大公约数约简；若约简后的两个数与 {@link COMMON_ASPECTS} 中的某一对成整数倍，
 * 就用那一对（如 1920×1080 → `16:9`）。非常见比例退化为两位小数（如 1870×1000 → `1.87:1`）。
 *
 * @param width - 宽（像素）。
 * @param height - 高（像素）。
 */
export function formatAspect(width: number, height: number): string {
  const g = gcd(width, height)
  if (g > 0) {
    const w = width / g
    const h = height / g
    for (const [commonW, commonH] of COMMON_ASPECTS) {
      const multiple = w / commonW
      if (Number.isInteger(multiple) && h === commonH * multiple) return `${commonW}:${commonH}`
    }
  }
  return `${(width / height).toFixed(2)}:1`
}

/**
 * 校验封面比例，容差 `0.005`（约 0.5%）。
 *
 * @param kind - 封面类型。
 * @param width - 实际宽（像素）。
 * @param height - 实际高（像素）。
 * @returns 比例合格时为 `null`；否则给出实际尺寸与可读比例，供提示文案使用。
 */
export function coverAspectError(
  kind: CoverKind,
  width: number,
  height: number,
): { width: number; height: number; aspect: string } | null {
  // 卡包图整张铺满袋面，超出袋子的部分由皮肤裁掉，任何比例都合法。
  if (kind === "pack") return null
  if (Math.abs(width / height - coverRatio(kind)) <= 0.005) return null
  return { width, height, aspect: formatAspect(width, height) }
}

/**
 * 判断封面是否超过长边或体积上限。
 *
 * @param width - 宽（像素）。
 * @param height - 高（像素）。
 * @param bytes - 文件体积（字节）。
 */
export function isCoverOversize(width: number, height: number, bytes: number): boolean {
  return Math.max(width, height) > COVER_MAX_EDGE || bytes > COVER_MAX_BYTES
}
