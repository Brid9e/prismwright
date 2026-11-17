/**
 * 单卡工程（`.card`）导入。
 *
 * 文件先由 Rust 解包到临时目录（`bundleFs.extract`），这里只做「把素材落进当前系列」
 * 与「把卡片并进列表」。临时目录无论成败都在 `finally` 里清掉——它由系统临时区承载，
 * 不清理会随每次导入累积。
 *
 * 素材去重是**按内容**而不是按路径：同名文件可能存在（两个系列里都叫 `assets/front.png`），
 * 字节相同就直接复用，不同才另存到 `assets/imported/<uuid>-<basename>`。这样反复导入
 * 同一个工程不会产生一堆内容相同的副本。
 */
import { CardSchema, collectCardAssets, type Card } from "@cardbara/schema"
import { basename, join, toPackDirName } from "../../app/path"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"
import { bundleFs } from "../../tauri/bundle"
import { nextAvailableDir } from "./importSeries"
import type { BundleManifest } from "./model"

/**
 * 递归替换对象里所有命中映射的字符串（卡片字段、效果参数、图层子树都能覆盖）。
 *
 * 不原地改：调用方拿一份新对象交给 `importCard`，源对象仍可用于比较或重试。
 */
export function remapAssetPaths<T>(value: T, mapping: Map<string, string>): T {
  if (typeof value === "string") return (mapping.get(value) ?? value) as T
  if (Array.isArray(value)) {
    return value.map((item) => remapAssetPaths(item, mapping)) as T
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      out[key] = remapAssetPaths(child, mapping)
    }
    return out as T
  }
  return value
}

/**
 * 校验清单里给出的素材相对路径。
 *
 * `card.json` 来自外部文件，不能假定路径规整：`../../../secret` 之类的写法会让
 * `join(临时目录, rel)` 解析到解包目录之外，把用户本机文件读进系列。这里按 Rust
 * `safe_join` 的同一套规则先挡掉（绝对路径、盘符、`..`、`:`、结尾点/空格）。
 *
 * @throws 路径不合法。
 */
function assertSafeAssetPath(rel: string): void {
  const segments = rel.split(/[\\/]/)
  const bad =
    rel === "" ||
    rel.startsWith("/") ||
    rel.startsWith("\\") ||
    /^[A-Za-z]:/.test(rel) ||
    segments.some(
      (s) =>
        s === "" ||
        s === "." ||
        s === ".." ||
        s.includes(":") ||
        s.endsWith(".") ||
        s.endsWith(" "),
    )
  if (bad) throw new Error(`工程内素材路径不合法：${rel}`)
}

/** 逐字节比较两个二进制缓冲区。 */
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const left = new Uint8Array(a)
  const right = new Uint8Array(b)
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/**
 * 把 `.card` 导入当前系列；没有打开的系列时按卡名新建一个再导入。
 *
 * @param path - 工程文件绝对路径。
 * @param manifest - 已解析的清单（决定卡名、目标列表与新建系列时的名字）。
 */
export async function importCardBundle(path: string, manifest: BundleManifest): Promise<void> {
  const extracted = await bundleFs.extract(path)
  try {
    const card = CardSchema.parse(
      JSON.parse(await packFs.readText(join(extracted.dir, "card.json"))),
    ) as Card

    const rootDir = await ensurePack(manifest)
    const rels = collectCardAssets(card)
    // 先整体预检：路径合法 + 包内素材齐全。任何一项不过就一个字节都不往系列里写，
    // 否则拷到一半失败会留下孤儿文件。
    for (const rel of rels) {
      assertSafeAssetPath(rel)
      if (!(await packFs.pathExists(join(extracted.dir, rel)))) {
        throw new Error(`工程内缺少素材：${rel}`)
      }
    }

    const mapping = new Map<string, string>()
    /** 本次新写入系列的文件，失败时用来回滚。 */
    const created: string[] = []
    try {
      for (const rel of rels) {
        const source = join(extracted.dir, rel)
        const target = join(rootDir, rel)
        if (!(await packFs.pathExists(target))) {
          // 目标没有同名文件：原路径落盘，卡内引用保持不变。
          await packFs.copyAsset(source, rootDir, rel)
          created.push(rel)
          mapping.set(rel, rel)
          continue
        }
        if (sameBytes(await packFs.readFileBytes(source), await packFs.readFileBytes(target))) {
          // 内容一致：复用既有文件，反复导入同一个工程不会堆副本。
          mapping.set(rel, rel)
          continue
        }
        const newRel = `assets/imported/${crypto.randomUUID()}-${basename(rel)}`
        await packFs.copyAsset(source, rootDir, newRel)
        created.push(newRel)
        mapping.set(rel, newRel)
      }

      // 清单缺 list 时按常规列表处理：老工程/手写清单不该因此落到隐藏列表里。
      const hidden = manifest.card?.list === "hiddenCards"
      usePackStore.getState().importCard(remapAssetPaths(card, mapping), hidden)
    } catch (e) {
      // 走回收站而不是直接删除：这里没有现成的「删系列内文件」命令，回收站会由下次
      // 打开系列时的 purge 自动收敛，也不会留下悬空引用。
      for (const rel of created) {
        await packFs.moveToTrash(rootDir, rel).catch(() => {})
      }
      throw e
    }
  } finally {
    // 清理失败不影响导入结果；临时目录的残留由系统临时区兜底回收。
    await bundleFs.cleanup(extracted.dir).catch(() => {})
  }
}

/**
 * 确保有打开的系列，返回其根目录。
 *
 * 没有系列时按卡名在 `uiStore.newPackDir` 下新建一个：单卡导入不该要求用户先手动建系列。
 */
async function ensurePack(manifest: BundleManifest): Promise<string> {
  const existing = usePackStore.getState().rootDir
  if (existing) return existing

  const baseDir = useUiStore.getState().newPackDir
  if (!baseDir) {
    throw new Error("尚未设置默认新建目录，请到设置里选一个。")
  }
  const name = manifest.card?.name?.trim() || manifest.series?.name?.trim() || "导入的卡片"
  const dir = await nextAvailableDir(baseDir, toPackDirName(name))
  await usePackStore.getState().newPack(name, dir)
  const rootDir = usePackStore.getState().rootDir
  if (!rootDir) throw new Error("新建系列失败")
  return rootDir
}
