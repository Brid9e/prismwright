/**
 * `NumberField` 的纯逻辑：显示格式化与「这次提交到底该不该发生」的判定。
 *
 * 抽出来的原因：本阶段没有组件级 DOM 测试，规则留在组件里就只能靠肉眼验证。
 */

/** 把数值格式化成显示文本：保留 `precision` 位小数、去掉尾随零。 */
export function formatNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)))
}

/** 一次输入提交的判定结果。 */
export interface NumberCommit {
  /** 应当回填进输入框的文本。 */
  display: string
  /** 应当向上抛出的值；`null` 表示这次**不提交**。 */
  value: number | null
}

/**
 * 判定一次提交（失焦或回车）。
 *
 * @param text - 输入框当前文本。
 * @param current - 当前值。
 * @param opts - 约束与显示精度。
 * @returns 回填文本，以及要提交的值（`null` 表示什么都不做）。
 */
export function resolveNumberInput(
  text: string,
  current: number,
  opts: { min?: number; max?: number; precision: number },
): NumberCommit {
  const { min, max, precision } = opts
  const currentDisplay = formatNumber(current, precision)
  // 空串/纯空白必须显式判掉：`Number("")` 是 0 而非 NaN，会被当成一次合法提交。
  const parsed = text.trim() === "" ? NaN : Number(text)
  if (!Number.isFinite(parsed)) return { display: currentDisplay, value: null }
  const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
  // 文本仍是当前值的显示形式 ⇒ 用户压根没编辑过。此时绝不能提交：否则点进
  // 输入框再点出去就会把 value 抹成显示精度（0.8567 → 0.857）并推一个历史点。
  if (text === currentDisplay) return { display: currentDisplay, value: null }
  return {
    display: formatNumber(clamped, precision),
    // 编辑后回到同一个值也不提交——`commitFace` 没有值相等早退，空提交会在
    // 撤销栈里留下一个「按了没反应」的点。
    value: clamped === current ? null : clamped,
  }
}
