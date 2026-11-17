/**
 * 编辑器版本的持久化。
 *
 * 与 `language.ts` 同一套做法：用 `tauri-plugin-store` 存在应用数据目录的
 * `preferences.json` 里——它是应用偏好，不属于系列数据，不写进 `pack.json`。
 */
import { load } from "@tauri-apps/plugin-store"
import { DEFAULT_EDITOR_VERSION, isEditorVersion, type EditorVersion } from "./editorVersions"

/** 存储文件与键名。 */
const STORE_PATH = "preferences.json"
const EDITOR_VERSION_KEY = "editorVersion"

/**
 * 读取持久化的编辑器版本。
 *
 * @returns 已保存且受支持的版本；未保存、未知版本或读取失败时回退默认。
 */
export async function loadEditorVersion(): Promise<EditorVersion> {
  try {
    const store = await load(STORE_PATH)
    const saved = await store.get<string>(EDITOR_VERSION_KEY)
    return isEditorVersion(saved) ? saved : DEFAULT_EDITOR_VERSION
  } catch {
    // 首选项读不出来不该拦住应用启动，静默回退默认版本。
    return DEFAULT_EDITOR_VERSION
  }
}

/**
 * 持久化编辑器版本。
 *
 * @param version - 要保存的版本。
 */
export async function saveEditorVersion(version: EditorVersion): Promise<void> {
  try {
    const store = await load(STORE_PATH)
    await store.set(EDITOR_VERSION_KEY, version)
    await store.save()
  } catch {
    // 写失败只影响下次启动的版本选择，不值得打断用户。
  }
}
