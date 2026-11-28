/**
 * 稀有度识别配色。
 *
 * 映射本身放在 `ui/rarityTone.ts`（基础控件 `Tag` 也要用，UI 层不应反向依赖业务目录）；
 * 这里保留同名导出，既有调用点无需改动。
 */
export { rarityTone, type RarityTone } from "../../ui/rarityTone"
