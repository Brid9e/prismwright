/**
 * `importErrorMessage` 的穷尽性测试。
 *
 * 本用例存在的理由：`importAsset` 的失败原因是四种，而 `pickAsset` 早期只对
 * `unsupported-format` 一种弹窗、其余三种静默吞掉——用户点一下「没反应」却看不到
 * 任何提示。组件层在本阶段无法做 DOM 测试，故把「原因 → 文案」抽成纯函数，
 * 用本测试钉住「四种原因都产出文案」——将来新增第五种原因而漏写文案时，
 * `Record` 会在类型层直接编不过，而这里会断在运行期。
 */
import { describe, it, expect } from "vitest"
import type { TFunction } from "i18next"
import type { ImportResult } from "../../../store/packStore"
import { importErrorMessage, type ImportFailureReason } from "../import-error"

/** 四个失败原因各取一个样本（`copy-failed` 带上 message）。 */
const CASES: Array<Extract<ImportResult, { ok: false }>> = [
  { ok: false, reason: "no-pack" },
  { ok: false, reason: "no-target" },
  { ok: false, reason: "unsupported-format" },
  { ok: false, reason: "copy-failed", message: "EACCES" },
]

/** 四种原因逐一，用于确保样本覆盖完整（将来加第五种时这里也会提示）。 */
const REASONS: ImportFailureReason[] = ["no-pack", "no-target", "unsupported-format", "copy-failed"]

/**
 * 模拟绑定 `errors` 命名空间的 `t`：查真实文案表而非回显 key，并做 `{{x}}` 插值。
 *
 * 之所以不用真实 i18next 实例：`importErrorMessage` 只依赖 `t` 的调用契约，
 * 这里用最小替身即可，且能断言「文案不等于原始 key 名」。
 */
const CATALOG: Record<string, string> = {
  noPack: "尚未打开系列。",
  noTarget: "未选择导入目标。",
  unsupportedImage: "不支持的图片格式：仅接受 PNG / JPG / WebP。",
  copyFailed: "图片导入失败：{{message}}",
}

const tErrors = ((key: string, opts?: Record<string, unknown>) => {
  let out = CATALOG[key] ?? key
  for (const [k, v] of Object.entries(opts ?? {})) {
    out = out.split(`{{${k}}}`).join(String(v))
  }
  return out
}) as unknown as TFunction

describe("importErrorMessage", () => {
  it("样本恰好覆盖四种失败原因", () => {
    expect(CASES.map((c) => c.reason).sort()).toEqual([...REASONS].sort())
  })

  it.each(CASES)("$reason 产出非空文案", (result) => {
    expect(importErrorMessage(result, tErrors).length).toBeGreaterThan(0)
  })

  it.each(CASES)("$reason 的文案不等于其原始 key 名（不会把 key 漏给用户）", (result) => {
    expect(importErrorMessage(result, tErrors)).not.toBe(result.reason)
  })

  it("copy-failed 把 message 插值进文案", () => {
    const msg = importErrorMessage({ ok: false, reason: "copy-failed", message: "EACCES" }, tErrors)
    expect(msg).toContain("EACCES")
  })

  it("copy-failed 缺省 message 时仍产出文案", () => {
    const msg = importErrorMessage({ ok: false, reason: "copy-failed" }, tErrors)
    expect(msg.length).toBeGreaterThan(0)
    expect(msg).not.toBe("copy-failed")
  })
})
