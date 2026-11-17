/**
 * `importAsset` 失败原因 → 用户可读文案的**唯一**映射。
 *
 * 背景：`importAsset` 的失败原因有四种（`no-pack` / `no-target` / `unsupported-format` /
 * `copy-failed`），而 UI 早期只对 `unsupported-format` 一种弹窗，其余三种被静默吞掉——
 * 用户点了「导入图片」却看不到任何反馈，正是 `importAsset` 注释里要避免的
 * 「用户只看到点击没反应」。把映射抽成一个纯函数，各调用点（卡面图、图层蒙版）
 * 共用同一份逻辑，既不重复也不会漏。
 *
 * 为什么用 `Record`（穷尽）而非 `switch`：本仓库的 `tsconfig` 未开 `noImplicitReturns`，
 * 一个漏了分支的 `switch` 会编译通过并静默返回 `undefined`——正是本缺陷的成因。
 * `Record<ImportFailureReason, ...>` 天生穷尽：将来给 `ImportResult` 加第五种原因时，
 * 这里会直接**编译报错**，而不是又变成一个静默失败。
 *
 * 命名空间约定：`importErrorMessage` 内部用**不带前缀**的键（`t("noPack")`），
 * 因此传入的 `t` 必须绑定 `errors` 命名空间（`useTranslation("errors")` 的 `t`）。
 * 传入别的命名空间的 `t` 会把原始 key 名（如 `noPack`）直接渲染给用户。
 */
import type { TFunction } from "i18next"
import type { ImportResult } from "../../store/packStore"

/** `importAsset` 的四种失败原因。 */
export type ImportFailureReason = Extract<ImportResult, { ok: false }>["reason"]

/** 原因 → 文案。用 `Record`（穷尽）而非 `switch`：漏一种原因在类型层面就编不过。 */
const MESSAGES: Record<ImportFailureReason, (t: TFunction, message?: string) => string> = {
  "no-pack": (t) => t("noPack"),
  "no-target": (t) => t("noTarget"),
  "unsupported-format": (t) => t("unsupportedImage"),
  "copy-failed": (t, message) => t("copyFailed", { message: message ?? "" }),
}

/**
 * 把一次失败的导入结果翻译成给用户看的文案。
 *
 * @param result - `importAsset` 的失败结果（`ok: false`）。
 * @param t - **绑定 `errors` 命名空间**的翻译函数。
 * @returns 该原因对应的本地化文案；`copy-failed` 会带上底层错误信息。
 */
export function importErrorMessage(
  result: Extract<ImportResult, { ok: false }>,
  t: TFunction,
): string {
  return MESSAGES[result.reason](t, result.message)
}
