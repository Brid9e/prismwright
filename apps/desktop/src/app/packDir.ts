/**
 * 默认新建系列目录的持久化。
 *
 * 与 `language.ts` 同库（`preferences.json`）：新建系列不再每次弹原生目录框，改用这里
 * 的默认目录 + 用户输入的名字拼出落盘路径。默认值是「文档目录 / Cardbara」，用户可在
 * 设置里更换。读不出来一律静默回退，绝不拦住启动或编辑。
 */
import { documentDir } from "@tauri-apps/api/path"
import { load } from "@tauri-apps/plugin-store"
import { join } from "./path"

/** 存储文件与键名（与 `language.ts` 共用同一份首选项文件）。 */
const STORE_PATH = "preferences.json"
const NEW_PACK_DIR_KEY = "newPackDir"

/** 默认目录的末级目录名，挂在用户的「文档」目录下。 */
const DEFAULT_DIR_NAME = "Cardbara"

/**
 * 读取用户设置的默认新建目录。
 *
 * @returns 已保存的目录；未设置或读取失败时为 `null`。
 */
export async function loadNewPackDir(): Promise<string | null> {
  try {
    const store = await load(STORE_PATH)
    return (await store.get<string>(NEW_PACK_DIR_KEY)) ?? null
  } catch {
    // 首选项读不出来不该拦住启动，交给 `resolveNewPackDir` 走默认值。
    return null
  }
}

/**
 * 持久化默认新建目录。
 *
 * @param dir - 用户选定的目录绝对路径。
 */
export async function saveNewPackDir(dir: string): Promise<void> {
  try {
    const store = await load(STORE_PATH)
    await store.set(NEW_PACK_DIR_KEY, dir)
    await store.save()
  } catch {
    // 写失败只影响下次启动的默认目录，不值得打断用户。
  }
}

/**
 * 解析当前应使用的默认新建目录。
 *
 * @returns 用户设置过就用它，否则用「文档目录 / Cardbara」；非 Tauri 环境或取文档目录
 *   失败时回退空串——此时 `newPackFlow` 会把新建拦下并提示去设置里选目录。
 */
export async function resolveNewPackDir(): Promise<string> {
  const stored = await loadNewPackDir()
  if (stored) return stored
  try {
    return join(await documentDir(), DEFAULT_DIR_NAME)
  } catch {
    // dev:web：无 Tauri，`documentDir()` 会**同步**抛错（读 `__TAURI_INTERNALS__`），
    // 故整句包在 try 里；回退空串由上层提示。
    return ""
  }
}
