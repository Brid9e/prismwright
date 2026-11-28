/**
 * 图层默认名（「图层 1」）的生成、取号与老数据补写。
 *
 * 默认名在**创建时就写进 `layer.name`**，而不是展示时按列表位置现算：名字是图层自己的
 * 属性，拖拽重排不该改它。写进数据之后这一点天然成立，界面也就不必知道任何顺序。
 *
 * 代价是数据里出现了「图层 1」这句中文——这是刻意的取舍（见 `Layer.name` 的说明）：
 * 名字由创建时的界面语言决定，之后不再随语言切换而变。为了让这份文案只在一个地方生成，
 * i18n 的依赖收在这个小模块里：store 与 schema 都不需要知道当前语言。
 */
import { flattenLayers, type CardFace, type Pack } from "@prismwright/schema"
import i18n, { initI18n } from "../i18n/init"

/** 图层名字为空的判定，与 {@link displayLayerName} 保持一致（全空白也算未命名）。 */
function isUnnamed(name: string): boolean {
  return name.trim() === ""
}

/**
 * 第 `num` 个图层的默认名。
 *
 * @param num - 序号（正整数）。
 * @returns 当前语言的默认名，如「图层 3」/ 「Layer 3」。
 */
export function defaultLayerName(num: number): string {
  // i18n 尚未初始化时按回退语言补一次，免得名字变成裸的 key（"layer:unnamed"）。
  if (!i18n.isInitialized) initI18n()
  return i18n.t("layer:unnamed", { num })
}

/**
 * 文字层的默认名（「文字 3」）。
 *
 * 与普通图层各用一个编号池：否则「图层 1 / 文字 2」会互相抢号，两类图层混排时用户看到
 * 的编号会跳号。理由与 {@link defaultLayerName} 相同（名字写进数据、由创建时的语言决定）。
 *
 * @param num - 序号（正整数）。
 */
export function defaultTextLayerName(num: number): string {
  if (!i18n.isInitialized) initI18n()
  return i18n.t("layer:unnamedText", { num })
}

/** 调整层的默认名（「调整层 3」）。与普通 / 文字层各用一个编号池。 */
export function defaultAdjustmentLayerName(num: number): string {
  if (!i18n.isInitialized) initI18n()
  return i18n.t("layer:unnamedAdjustment", { num })
}

/** 分组层的默认名（「分组 3」）。与普通 / 文字 / 调整层各用一个编号池。 */
export function defaultGroupLayerName(num: number): string {
  if (!i18n.isInitialized) initI18n()
  return i18n.t("layer:unnamedGroup", { num })
}

/** 「取第一个未占用编号」的共用实现：两类图层各传自己的取名函数。 */
function nextFreeNum(
  layers: readonly { name: string }[],
  makeName: (num: number) => string,
): number {
  const taken = new Set(layers.map((l) => l.name.trim()))
  for (let num = 1; ; num++) {
    if (!taken.has(makeName(num))) return num
  }
}

/**
 * 下一个可用的默认名序号：从 1 起第一个没被占用的号。
 *
 * 判定只认**恰好等于**默认名的图层，用户自己起的名字（「描边」「封面 2024」）不会被误当成
 * 序号，所以不会出现「新层叫图层 2025」这种怪事。回收空出来的号（删掉「图层 2」之后再
 * 新建，新层还叫「图层 2」）比「最大值加一」更贴直觉，也保证永不重名。
 *
 * @param layers - 现有图层（只需要名字）。
 * @returns 可用的序号。
 */
export function nextLayerNum(layers: readonly { name: string }[]): number {
  return nextFreeNum(layers, defaultLayerName)
}

/**
 * 下一个可用的文字层默认名序号（规则同 {@link nextLayerNum}，池子独立）。
 *
 * @param layers - 现有图层（只需要名字）。
 */
export function nextTextLayerNum(layers: readonly { name: string }[]): number {
  return nextFreeNum(layers, defaultTextLayerName)
}

/** 下一个可用的调整层默认名序号（规则同 {@link nextLayerNum}，池子独立）。 */
export function nextAdjustmentLayerNum(layers: readonly { name: string }[]): number {
  return nextFreeNum(layers, defaultAdjustmentLayerName)
}

/** 下一个可用的分组默认名序号（规则同 {@link nextLayerNum}，池子独立）。 */
export function nextGroupLayerNum(layers: readonly { name: string }[]): number {
  return nextFreeNum(layers, defaultGroupLayerName)
}

/**
 * 给空名字的图层补上默认名。
 *
 * 只在打开老系列时跑一次：加「创建时写名」之前建出的图层，名字都是空串，而空串在界面上
 * 原本正是按位置显示成「图层 N」的——按位置补名，打开后的名字与打开前一致，而此后再拖拽
 * 重排，名字就不会跟着走了。
 *
 * 位置名撞车时退到「第一个空号」：位置名可能已被同一卡面的另一层占用（用户自己起过
 * 「图层 2」，或数据里本就有一层叫这个）。两行同名比编号跳号糟得多——用户根本没法分辨
 * 该选中哪一行，而编号不连续在界面上并不碍事。
 *
 * 就地改写（`pack` 来自 `JSON.parse`，是刚造出来的对象，不会被别处共享）。
 *
 * @param pack - 待补名的系列。
 * @returns 是否改写过名字；`false` 表示无需落盘。
 */
export function fillDefaultLayerNames(pack: Pack): boolean {
  const faces: (CardFace | null)[] = [pack.back, ...pack.cards, ...pack.hiddenCards]
  let changed = false
  for (const face of faces) {
    if (!face) continue
    // 树中的全部图层（父在前、子随后）。老数据的 children 恒为空，等价于原来的扁平遍历。
    const entries = flattenLayers(face.layers)
    entries.forEach((entry, index) => {
      if (!isUnnamed(entry.layer.name)) return
      // 优先用位置名（第 index+1 个）：旧界面上这一行显示的正是它，补名后用户看不出变化。
      const positional = defaultLayerName(index + 1)
      // 边补边判：前面几层刚写回的名字已经算「占用」，后面的层不会再与它们撞号。
      // 当前层的名字还是空串，不会被自己挡住。
      entry.layer.name = entries.some((e) => e.layer.name.trim() === positional)
        ? defaultLayerName(nextLayerNum(entries.map((e) => e.layer)))
        : positional
      changed = true
    })
  }
  return changed
}
