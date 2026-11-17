/**
 * 抽卡概率的纯逻辑：编辑器写进 `pack.rarityProbabilities` 的那张权重表。
 *
 * 语义与小程序云函数 `cloudfunctions/buling/lib/draw-pick.js` 逐条对齐：
 * - 权重是**相对值**，服务端按总和归一（填 50 / 30 / 15 / 5 与填 0.5 / 0.3 / 0.15 / 0.05 等价）；
 * - 空表 = 现状：在全部卡片里按卡数均匀抽，隐藏款抽不到（这也是老系列的行为）；
 * - 隐藏款不是 `Card.rarity` 的取值，它对应 `pack.hiddenCards`，只有权重为正时才可达；
 * - 某档有正权重、但包里没有该稀有度的卡时，服务端会兜底到「全部卡片均匀抽」，
 *   于是这份权重实际上落到了别的档上——面板要把这件事如实说出来，而不是假装生效。
 */
import type { Pack } from "@cardbara/schema"

/**
 * 可配置的档位，顺序即面板上的行序（低 → 高，隐藏款压在最后）。
 *
 * 与服务端 `TIERS` 同序：`weightedRarity` 按这个顺序滚动，顺序本身不改变概率，
 * 但两边不一致时读代码的人会以为有差别。
 */
export const PROBABILITY_TIERS = ["common", "rare", "epic", "legendary", "hidden"] as const

/** 档位 id。 */
export type ProbabilityTier = (typeof PROBABILITY_TIERS)[number]

/** 一份完整的档位表（每档必有值，缺的按 0 算）。 */
export type TierWeights = Record<ProbabilityTier, number>

/**
 * 把存盘的权重表补成完整的五档。
 *
 * @param probs - `pack.rarityProbabilities`（键可缺省、可带服务端不认识的键）。
 * @returns 五档齐全的权重；缺失或非法的档位为 0。
 */
export function weightsOf(probs: Record<string, number> | undefined): TierWeights {
  const out = {} as TierWeights
  for (const tier of PROBABILITY_TIERS) {
    const raw = Number(probs?.[tier])
    out[tier] = Number.isFinite(raw) && raw > 0 ? raw : 0
  }
  return out
}

/**
 * 把面板上的五档权重整理成要落盘的表。
 *
 * 负数 / NaN 归 0；权重为 0 的档位**不写进记录**——空记录就是「按卡数均匀」，
 * 与服务端的语义对齐，也让「全部清 0」得到一份和新建系列完全一样的 `pack.json`。
 *
 * @param weights - 五档权重。
 * @returns 只含正权重档位的记录；全 0 时为空对象。
 */
export function sanitizeProbabilities(weights: TierWeights): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tier of PROBABILITY_TIERS) {
    const weight = weights[tier]
    if (Number.isFinite(weight) && weight > 0) out[tier] = weight
  }
  return out
}

/**
 * 判断两份权重表在服务端眼里是否等价（只看五档，0 与缺省同义）。
 *
 * 面板点「确定」但没改任何数字时不该多出一个撤销点，故写入前用它比对现状。
 *
 * @param a - 一份权重表（通常来自 store）。
 * @param b - 另一份权重表（通常来自面板）。
 */
export function sameProbabilities(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  const wa = weightsOf(a)
  const wb = weightsOf(b)
  return PROBABILITY_TIERS.every((tier) => wa[tier] === wb[tier])
}

/**
 * 把权重折算成百分比，用于面板上的实时预览。
 *
 * 与服务端一致：按总和归一；总和为 0 时全部给 0（此时服务端走「按卡数均匀」）。
 * 保留一位小数——四舍五入到整数时，5% 与 5.4% 看起来一样，用户会以为档位没生效。
 *
 * @param weights - 五档权重。
 * @returns 五档各占的百分比（0–100）。
 */
export function probabilityPercents(weights: TierWeights): TierWeights {
  const total = PROBABILITY_TIERS.reduce((sum, tier) => sum + Math.max(0, weights[tier]), 0)
  const out = {} as TierWeights
  for (const tier of PROBABILITY_TIERS) {
    out[tier] = total > 0 ? Math.round((Math.max(0, weights[tier]) / total) * 1000) / 10 : 0
  }
  return out
}

/**
 * 面板上的一类提示：服务端行为与用户预期不一致的地方。
 */
export type ProbabilityIssue =
  | { kind: "hiddenUnreachable"; cards: number }
  | { kind: "tierEmpty"; tier: ProbabilityTier }

/**
 * 统计每一档实际有多少张卡。
 *
 * 普通卡按 `rarity` 归入对应档位；隐藏卡是一整组（不按稀有度再分），直接等于
 * `hiddenCount`。云端系列与本地编辑器共用这份统计，所以输入只要求 `rarity`。
 *
 * @param cards - 普通卡列表。
 * @param hiddenCount - 隐藏卡数量。
 */
export function tierCounts(
  cards: Array<{ rarity?: string }>,
  hiddenCount: number,
): TierWeights {
  const out: TierWeights = { common: 0, rare: 0, epic: 0, legendary: 0, hidden: hiddenCount }
  for (const card of cards) {
    const rarity = card.rarity
    if (rarity && rarity !== "hidden" && (PROBABILITY_TIERS as readonly string[]).includes(rarity)) {
      out[rarity as ProbabilityTier] += 1
    }
  }
  return out
}

/**
 * 某一档在服务端滚动时能落到的卡片数。
 *
 * 面板据此提示「这一档没有卡片，权重不会真的作用在本档上」。
 *
 * @param pack - 当前系列；未打开时为 `null`。
 * @param tier - 档位。
 */
export function tierCardCount(pack: Pack | null, tier: ProbabilityTier): number {
  if (!pack) return 0
  return tierCounts(pack.cards, pack.hiddenCards.length)[tier]
}

/**
 * 由「权重 + 各档卡数」算出要提示的问题（文案由调用方按语言翻译）。
 *
 * 两类：
 * - `hiddenUnreachable`：包里藏着隐藏卡、权重却是 0——服务端永远不会滚到这一档，
 *   卡等于不存在。这是「怎么一直抽不到」最常见的成因，必须在配置页说破；
 * - `tierEmpty`：给了权重、这一档却没有卡——服务端会兜底到全部卡片均匀抽，
 *   权重并不作用在本档上。
 *
 * 权重全 0 时不报 `hiddenUnreachable`：那已经是「按卡数均匀」的整体语义，
 * 面板另有一句总说明，逐档再提一遍只会重复。
 *
 * @param weights - 五档权重。
 * @param counts - 各档卡数（见 {@link tierCounts}）。
 */
export function probabilityIssuesFor(weights: TierWeights, counts: TierWeights): ProbabilityIssue[] {
  const issues: ProbabilityIssue[] = []
  const weighted = Object.keys(sanitizeProbabilities(weights)).length > 0
  // 全 0 时由面板的总说明兜住，这里不重复。
  if (weighted && counts.hidden > 0 && weights.hidden === 0)
    issues.push({ kind: "hiddenUnreachable", cards: counts.hidden })
  for (const tier of PROBABILITY_TIERS) {
    if (weights[tier] > 0 && counts[tier] === 0) issues.push({ kind: "tierEmpty", tier })
  }
  return issues
}

/**
 * 面板上要提示的问题（本地系列版本）。
 *
 * @param weights - 五档权重。
 * @param pack - 当前系列。
 */
export function probabilityIssues(weights: TierWeights, pack: Pack | null): ProbabilityIssue[] {
  const counts = pack ? tierCounts(pack.cards, pack.hiddenCards.length) : tierCounts([], 0)
  return probabilityIssuesFor(weights, counts)
}
