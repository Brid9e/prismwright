/**
 * 抽卡概率对话框：给五档稀有度填权重，写进 `pack.rarityProbabilities`。
 *
 * 为什么要有它：服务端抽卡只认这张权重表，而在此之前编辑器没有任何地方能写它——
 * 于是每个系列都是「按卡数均匀」，隐藏款永远抽不到。这里补上配置面。
 *
 * 只填相对权重、不要求凑满 100：服务端按总和归一，用户填 50 / 30 / 15 / 5 或
 * 5 / 3 / 1.5 / 0.5 是同一件事。面板右侧实时折算成百分比，并标出每档有多少张卡——
 * 权重为正而该档无卡时，服务端会兜底到全部卡片均匀抽，这件事必须写明，否则用户会
 * 以为设了 5% 就真有 5%。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"
import { NumberField } from "../../ui/NumberField"
import {
  PROBABILITY_TIERS,
  probabilityIssues,
  probabilityPercents,
  sanitizeProbabilities,
  tierCardCount,
  weightsOf,
  type ProbabilityTier,
  type TierWeights,
} from "./probability"

/** 五档全 0 的权重表。 */
function emptyWeights(): TierWeights {
  return weightsOf({})
}

export function ProbabilityDialog() {
  const { t } = useTranslation("editor")
  const open = useUiStore((s) => s.pendingProbabilities)
  const resolve = useUiStore((s) => s.resolveProbabilities)
  const pack = usePackStore((s) => s.pack)
  const setRarityProbabilities = usePackStore((s) => s.setRarityProbabilities)
  const [weights, setWeights] = useState<TierWeights>(emptyWeights)

  // 每次弹出都从磁盘上的当前值起步。只在打开时刻取一次：对话框开着时外部改动
  // （撤销 / 关系列）不该把用户正在填的数字冲掉。
  useEffect(() => {
    if (!open) return
    setWeights(weightsOf(usePackStore.getState().pack?.rarityProbabilities))
  }, [open])

  const percents = probabilityPercents(weights)
  const weighted = sanitizeProbabilities(weights)

  const warnings = probabilityIssues(weights, pack).map((issue) =>
    issue.kind === "hiddenUnreachable"
      ? t("probability.hiddenUnreachable", { cards: issue.cards })
      : t("probability.tierEmpty", { name: t(`probability.tier.${issue.tier}`) }),
  )

  function confirm() {
    if (!open) return
    setRarityProbabilities(weights)
    resolve()
  }

  return (
    <DialogShell
      open={open}
      title={t("probability.title")}
      description={t("probability.hint")}
      onClose={resolve}
      className="w-[22rem] p-3"
    >
      <div className="mt-1 border-y border-border py-1">
        {PROBABILITY_TIERS.map((tier) => (
          <PercentageRow
            key={tier}
            tier={tier}
            weight={weights[tier]}
            percent={percents[tier]}
            cards={tierCardCount(pack, tier)}
            onChange={(value) => setWeights((w) => ({ ...w, [tier]: value }))}
          />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        {Object.keys(weighted).length === 0
          ? t("probability.unweighted")
          : t("probability.hiddenHint")}
      </p>
      {warnings.map((text) => (
        <p key={text} className="mt-1 text-[11px] leading-relaxed text-warning">
          {text}
        </p>
      ))}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={resolve}
          className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated"
        >
          {t("common:action.cancel")}
        </button>
        <button
          type="button"
          onClick={confirm}
          className="h-6 rounded-sm bg-accent px-3 text-[12px] text-accent-foreground hover:bg-accent-hover"
        >
          {t("common:action.confirm")}
        </button>
      </div>
    </DialogShell>
  )
}

interface PercentageRowProps {
  tier: ProbabilityTier
  weight: number
  percent: number
  /** 该档在服务端能落到的卡片数。 */
  cards: number
  onChange: (value: number) => void
}

/** 一行：档位名 + 该档卡数 + 折算后的百分比 + 权重输入框。 */
function PercentageRow({ tier, weight, percent, cards, onChange }: PercentageRowProps) {
  const { t } = useTranslation("editor")
  return (
    <div className="flex h-8 items-center gap-2">
      <span className="w-16 shrink-0 text-[12px] text-foreground">
        {t(`probability.tier.${tier}`)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-disabled">
        {t("probability.cardCount", { cards })}
      </span>
      {/* 百分比跟着权重一起变，宽度固定成右对齐的一列，避免数字跳动时整行抖动。 */}
      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted">
        {percent === 0 ? "—" : `${percent}%`}
      </span>
      <NumberField value={weight} onChange={onChange} min={0} max={10000} step={1} precision={0} />
    </div>
  )
}
