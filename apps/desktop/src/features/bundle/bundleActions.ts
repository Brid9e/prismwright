/**
 * 导入工程文件的入口动作（菜单项 `file.import`）。
 *
 * 先 `inspect`（解密 + 读清单、不落盘），确认是合法工程后再弹对话框让用户预览内容。
 * 「打开文件选择器 → 检查 → 弹窗」之所以拆成动作层而不是放在对话框里：对话框只有
 * 在文件已经合法时才该出现，损坏的文件用 `window.alert` 直接回报即可。
 */
import i18n from "../../i18n/init"
import { useUiStore } from "../../store/uiStore"
import { BundleInvalidError, bundleFs } from "../../tauri/bundle"
import { packFs } from "../../tauri/pack-fs"

/** 把导入相关的异常翻译成用户可读的一句话。 */
export function formatBundleError(error: unknown): string {
  if (error instanceof BundleInvalidError) return i18n.t("bundle:import.invalid")
  const message = error instanceof Error ? error.message : String(error)
  return i18n.t("bundle:import.failed", { message })
}

/** 选择并检查一个工程文件；合法则打开导入对话框。 */
export async function pickBundleForImport(): Promise<void> {
  const path = await packFs.pickFile([
    { name: i18n.t("bundle:filterName"), extensions: ["card", "cards"] },
  ])
  if (!path) return
  try {
    const info = await bundleFs.inspect(path)
    useUiStore.getState().openBundleImport(path, info)
  } catch (e) {
    window.alert(formatBundleError(e))
  }
}
