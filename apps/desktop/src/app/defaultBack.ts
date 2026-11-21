/**
 * 「编辑默认卡背」这条链路的编排。
 *
 * 默认卡背是应用数据目录下的一份**普通系列**（见 `features/default-back`）：进入编辑 =
 * 打开它，退出编辑 = 打开回原来的系列。这样图层面板、效果栈、拾色、擦除、实时预览、撤销
 * 与自动保存全部原样复用，不必为一个全局对象另造一套编辑链路。
 *
 * 与 `packActions` 同一约定：切换前先 `save()`，未落盘的改动不能随系列替换丢掉。
 */
import { collectFaceAssets } from "@prismwright/schema"
import i18n from "../i18n/init"
import { usePackStore } from "../store/packStore"
import { useDefaultBackStore } from "../store/defaultBackStore"
import { useUiStore } from "../store/uiStore"
import { packFs } from "../tauri/pack-fs"
import {
  createDefaultBackFace,
  isDefaultBackPack,
} from "../features/default-back/default-back"
import { join } from "./path"

/**
 * 进入默认卡背编辑前所在的系列目录。
 *
 * 只活在当前会话：重启后「完成」按钮退回启动屏，而不是拿一个可能早已失效的旧路径去打开。
 * 本文件内的可变状态刻意不进 store——它不驱动渲染，驱动渲染的「是否正在编辑」由
 * `rootDir` 判定。
 */
let returnToRoot: string | null = null

/**
 * 进入默认卡背编辑。
 *
 * 工程不存在时先建一份，并预置内置造型（全息底纹 + 品牌字）——空的卡背在预览里是一片
 * 透明，看起来像坏了。已存在则直接打开，保留用户此前做好的样子。
 *
 * 取不到应用数据目录（dev:web 无 Tauri）时提示并留在原处，不静默失败。
 *
 * @param name - 首次创建时给这份工程起的名字（由调用方按当前语言给出：名字是数据，
 *   创建时就写定，之后不随语言变化）。
 */
export async function editDefaultBackFlow(name: string): Promise<void> {
  const db = useDefaultBackStore.getState()
  if (!db.loaded) await db.load()
  const root = useDefaultBackStore.getState().rootDir
  if (!root) {
    window.alert(i18n.t("settings:defaultBack.unavailable"))
    return
  }

  const current = usePackStore.getState().rootDir
  // 已经在编辑默认卡背（例如从设置里再次点进来）：只需退回编辑器。
  if (isDefaultBackPack(current, root)) {
    useUiStore.getState().setSettingsOpen(false)
    useUiStore.getState().setPreviewSide("back")
    return
  }

  await usePackStore.getState().save()
  returnToRoot = current

  if (await packFs.isPackDir(root)) {
    await usePackStore.getState().openPack(root)
  } else {
    await usePackStore.getState().newPack(name, root)
    if (!usePackStore.getState().pack) {
      // 建工程失败（磁盘 / 权限）：错误已由 store 置进状态栏，这里别留下一个假的「返回」目标。
      returnToRoot = null
      return
    }
    usePackStore.getState().commit((d) => {
      d.back = createDefaultBackFace()
    })
    await usePackStore.getState().save()
  }

  // 打开失败（文件损坏）时 pack 为空，此时留在设置里并给出错误状态栏。
  if (!usePackStore.getState().pack) {
    returnToRoot = null
    return
  }

  const opened = usePackStore.getState()
  useDefaultBackStore.getState().observe(opened.rootDir, opened.pack?.back ?? null)
  useUiStore.getState().setSettingsOpen(false)
  useUiStore.getState().setPreviewSide("back")
}

/**
 * 把默认卡背「另存」为本系列自己的卡背。
 *
 * 素材要跟着搬进本系列：卡面里的路径是**相对各自根目录**的，只抄数据会让本系列
 * 解析不到默认工程里的图。搬不动的（源文件已丢）跳过——缺图会在预览里挂警示徽标，
 * 不该因此拦下整个动作。
 */
export async function customizeBackFlow(): Promise<void> {
  const { pack, rootDir } = usePackStore.getState()
  const { face: defaultFace, rootDir: defaultRoot } = useDefaultBackStore.getState()
  if (!pack || pack.back || !defaultFace) return

  if (rootDir && defaultRoot) {
    for (const rel of collectFaceAssets(defaultFace)) {
      try {
        await packFs.copyAsset(join(defaultRoot, rel), rootDir, rel)
      } catch {
        // 源文件缺失：保留引用，交给预览的缺图提示。
      }
    }
  }
  // 深拷贝：本系列的卡背从此与全局那份分道扬镳，改一边不影响另一边。
  usePackStore.getState().commit((d) => {
    d.back = structuredClone(defaultFace)
  })
}

/**
 * 退出默认卡背编辑：回到进来之前的系列。
 *
 * 原系列已被移走 / 删除时退回启动屏——比打开失败后把用户丢在一个空白编辑器里好。
 * 卡背的改动随 `save()` 落进它自己的工程，不必在这里额外写盘。
 */
export async function leaveDefaultBackFlow(): Promise<void> {
  await usePackStore.getState().save()
  const root = returnToRoot
  returnToRoot = null

  if (root && (await packFs.isPackDir(root))) {
    await usePackStore.getState().openPack(root)
    // 回系列后默认看正面：默认卡背只在背面出现，停在背面会让人以为系列没打开。
    useUiStore.getState().setPreviewSide("front")
    return
  }
  usePackStore.getState().closePack()
}
