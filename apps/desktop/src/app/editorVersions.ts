/**
 * 编辑器版本清单。
 *
 * 一个版本 = 编辑器 + 渲染器成套发布（类似微信开发者工具的「基础库版本」）：选 vN 意味着
 * 同时使用 vN 的编辑器行为与 `@cardbara/renderer/vN`。当前只有 v1。
 *
 * 新增版本时：往 {@link EDITOR_VERSION_IDS} 加 id、i18n 的 `settings:editorVersion.<id>`
 * 加一条，并在需要分叉的代码处按 id 接入对应实现。
 */

/** 已知版本 id；数组顺序即下拉里的展示顺序。 */
export const EDITOR_VERSION_IDS = ["v1"] as const

/** 编辑器版本的联合类型；由清单反推，增删版本时自动收窄。 */
export type EditorVersion = (typeof EDITOR_VERSION_IDS)[number]

/** 默认（也是当前唯一）版本。 */
export const DEFAULT_EDITOR_VERSION: EditorVersion = "v1"

/** 判断任意值是否为已知的编辑器版本。 */
export function isEditorVersion(value: unknown): value is EditorVersion {
  return typeof value === "string" && (EDITOR_VERSION_IDS as readonly string[]).includes(value)
}
