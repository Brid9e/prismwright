/**
 * 选中主题 id 的持久化。
 *
 * 与 `language.ts` / `packDir.ts` 同库（`preferences.json`）、同模式：读不出来一律静默
 * 回退默认，绝不因首选项读取失败拦住应用启动。
 */
import { load } from "@tauri-apps/plugin-store"
import { DEFAULT_THEME_ID } from "../themes/builtin"

/** 存储文件与键名（与 `language.ts`、`packDir.ts` 共用同一份首选项文件）。 */
const STORE_PATH = "preferences.json"
const THEME_KEY = "theme"

/**
 * 读取持久化的主题 id。
 *
 * @returns 已保存且非空的 id；未保存或读取失败时回退 {@link DEFAULT_THEME_ID}。
 */
export async function loadThemeId(): Promise<string> {
  try {
    const store = await load(STORE_PATH)
    const saved = await store.get<string>(THEME_KEY)
    // 空串或非字符串都视作「没选过」——避免脏数据把主题 id 变成空白。
    return typeof saved === "string" && saved.length > 0 ? saved : DEFAULT_THEME_ID
  } catch {
    // 首选项读不出来不该拦住应用启动，静默回退默认主题。
    return DEFAULT_THEME_ID
  }
}

/**
 * 持久化主题 id。
 *
 * @param id - 选中的主题 id。
 */
export async function saveThemeId(id: string): Promise<void> {
  try {
    const store = await load(STORE_PATH)
    await store.set(THEME_KEY, id)
    await store.save()
  } catch {
    // 写失败只影响下次启动的默认主题，不值得打断用户。
  }
}
