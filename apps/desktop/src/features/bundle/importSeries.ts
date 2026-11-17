/**
 * 系列工程（`.cards`）导入。
 *
 * 两件事分开：`nextAvailableDir` 只算一个不重名的目标目录；`importSeriesBundle` 负责
 * 安装、重铸身份、打开与登记最近列表。
 *
 * 为什么重铸 `pack.id`：系列身份靠 id。导入的若是「自己的备份」，同 id 会和本地那份撞车；
 * 最近列表、云上记录都以 id 区分，撞了就成了同一个系列。改名同理——目录名只是磁盘位置，
 * 显示名取 `pack.json` 里的 `name`。
 */
import { parsePack } from "@cardbara/schema"
import { join, toPackDirName } from "../../app/path"
import { usePackStore } from "../../store/packStore"
import { useRecentStore } from "../../store/recentStore"
import { packFs } from "../../tauri/pack-fs"
import { bundleFs } from "../../tauri/bundle"
import type { BundleManifest } from "./model"

/** 同名目录的序号上限：到这个数说明目录已经脏得不像话，宁可报错也不无限试。 */
const MAX_SUFFIX = 1000

/**
 * 在 `base` 下找一个不重名的目录路径（只计算，不创建）。
 *
 * 先试 `base/name`，被占用则依次试 `base/name (2)`、`base/name (3)`…；`exists` 便于
 * 测试注入，默认查磁盘。
 *
 * @throws 连续 {@link MAX_SUFFIX} 个候选都被占用。
 */
export async function nextAvailableDir(
  base: string,
  name: string,
  exists: (path: string) => Promise<boolean> = (path) => packFs.pathExists(path),
): Promise<string> {
  const first = join(base, name)
  if (!(await exists(first))) return first
  for (let i = 2; i <= MAX_SUFFIX; i += 1) {
    const candidate = join(base, `${name} (${i})`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`同名目录过多（${name}），请换一个系列目录`)
}

/**
 * 把 `.cards` 安装成 `destBase` 下的新系列并打开它。
 *
 * 安装（解包 + 落盘）由 Rust 原子完成；这里只做「装到哪个目录」与「装完怎么登记」。
 *
 * @param path - 工程文件绝对路径。
 * @param manifest - 已解析的清单（导入对话框用它展示名字与卡数）。
 * @param destBase - 新系列的父目录。
 * @returns 新系列的根目录与实际显示名。
 */
export async function importSeriesBundle(
  path: string,
  manifest: BundleManifest,
  destBase: string,
): Promise<{ rootDir: string; name: string }> {
  if (!destBase) throw new Error("还没有设置系列目录")
  // 切换工作区前先落盘：`openPack` 会整体替换 pack，未保存的改动随旧引用一起丢掉
  // （同 `closePackFlow` / `openPackFlow` 的约定）。
  await usePackStore.getState().save()
  // 同 `runBundleExport`：save 吞写盘异常，不显式检查就会带着未保存的旧系列继续切换。
  const saved = usePackStore.getState()
  if (saved.saveStatus === "error") {
    throw new Error(saved.lastError ?? "保存当前系列失败，已取消导入")
  }

  const dest = await nextAvailableDir(destBase, toPackDirName(manifest.series?.name ?? ""))
  const installed = await bundleFs.install(path, dest)
  const rootDir = installed.dir

  // 安装之后、打开之前的任何失败都要把已装目录删掉：否则会留下一个半成品系列，
  // 里面还带着导出方的 pack.id（见规格 §5.3.8）。
  try {
    const packJson = join(rootDir, "pack.json")
    const pack = parsePack(JSON.parse(await packFs.readText(packJson)))
    pack.id = crypto.randomUUID()
    await packFs.writeTextAtomic(packJson, JSON.stringify(pack, null, 2))
  } catch (e) {
    await bundleFs.discardInstall(rootDir).catch(() => {})
    throw e
  }

  await usePackStore.getState().openPack(rootDir)
  const opened = usePackStore.getState().pack
  // openPack 吞异常、只置错误态；这里把它换成一个可捕获的失败，让对话框能提示。
  if (!opened) {
    await bundleFs.discardInstall(rootDir).catch(() => {})
    throw new Error("导入的系列无法打开")
  }
  // 最近列表只是便利入口：写失败不该把一次已成功的导入报成失败。
  await useRecentStore.getState().push({ name: opened.name, rootDir }).catch(() => {})
  return { rootDir, name: opened.name }
}
