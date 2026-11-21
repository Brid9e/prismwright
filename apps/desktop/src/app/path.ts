/**
 * 路径工具。
 *
 * 只做字符串层面的取尾段与拼接，不引入 `node:path`——前端跑在 WebView 里，没有 node
 * 的路径模块，而系列目录在 Windows 上既可能是 `/` 也可能是 `\` 分隔。两种风格都得用得上，
 * 但**不能混着写**：{@link join} 按首段的风格统一整条路径。
 */

/** 文件名里不允许出现的字符（Windows 保留字符集，跨平台一律按最严处理）。 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/

/**
 * Windows 设备保留名（不区分大小写）：这些名字无论作文件还是目录都会失败。
 *
 * 匹配**主名**部分，故 `CON.txt` 这类带扩展名的写法也一并挡下——Windows 同样拒绝。
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * 取路径的最后一段（去掉结尾的分隔符）。
 *
 * @param path - 绝对或相对路径。
 * @returns 最后一段；路径全是分隔符时返回空串。
 */
export function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return index === -1 ? normalized : normalized.slice(index + 1)
}

/**
 * 拼接路径各段，分隔符**跟随首段**。
 *
 * Windows 上 `\` 与 `/` 都能用，但混着拼出来的路径（`C:\Users\me\Documents/Prismwright`）
 * 显示给用户十分别扭，所以这里统一：首段含 `\` 就一律用 `\`，否则用 `/`。首段自身已有的
 * 异类分隔符也一并规整——用户此前用混着写的版本建过系列，那个目录就是这么存进首选项的。
 *
 * 各段去**尾部**分隔符后相接，空段忽略。**首段若是纯分隔符的根**（如 `/`、`C:\`），去尾
 * 后虽为空也必须保留为分隔符——否则 `/` + `x` 会退化成相对路径 `x`；非首段的纯分隔符
 * 无意义，按空段丢弃。段内的前导分隔符不处理：调用方传进来的名字已过
 * {@link isValidPackName}，不含分隔符。
 *
 * @param parts - 依次相接的路径段。
 * @returns 拼接后的路径；全部为空段时返回空串。
 */
export function join(...parts: string[]): string {
  const [rawFirst = "", ...rawRest] = parts
  const separator = rawFirst.includes("\\") ? "\\" : "/"
  const unify = (part: string) => (separator === "\\" ? part.replace(/\//g, "\\") : part)
  const [first = "", ...rest] = [rawFirst, ...rawRest].map(unify)
  const head = first === "" ? "" : first.replace(/[\\/]+$/, "") || separator
  const tail = rest.map((part) => part.replace(/[\\/]+$/, "")).filter((part) => part !== "")
  // 根（`/`、`C:\`）本身即以分隔符结尾，直接接尾段，否则会拼出 `//p`。
  if (head.endsWith(separator)) return head + tail.join(separator)
  return [head, ...tail].filter((part) => part !== "").join(separator)
}

/**
 * 把任意展示名清洗成一个可用的文件名主干。
 *
 * 用于导出工程文件：卡名 / 系列名允许出现 `/`、`:` 等在文件系统上非法的字符，
 * 这里统一换成短横线，并去掉结尾的点与空格（Windows 会静默去除）。
 *
 * @param name - 原始展示名（可含首尾空白）。
 * @param fallback - 清洗后为空、`.` 或 `..` 时的兜底名字。
 * @returns 可直接作为文件名主干（不含扩展名）的字符串。
 */
export function sanitizeFileBase(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[. ]+$/, "")
  if (cleaned === "" || cleaned === "." || cleaned === "..") return fallback
  return cleaned
}

/**
 * 由系列名推导导入时的目录名。
 *
 * 与 {@link sanitizeFileBase} 的区别：这里要保证结果是一个**合法的系列目录名**，
 * 因此 Windows 设备保留名（`CON`、`NUL` 等）要额外加前缀避开。
 *
 * @param name - 系列名。
 * @returns 可用作目录名的字符串；空名兜底为 `series`。
 */
export function toPackDirName(name: string): string {
  const base = sanitizeFileBase(name, "series")
  return isValidPackName(base) ? base : `pack-${base}`
}

/**
 * 判断字符串可否作为系列目录名（新建系列时的名字）。
 *
 * 只挡「会造成真实故障」的输入：空名无法落盘、`.`/`..` 指向自身或父目录、
 * 含 {@link ILLEGAL_NAME_CHARS} 的字符在文件系统上非法；此外按 Windows 的额外限制，
 * 拒绝以 `.`/空格结尾的名字与 {@link WINDOWS_RESERVED} 设备保留名——这些在 Windows
 * 上会真实失败，按最严处理以免用户在别的平台建出 Windows 打不开的系列。首尾空白由
 * 调用方 `trim` 处理（对话框里已做），此处不重复。
 *
 * @param name - 已去掉首尾空白的候选名字。
 * @returns 可作为目录名时为真。
 */
export function isValidPackName(name: string): boolean {
  if (name === "" || name === "." || name === "..") return false
  if (ILLEGAL_NAME_CHARS.test(name)) return false
  // Windows 亦拒绝以 `.` 或空格结尾的名字（尾随空格/点在 Explorer 建目录时会报错）。
  if (/[. ]$/.test(name)) return false
  // 保留名判定看主名：`CON.txt` 在 Windows 上同样是保留名。
  return !WINDOWS_RESERVED.test(name.split(".")[0])
}
