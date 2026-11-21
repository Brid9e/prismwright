/**
 * 卡片与图层在列表里的展示名。
 *
 * 数据里空串表示「未命名」（schema §6.3 的约定：不把展示文案写进数据，以免与
 * 语言耦合），因此回退逻辑属于展示层。抽成纯函数是为了能被测试覆盖——组件本身
 * 在本阶段不做 DOM 测试。
 */
import type { TFunction } from "i18next"
import type { Card, Layer } from "@prismwright/schema"

/**
 * 卡片的展示名。
 *
 * `t` 必须是**已绑定 `card` 命名空间**的翻译函数（即 `useTranslation("card")` 的
 * `t`）。键因此写成不带命名空间前缀的 `"unnamed"`——若写成 `"card.unnamed"`，
 * 在已绑定的 `t` 上会被解析成 `card:card.unnamed`，取不到值而直接显示原始键名。
 *
 * @param card - 至少含 `num` 与 `name`。
 * @param t - `card` 命名空间下的翻译函数。
 * @returns 有名字时返回名字；否则返回「卡片 {{num}}」。
 */
export function displayCardName(card: Pick<Card, "num" | "name">, t: TFunction): string {
  return card.name.trim() === "" ? t("unnamed", { num: card.num }) : card.name
}

/**
 * 图层的展示名。
 *
 * `t` 必须是已绑定 `layer` 命名空间的翻译函数，键同理写 `"unnamedLayer"`。
 *
 * 默认名（「图层 1」）在创建时就写进了 `layer.name`，所以这里**不再按下标现算**——
 * 名字是图层自己的属性，拖拽重排不该改它。走到回退分支的只剩「老系列且尚未补名」的
 * 图层（以及被手动清空名字的图层），统一显示成「未命名图层」。
 *
 * @param layer - 至少含 `name`。
 * @param t - `layer` 命名空间下的翻译函数。
 * @returns 有名字时返回名字；否则返回「未命名图层」。
 */
export function displayLayerName(layer: Pick<Layer, "name">, t: TFunction): string {
  return layer.name.trim() === "" ? t("unnamedLayer") : layer.name
}
