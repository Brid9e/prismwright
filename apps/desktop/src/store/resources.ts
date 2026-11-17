/**
 * 系列资源路径收集（桌面端入口）。
 *
 * 架构位置：数据层（`@cardbara/schema` 类型）与 IO 层（`packFs`）之间的纯函数桥。
 * 系列内的图片（卡面、蒙版、背面）都以「相对系列根的路径」存于数据模型中，
 * 本模块负责从数据模型反推这些路径的集合，供「删除卡片时移入回收站」「撤销时恢复」
 * 等需要枚举文件的场景复用。
 *
 * **实现已下沉到 `@cardbara/schema`**：小程序发布后也要按卡预热资源，用的是同一份判定。
 * 少收一个路径的后果是「某张卡偶发缺图」，那种 bug 在两个实现里各写一遍几乎必然漂移。
 * 本文件保留这三个旧名字作为薄委托，调用点不动；新代码请直接用 schema 的
 * `collectFaceAssets` / `collectCardAssets` / `collectPackAssets`。
 */
import {
  collectCardAssets,
  collectFaceAssets,
  collectPackAssets,
  type Card,
  type CardFace,
  type Pack,
} from "@cardbara/schema"

/**
 * 收集单个卡面（卡片正面或系列背面）引用的资源相对路径。
 *
 * 卡面图与图蒙版都来自数据模型：卡面图是 `face.front`，图蒙版散在卡面自身与其各图层的
 * **效果列表**里（`imageMask` 效果，不再是图层 / 卡面的专属字段）。路径为空的 imageMask 是
 * 「已添加但还没选图」的中间态，故一律跳过，避免把无意义的空路径交给下游 IO。
 *
 * @param face - 卡面对象（卡片或系列背面，二者结构相同）。
 * @returns 该卡面引用的相对路径数组，顺序为「卡面自身（front 图、图蒙版）在前，各图层图蒙版与图片效果依序在后」。
 */
export const collectCardFaceRels = collectFaceAssets

/**
 * 收集单张卡片引用的资源相对路径。
 *
 * 卡片在结构上就是「带身份信息的卡面」（`Card` extends `CardFace`），故直接委托；
 * 保留本函数是为了给调用方一个语义清晰的入口。
 *
 * @param card - 卡片对象。
 * @returns 该卡片引用的相对路径数组。
 */
export const collectCardRels = collectCardAssets

/**
 * 收集整个系列引用的全部资源相对路径，并按路径去重。
 *
 * 汇总三个来源：普通卡片、隐藏款卡片、系列背面。不同卡片或图层可能偶然引用同一路径
 * （例如共用某张蒙版），去重后调用方对同一文件只需处理一次，避免重复移动/恢复。
 *
 * @param pack - 仅取用 `cards` / `hiddenCards` / `back` 三个字段，故参数类型收窄为它们的
 *   最小组合，便于测试构造轻量对象。
 * @returns 去重后的相对路径数组，顺序为首次出现的顺序。
 */
export const collectPackRels = collectPackAssets

// 类型再导出：老调用点若从这里取类型（而非从 @cardbara/schema），改完实现后仍然可用。
export type { Card, CardFace, Pack }
