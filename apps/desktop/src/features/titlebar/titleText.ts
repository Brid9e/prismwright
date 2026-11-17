/**
 * 标题栏中间文字的拼接。
 *
 * 抽成纯函数以便单测——组件本身在本阶段不做 DOM 测试（同 `features/cards/display.ts`
 * 的约定）。名字的「未命名 → 卡片 N」回退由 `displayCardName` 负责，本函数只处理
 * 「有名字 / 没卡（null）」这一层。
 *
 * 无系列的情形**不**归这里管：那时正中画的不是文字，而是品牌锁形（logo + 字标，见
 * TitleBar），故调用方只在已打开系列时才调本函数。
 */

/** 卡名与系列名之间的分隔符。两段都是名字，符号通用，不进 i18n。 */
const SEPARATOR = " — "

/**
 * 拼接标题栏中间的文字。
 *
 * 有系列但没选中卡 → 系列名；都选中 → `卡名 — 系列名`。
 *
 * @param input.cardName - 当前卡片展示名；无选中卡为 `null`。
 * @param input.packName - 系列名（调用方保证已打开系列，故非空）。
 * @returns 标题栏中间要显示的文字。
 */
export function titlebarText(input: { cardName: string | null; packName: string }): string {
  const { cardName, packName } = input
  if (cardName === null) return packName
  return `${cardName}${SEPARATOR}${packName}`
}
