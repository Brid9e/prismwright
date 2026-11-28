/**
 * @prismwright/schema 的默认值工厂：集中产出字段完整、合法的数据对象。
 *
 * 架构位置：位于 zod 校验层之上，是 UI / 状态层新建实体的唯一入口。
 * 各工厂统一「以 schema 解析"最小种子对象"」的方式构造返回值，从而让默认值
 * 只在 `schema.ts` 中定义一份，避免此处与 schema 重复维护。
 *
 * 对外暴露：`newId` / `createLayer` / `createTextLayer` / `createCard` / `createCardFace` / `createEmptyPack`。
 */
import type { Card, CardFace, Layer, Pack } from "./types.js"
import { CardFaceSchema, CardSchema, LayerSchema, PackSchema } from "./schema.js"

/**
 * 生成一个新的实体 ID。
 *
 * @returns uuid v4 字符串（`crypto.randomUUID()` 依 RFC 4122 产出 v4 变体）。
 */
export function newId(): string {
  return crypto.randomUUID()
}

/**
 * 创建一个图层，所有可省略字段取 schema 默认值。
 *
 * @param name - 图层名。默认名（如「图层 1」）由调用方按当前语言生成后传进来——它是**数据**，
 *   创建时就写定，之后拖动重排不会改它（展示文案的生成因此留在应用层，见桌面端的
 *   `store/layer-naming.ts`）。
 * @returns 字段完整的 {@link Layer}——一个只有 `{ id, name, blend }` 三项显式种子的裸层，
 *   其余字段（`enabled`、`holoMix`、`effects` 等）由 schema 默认值补全。
 */
export function createLayer(name: string): Layer {
  // 只喂入必填的 id 与名字，其余交给 LayerSchema 的默认值填充。
  // 例外：`blend` 显式给 "normal"——新建层期望「正常叠加」，而 LayerSchema 对该字段的兜底默认
  // 刻意保留为 "add"（不动存量/极旧数据的行为，见 schema.ts）。二者分处两处是刻意的取舍。
  return LayerSchema.parse({ id: newId(), name, blend: "normal" })
}

/**
 * 创建一个文字图层，排版参数全部取 schema 默认值。
 *
 * 与 {@link createLayer} 一样只喂入最小种子：`kind` 与 `text.content` 是「文字层」的身份，
 * `blend` 显式给 "normal"（新建层期望正常叠加）；字体、字号、颜色、描边、投影等一律
 * 由 `TextParamsSchema` 的默认值补全。
 *
 * @param name - 图层名（调用方按当前语言生成，如「文字 1」）。
 * @param content - 初始文字内容（用户可见的默认串，由调用方按语言提供）。
 */
export function createTextLayer(name: string, content: string): Layer {
  return LayerSchema.parse({
    id: newId(),
    name,
    blend: "normal",
    kind: "text",
    text: { content },
  })
}

/**
 * 创建一个字段完整的空卡面。
 *
 * 存在的意义：`CardFace` 带一整套默认值（效果列表、图层列表等），若在状态层与 UI 里各自手写
 * 一份字面量会与 schema 默认值两处漂移——这里以「最小种子 + schema 解析」产出唯一来源。
 *
 * @returns 字段完整的 {@link CardFace}；`front` 为空串、`layers` 为空数组、`effects` 为空数组。
 */
export function createCardFace(): CardFace {
  return CardFaceSchema.parse({})
}

/**
 * 创建一张卡片。
 *
 * @param num - 条目序号（非负整数，用于展示 e1、e2…）。
 * @param layerName - 预置图层的名字（同样由调用方按当前语言生成，见 {@link createLayer}）。
 * @returns 字段完整的 {@link Card}。默认预置 **一个图层**——
 *   因为编辑器的图层列表需要至少一个可编辑落点，预置一层可让用户新建卡片后
 *   立即开始编辑，而不必先手动「添加图层」。
 */
export function createCard(num: number, layerName: string): Card {
  return CardSchema.parse({ id: newId(), num, name: "", layers: [createLayer(layerName)] })
}

/**
 * 创建一个空系列。
 *
 * @param name - 系列名（非空）。
 * @param editorVersion - 创建该系列的编辑器版本（如 `"v1"`）。由调用方传入当前值，
 *   缺省 `"v1"`——schema 包不持有版本清单，缺省只是给测试与旧调用点兜底。
 * @returns 字段完整的 {@link Pack}，数据格式版本为 8，`cards` / `hiddenCards` 为空数组，
 *   `back` 为 `null`，`createdAt` 与 `updatedAt` 均取当前时刻（ISO 字符串，二者相等）。
 */
export function createEmptyPack(name: string, editorVersion = "v1"): Pack {
  const now = new Date().toISOString()
  return PackSchema.parse({
    schemaVersion: 9,
    editorVersion,
    id: newId(),
    name,
    cards: [],
    hiddenCards: [],
    createdAt: now,
    updatedAt: now,
  })
}
