/**
 * 系列生命周期动作的编排。
 *
 * 把「保存 → 定目录 → 打开/新建 → 记最近」这条链路收拢到单点，供**原生菜单**、
 * **启动屏**与对话框共用——否则三处各写一遍，切换语义迟早分叉。
 *
 * 所有切换动作都**先 `save()`**：`openPack` / `closePack` 会整体替换或清空 `pack`，
 * 未落盘的改动会随之丢失（沿用原 `PackMenu` 的注释理由）。
 */
import i18n from "../i18n/init"
import { usePackStore } from "../store/packStore"
import { useRecentStore } from "../store/recentStore"
import { useUiStore } from "../store/uiStore"
import { packFs } from "../tauri/pack-fs"
import { saveNewPackDir } from "./packDir"
import { isValidPackName, join } from "./path"

/**
 * 打开某个目录下的系列。
 *
 * @param dir - 系列根目录绝对路径。
 * @param markMissing - 目录失效时是否把该条标记为「找不到」（从最近入口进入时为真）。
 */
async function openDir(dir: string, markMissing: boolean): Promise<void> {
  if (!(await packFs.isPackDir(dir))) {
    if (markMissing) {
      useRecentStore.setState((s) => ({ missing: { ...s.missing, [dir]: true } }))
    }
    window.alert(i18n.t(markMissing ? "editor:start.missing" : "editor:pack.openFailed"))
    return
  }
  await usePackStore.getState().openPack(dir)
  const pack = usePackStore.getState().pack
  // 打开失败（parsePack 拒绝）时 pack 仍为 null，状态已置 error，不记最近。
  if (pack) await useRecentStore.getState().push({ name: pack.name, rootDir: dir })
}

/** 打开系列（选目录 → 校验 → 打开 → 记最近）。 */
export async function openPackFlow(): Promise<void> {
  await usePackStore.getState().save()
  const dir = await packFs.pickDirectory()
  if (!dir) return
  await openDir(dir, false)
}

/** 从「最近打开」进入：目录已失效时标记该条并提示，而非抛通用错误。 */
export async function openRecentFlow(rootDir: string): Promise<void> {
  await usePackStore.getState().save()
  await openDir(rootDir, true)
}

/**
 * 新建系列第一步：取默认目录 → 置中间态，等 `NewPackDialog` 命名。
 *
 * **不再弹原生目录框**：默认目录在启动时由 `app/packDir.ts` 解析好、存进 `uiStore`，
 * 用户只需输入名字。默认目录为空（非 Tauri 环境解析失败）时提示去设置里选一个。
 */
export async function newPackFlow(): Promise<void> {
  await usePackStore.getState().save()
  const baseDir = useUiStore.getState().newPackDir
  if (!baseDir) {
    window.alert(i18n.t("editor:pack.noDefaultDir"))
    return
  }
  useUiStore.getState().requestNewPack(baseDir)
}

/**
 * 新建系列第二步：按确认的名字落盘并记最近。
 *
 * 名字先过 {@link isValidPackName}，再拼出 `基目录/名字`；该路径已存在则拦下——既防止
 * 覆盖用户既有的同名目录，也避免把非系列目录误当新系列打开。被拦下时**返回 `false`**，
 * 调用方（`NewPackDialog`）据此保持弹窗开启、留住用户已输入的名字，而不是关掉再报错。
 *
 * @param baseDir - 默认目录（基路径，来自 `uiStore.newPackDir`）。
 * @param name - 用户确认的系列名（已 trim）。
 * @returns 是否成功创建。
 */
export async function confirmNewPack(baseDir: string, name: string): Promise<boolean> {
  if (!isValidPackName(name)) {
    window.alert(i18n.t("editor:pack.invalidName"))
    return false
  }
  const root = join(baseDir, name)
  if (await packFs.pathExists(root)) {
    window.alert(i18n.t("editor:pack.exists", { name }))
    return false
  }
  await usePackStore.getState().newPack(name, root)
  const pack = usePackStore.getState().pack
  // 落盘失败（`newPack` 内部 catch 并置 saveStatus）时 pack 仍为 null：不记最近、不关闭弹窗。
  if (!pack) return false
  await useRecentStore.getState().push({ name: pack.name, rootDir: root })
  return true
}

/**
 * 重命名当前系列（只改显示名，**不动磁盘目录**）。
 *
 * 写 `pack.name` 走 store 的 `commit`：与其他编辑一样进撤销栈、标脏。随后立即落盘并
 * 同步「最近打开」那一条——否则关掉应用之后，启动屏上还挂着旧名。
 *
 * 名字没变（只多了首尾空白）时直接返回成功：不必白占一个撤销点、白写一次盘。
 *
 * @param name - 用户输入的新名字；首尾空白会被去掉。
 * @returns 是否发生了改名；空名或未打开系列时为 `false`。
 */
export async function confirmRenamePack(name: string): Promise<boolean> {
  const state = usePackStore.getState()
  if (!state.pack || !state.rootDir) return false
  const trimmed = name.trim()
  if (trimmed === "") return false
  if (trimmed === state.pack.name) return true
  const { rootDir } = state
  state.commit((d) => {
    d.name = trimmed
  })
  await useRecentStore.getState().rename(rootDir, trimmed)
  await usePackStore.getState().save()
  return true
}

/** 在设置里更换默认新建目录：选目录 → 写入 store 并落盘。 */
export async function chooseNewPackDir(): Promise<void> {
  try {
    const dir = await packFs.pickDirectory()
    if (!dir) return
    useUiStore.getState().setNewPackDir(dir)
    await saveNewPackDir(dir)
  } catch {
    // dev:web 无 Tauri，`pickDirectory` 会 reject；静默降级，等同用户取消（同原生菜单）。
  }
}

/** 关闭当前系列，回到启动屏。 */
export async function closePackFlow(): Promise<void> {
  await usePackStore.getState().save()
  usePackStore.getState().closePack()
}
