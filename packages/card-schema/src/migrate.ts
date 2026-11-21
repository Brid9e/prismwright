/**
 * @prismwright/schema 的版本守卫与加载入口。
 *
 * 架构位置：位于数据层最外层，负责把任意来源（磁盘 `pack.json`、导入文件）的未知数据校验为
 * 当前版本的 {@link Pack}。
 *
 * 本仓库当前只支持「当前版本」的 `pack.json`——产品尚无历史数据。历史上曾有一串逐级升级分支
 * （v1→v6），因无迁移对象已随本轮结构变更一并退役；此后新增破坏性结构变更时在此追加升级分支。
 * 目前留有一条 **v7 → v8**：宽高比从每张卡收到系列上。
 *
 * 对外暴露：`CURRENT_SCHEMA_VERSION` 常量、`migrate` 与 `parsePack`。
 */
import type { Pack } from "./types.js"
import { DEFAULT_CARD_ASPECT, PackSchema } from "./schema.js"

/** 当前数据格式版本。新增破坏性结构变更时递增（本轮起不再保留历史升级分支）。 */
export const CURRENT_SCHEMA_VERSION = 8

/** 从任意值里读一个可用的比例；不可用返回 `undefined`。 */
function readAspect(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * 从 v7 及更早的系列里挑出「这个系列该用哪个比例」。
 *
 * 规则：普通卡与隐藏款都算票，**用得最多的比例胜出**，并列时取靠前的那张；
 * 一张卡都没有就用卡背自己的比例；再没有就用缺省 5:7。
 *
 * 取众数而不是「第一张」，是因为混着比例的老系列里第一张常常正是那个例外。
 *
 * @param obj - 原始（未校验）的系列对象。
 * @returns 系列级宽高比。
 */
function aspectFromV7(obj: Record<string, unknown>): number {
  const faces = [
    ...(Array.isArray(obj.cards) ? obj.cards : []),
    ...(Array.isArray(obj.hiddenCards) ? obj.hiddenCards : []),
  ]

  const votes = new Map<number, number>()
  let winner: number | undefined
  let winnerCount = 0
  for (const face of faces) {
    const aspect = readAspect((face as Record<string, unknown> | null)?.aspect)
    if (aspect === undefined) continue
    const count = (votes.get(aspect) ?? 0) + 1
    votes.set(aspect, count)
    // 严格大于：并列时不换人，先出现的胜出。
    if (count > winnerCount) {
      winner = aspect
      winnerCount = count
    }
  }
  if (winner !== undefined) return winner

  const back = obj.back as Record<string, unknown> | null | undefined
  return readAspect(back?.aspect) ?? DEFAULT_CARD_ASPECT
}

/** 去掉卡面上的 `aspect`（v8 起卡面不再持有比例）。非对象原样返回。 */
function withoutAspect<T>(face: T): T {
  if (typeof face !== "object" || face === null) return face
  const copy = { ...(face as Record<string, unknown>) }
  delete copy.aspect
  return copy as T
}

/**
 * 版本守卫 + 升级。
 *
 * 保留这个函数是为了：(1) 挡住**比当前版本更新**的数据（由新版本程序写出，旧版本无法安全降级）；
 * (2) 给结构性变更留一个唯一的落点。
 *
 * @param raw - 任意待迁移数据（通常来自 `JSON.parse`），可能不是对象。
 * @returns 迁移后的数据；对非对象入参、以及已经是当前版本的入参，返回原值（同一引用）。
 * @throws 当 `schemaVersion` 高于 {@link CURRENT_SCHEMA_VERSION} 时抛出错误。
 */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw
  const obj = raw as Record<string, unknown>
  const version = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`数据版本过新: ${version} > ${CURRENT_SCHEMA_VERSION}`)
  }
  if (version === CURRENT_SCHEMA_VERSION) return obj

  // v7 → v8：宽高比从每张卡收到系列上。卡背与卡面的 `aspect` 一并丢弃——校验时也会被丢掉，
  // 这里显式删掉，好让 `migrate` 自己的输出就是干净的当前版本。
  const cards = Array.isArray(obj.cards) ? obj.cards.map(withoutAspect) : undefined
  const hiddenCards = Array.isArray(obj.hiddenCards) ? obj.hiddenCards.map(withoutAspect) : undefined
  const back =
    obj.back === undefined || obj.back === null ? obj.back : withoutAspect(obj.back)
  const aspect = readAspect(obj.aspect) ?? aspectFromV7(obj)

  return {
    ...obj,
    ...(cards ? { cards } : {}),
    ...(hiddenCards ? { hiddenCards } : {}),
    back,
    aspect,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }
}

/**
 * 解析并校验一个系列：先 `migrate` 过版本守卫，再交给 `PackSchema` 校验并填充默认值。
 *
 * @param raw - 任意待解析数据。
 * @returns 字段完整的 {@link Pack}（当前版本）。
 * @throws 版本过新或数据不符合 schema 时抛出错误。
 */
export function parsePack(raw: unknown): Pack {
  return PackSchema.parse(migrate(raw))
}
