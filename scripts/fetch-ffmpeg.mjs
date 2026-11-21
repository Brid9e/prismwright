/**
 * 下载并解出随桌面端一起打包的 ffmpeg（Windows / LGPL 构建）。
 *
 * 为什么是「构建时下载」而不是提交进仓库：ffmpeg 压缩包 80MB 上下，入库会让每次 clone 都背着它；
 * 版本与校验值钉在 `ffmpeg.lock.json` 里，下载后逐字节对 sha256，对不上就拒绝落盘。
 *
 * 为什么选 BtbN 的 LGPL 共享构建：静态包 170MB+，共享包 80MB 左右，差的只是同目录下的几个
 * DLL；LGPL（而非 GPL）构建才能随应用一起分发而不把整个应用拖进 GPL 义务。
 *
 * 产物落在 `apps/desktop/src-tauri/binaries/ffmpeg/`（已 git 忽略），由
 * `tauri.conf.json` 的 `bundle.resources` 映射到安装包的 `ffmpeg/` 下；运行期解析见
 * `commands::init_bundled_ffmpeg`。
 *
 * 用法：`pnpm fetch:ffmpeg`（已存在则跳过，`--force` 重新下载）。
 *
 * 镜像：GitHub 在部分网络下连不上，所以官方地址失败后会再试一组转发前缀
 * （`DEFAULT_MIRRORS`）。镜像只负责传输，sha256 才是权威——校验不过就整体失败，
 * 所以任何镜像都改不了最终落盘的内容。想换/关掉镜像：`CARDBARA_FFMPEG_MIRROR`
 * 设成逗号分隔的前缀，或设成 `none` 只用官方地址。
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const lockPath = path.join(repoRoot, "scripts", "ffmpeg.lock.json")

/** 官方地址连不上时的转发前缀；前缀直接拼在完整 URL 前面。 */
export const DEFAULT_MIRRORS = ["https://gh-proxy.com/"]

/**
 * 排出去重后的候选地址。
 *
 * 默认「官方优先、镜像其次」——镜像只是 GitHub 连不上时的备胎。但用户显式设了
 * `CARDBARA_FFMPEG_MIRROR` 就等于在说「我这网络就走镜像」，此时镜像放前面：
 * 有些网络官方地址连得上却慢到 3KB/s，排在前面能把整次下载拖成几小时。
 *
 * @param {string} url - lock 里的官方下载地址。
 * @param {string[]} mirrors - 转发前缀，空白项忽略。
 * @param {{ mirrorFirst?: boolean }} [options] - 是否让镜像先试。
 * @returns {string[]} 依次尝试的地址。
 */
export function candidateUrls(url, mirrors, { mirrorFirst = false } = {}) {
  const out = mirrorFirst ? [] : [url]
  for (const m of mirrors) {
    const prefix = m.trim()
    if (!prefix) continue
    const candidate = `${prefix}${url}`
    if (candidate !== url && !out.includes(candidate)) out.push(candidate)
  }
  if (!out.includes(url)) out.push(url)
  return out
}

/**
 * 解析 `CARDBARA_FFMPEG_MIRROR`。未设置（或全空白）用默认值，`none` 表示不加镜像。
 *
 * @param {string | undefined} value - 环境变量原文。
 * @param {string[]} defaults - 未设置时的前缀列表。
 * @returns {string[]} 转发前缀列表，可能为空。
 */
export function mirrorPrefixesFromEnv(value, defaults = DEFAULT_MIRRORS) {
  if (value === undefined || !value.trim()) return defaults
  if (value.trim().toLowerCase() === "none") return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 解压 zip。Windows 自带的 `tar.exe` 是 bsdtar，能直接读 zip，不必引入额外依赖。
 *
 * @param {string} zip - zip 文件绝对路径。
 * @param {string} dest - 解压目标目录。
 */
function extractZip(zip, dest) {
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
  const res = spawnSync(tar, ["-xf", zip, "-C", dest], { stdio: "inherit" })
  if (res.error) throw new Error(`解压失败（${tar}）：${res.error.message}`)
  if (res.status !== 0) throw new Error(`解压失败（tar 退出码 ${res.status}）`)
}

/**
 * 在解压结果里找到含 `bin/ffmpeg.exe` 的那一层（BtbN 的包多套一层版本目录）。
 *
 * @param {string} dir - 解压根目录。
 * @returns {Promise<string>} 含 `bin/` 的目录。
 */
async function findPackageRoot(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const candidate = path.join(dir, e.name)
    if (existsSync(path.join(candidate, "bin", "ffmpeg.exe"))) return candidate
  }
  throw new Error(`解压结果里找不到 bin/ffmpeg.exe（在 ${dir}）`)
}

/** 校验文件的 sha256 与大小，必须与 lock 完全一致。 */
async function verify(file, lock) {
  const stat = await fs.stat(file)
  if (stat.size !== lock.size) {
    throw new Error(`大小不符：期望 ${lock.size}，实际 ${stat.size}`)
  }
  const hash = createHash("sha256")
  hash.update(await fs.readFile(file))
  const actual = hash.digest("hex")
  if (actual !== lock.sha256) {
    throw new Error(`sha256 不符：期望 ${lock.sha256}，实际 ${actual}`)
  }
}

/**
 * curl 的参数。用系统自带的 curl 而不是 `fetch`：undici 的连接超时写死 10s，
 * 在到 GitHub 的链路慢/抖动时动不动就放弃，而 curl 的连接超时和重试都可调。
 *
 * @param {string} url - 下载地址。
 * @param {string} dest - 落盘路径。
 * @returns {string[]} 交给 `curl` 的参数（地址固定在最后）。
 */
/** 每块的字节数。一条连接下得越久越慢，换新连接能明显提速。 */
export const CHUNK_BYTES = 4 * 1024 * 1024

/**
 * 把 `total` 字节切成闭区间 `[start, end]`，从 `from` 起（续传时传已下载的字节数）。
 *
 * @param {number} total - 文件总字节数（来自 lock）。
 * @param {number} chunk - 每块字节数。
 * @param {number} from - 从哪开始切，默认 0。
 * @returns {Array<[number, number]>} 依次要下的区间。
 */
export function chunkRanges(total, chunk, from = 0) {
  const out = []
  for (let start = from; start < total; start += chunk) {
    out.push([start, Math.min(start + chunk, total) - 1])
  }
  return out
}

/**
 * curl 的参数。
 *
 * @param {string} url - 下载地址。
 * @param {string} dest - 这一块落到哪。
 * @param {number} start - 块的起始字节（含）。
 * @param {number} end - 块的结束字节（含）。
 * @returns {string[]} 交给 `curl` 的参数（地址固定在最后）。
 */
export function curlArgs(url, dest, start, end) {
  return [
    "--fail", // HTTP 4xx/5xx 当作失败，别把错误页存成 zip
    "--location", // 跟重定向（release 资源在 objects.githubusercontent.com）
    "--silent",
    "--show-error",
    "--connect-timeout",
    "20", // 比 undici 的 10s 宽松，慢链路也够
    // 慢于 2KB/s 持续 60s 就判定卡死并断开：GitHub 镜像偶尔会「连着但不再给数据」，
    // 没有这条就是无限干等。断开后交给 --retry 重来。
    "--speed-limit",
    "2048",
    "--speed-time",
    "60",
    "--retry",
    "8",
    "--retry-all-errors", // 卡死/连接被重置都算可重试，不只是 5xx
    "--retry-delay",
    "2",
    "--range",
    `${start}-${end}`,
    "--output",
    dest,
    url,
  ]
}

/** 系统 curl 的路径；找不到返回 `null`（此时退回 `fetch`）。 */
function curlPath() {
  const p = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe")
  return existsSync(p) ? p : null
}

/**
 * 从单个地址分块下载到磁盘，块与块之间追加。
 *
 * 分块而不是一条连接下到底：镜像对长连接限速明显（实测一条 78MB 的连接掉到 8KB/s，
 * 新连接能到 20~46KB/s）。每块重开一次连接，天然还带上了「断了只重来一块」的好处。
 *
 * @param {string} url - 下载地址。
 * @param {string} dest - 落盘路径（已存在则从它的字节数续传）。
 * @param {number} expected - 期望总字节数（来自 lock）。
 */
async function downloadOne(url, dest, expected) {
  const curl = curlPath()
  if (!curl) throw new Error("找不到系统自带的 curl.exe（Windows 10 1803+ 才有）")
  const have = existsSync(dest) ? (await fs.stat(dest)).size : 0
  if (have > expected) throw new Error(`半成品比整个包还大（${have} > ${expected}），删掉后重试`)
  const part = `${dest}.part`
  let done = have
  for (const [start, end] of chunkRanges(expected, CHUNK_BYTES, have)) {
    await fs.rm(part, { force: true })
    const res = spawnSync(curl, curlArgs(url, part, start, end), { stdio: "inherit" })
    if (res.error) throw new Error(`curl 启动失败：${res.error.message}`)
    if (res.status !== 0) throw new Error(`curl 退出码 ${res.status}`)
    const got = (await fs.stat(part)).size
    if (got !== end - start + 1) {
      throw new Error(`分块大小不符：要 ${end - start + 1} 字节，拿到 ${got}`)
    }
    await fs.appendFile(dest, await fs.readFile(part))
    done += got
    const pct = ((done / expected) * 100).toFixed(1)
    console.log(`  ${pct}%（${(done / 1024 / 1024).toFixed(1)}MB / ${(expected / 1024 / 1024).toFixed(1)}MB）`)
  }
  await fs.rm(part, { force: true })
}

/**
 * 依次尝试候选地址，第一个成功的留下；全部失败时汇总原因。
 *
 * 半成品 zip 留在 `dest` 上不删：网络慢到几十分钟一次、或中途断了重跑时，`--continue-at -`
 * 会从已下载的字节接着来，不必从头再等一遍。校验不过（比如换了镜像、内容对不上）才清掉重来。
 *
 * @param {string[]} urls - 候选地址。
 * @param {string} dest - 下到一半的 zip 路径（也是续传的落点）。
 * @param {object} lock - `ffmpeg.lock.json` 的内容（取 size / sha256）。
 * @param {string} target - 最终产物目录（失败提示里告诉用户手动放到哪）。
 * @returns {Promise<string>} 实际成功的地址。
 */
async function download(urls, dest, lock, target) {
  const failures = []
  for (const url of urls) {
    const host = new URL(url).host
    const have = existsSync(dest) ? (await fs.stat(dest)).size : 0
    console.log(`  尝试 ${host}${have ? `（从 ${(have / 1024 / 1024).toFixed(1)}MB 处续传）` : ""}`)
    try {
      // 上次已经下完（但没来得及解压）时别再发请求：`--continue-at` 从头续会拿到 416。
      if (have !== lock.size) await downloadOne(url, dest, lock.size)
      await verify(dest, lock)
      return url
    } catch (e) {
      const reason = e.cause?.code || e.message
      console.log(`    ${host} 失败：${reason}`)
      failures.push(`${host}：${reason}`)
      // 续传出来的文件校验不过，说明攒下的字节不可信（多半混了别的版本），别留着继续续。
      if (existsSync(dest) && (await fs.stat(dest)).size >= lock.size) {
        await fs.rm(dest, { force: true })
      }
    }
  }
  throw new Error(
    [
      "下载失败，所有地址都不可用：",
      ...failures.map((f) => `  - ${f}`),
      "如果所在网络访问不了 GitHub，可设 CARDBARA_FFMPEG_MIRROR=https://<转发前缀>/ 换一个镜像；",
      `已经下了一部分的包留在 ${dest}，重跑本命令会接着下。`,
      `或者手动下载压缩包，解出其中的 bin/ 放到 ${target}（会跳过 sha256 校验，请自行确认版本）。`,
    ].join("\n"),
  )
}

async function main() {
  if (process.platform !== "win32") {
    console.log("目前只在 Windows 上随包内置 ffmpeg；其它平台继续使用 PATH 上的 ffmpeg。")
    return
  }
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"))
  const target = path.join(repoRoot, lock.target)
  const exe = path.join(target, "ffmpeg.exe")
  const force = process.argv.includes("--force")

  if (existsSync(exe) && !force) {
    console.log(`已存在：${exe}（要重新下载加 --force）`)
    return
  }

  const mirrorEnv = process.env.CARDBARA_FFMPEG_MIRROR
  const mirrors = mirrorPrefixesFromEnv(mirrorEnv)
  const urls = candidateUrls(lock.url, mirrors, { mirrorFirst: !!mirrorEnv })
  // 半成品放在产物目录旁边（`binaries/` 已 git 忽略）：重跑能续传，临时目录做不到这点。
  const zip = path.join(path.dirname(target), ".ffmpeg-download.zip")
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prismwright-ffmpeg-"))
  try {
    console.log(`下载 ${lock.version}（${(lock.size / 1024 / 1024).toFixed(1)}MB）…`)
    await download(urls, zip, lock, target)

    const unpacked = path.join(tmp, "unpacked")
    await fs.mkdir(unpacked, { recursive: true })
    extractZip(zip, unpacked)
    const pkg = await findPackageRoot(unpacked)

    // 清掉上一次的产物（换版本时旧 DLL 会残留），但 `.gitkeep` 是版本库里的占位，留着。
    await fs.mkdir(target, { recursive: true })
    for (const entry of await fs.readdir(target)) {
      if (entry === ".gitkeep") continue
      await fs.rm(path.join(target, entry), { recursive: true, force: true })
    }
    // 只带运行必需的东西：ffmpeg.exe + 同目录 DLL + 许可证原文。
    await fs.cp(path.join(pkg, "bin"), target, { recursive: true })
    const license = ["LICENSE.txt", "LICENSE"]
      .map((n) => path.join(pkg, n))
      .find((p) => existsSync(p))
    if (!license) throw new Error("压缩包里没有 LICENSE 文件，拒绝打包（LGPL 要求随分发附带）")
    await fs.copyFile(license, path.join(target, "LICENSE.txt"))
    console.log(`完成：${target}`)
    console.log("这是 LGPL 构建；分发时请保留 LICENSE.txt，并遵守 LGPL 的源码提供义务。")
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
    // 装好了就不再留着 78MB 的半成品。
    if (existsSync(exe)) await fs.rm(zip, { force: true })
  }
}

const isMain =
  process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`

if (isMain) {
  await main()
}
