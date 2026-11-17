/**
 * 语言的持久化。
 *
 * 用 `tauri-plugin-store`（Rust 侧已装配、capability 已放行）而非 localStorage：
 * 首选项属于应用配置，放在系统的应用数据目录里比塞进 WebView 的存储更合适，
 * 也不受 WebView 数据清理影响。
 */
import { load } from "@tauri-apps/plugin-store"
import { isLanguage, type Language } from "../i18n/init"

/** 存储文件与键名。 */
const STORE_PATH = "preferences.json"
const LANGUAGE_KEY = "language"

/**
 * 读取持久化的语言。
 *
 * @returns 已保存且受支持的语言；未保存或读取失败时回退 `zh-CN`。
 */
export async function loadLanguage(): Promise<Language> {
  try {
    const store = await load(STORE_PATH)
    const saved = await store.get<string>(LANGUAGE_KEY)
    return isLanguage(saved) ? saved : "zh-CN"
  } catch {
    // 首选项读不出来不该拦住应用启动，静默回退默认语言。
    return "zh-CN"
  }
}

/**
 * 持久化语言。
 *
 * @param language - 要保存的语言。
 */
export async function saveLanguage(language: Language): Promise<void> {
  try {
    const store = await load(STORE_PATH)
    await store.set(LANGUAGE_KEY, language)
    await store.save()
  } catch {
    // 写失败只影响下次启动的默认语言，不值得打断用户。
  }
}
