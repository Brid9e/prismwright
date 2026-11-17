/**
 * 路径工具的行为测试（R17）。
 *
 * `basename` 是纯字符串处理，也是本任务里唯一可被单测覆盖的模块——组件无法在
 * node 环境下渲染。Windows 上系列目录既可能是 `\` 也可能是 `/` 分隔，尾随分隔符
 * 的多寡、盘符根、UNC 路径都是容易写错且平时不会有人手动验到的角落，故用测试钉死。
 *
 * 用例中的字面量反斜杠写成 `\\`（JS 字符串里两个字符才能得到一个反斜杠）。
 * `join` 的期望值是**约定**：拼出来的路径分隔符风格必须统一，跟首段走。
 */
import { describe, it, expect } from "vitest"
import { basename, isValidPackName, join, toPackDirName } from "../path"

describe("basename", () => {
  it.each([
    ["D:\\Code\\packs\\my-pack", "my-pack"],
    ["D:\\Code\\packs\\my-pack\\", "my-pack"],
    ["D:\\Code\\packs\\my-pack\\\\\\", "my-pack"],
    ["D:/Code/packs/my-pack/", "my-pack"],
    ["/home/u/packs/p/", "p"],
    ["C:\\", "C:"],
    ["\\\\srv\\share\\", "share"],
    ["plain", "plain"],
    ["", ""],
    ["///", ""],
    ["  ", "  "],
  ])("%j -> %j", (input, expected) => {
    expect(basename(input)).toBe(expected)
  })
})

describe("join", () => {
  it.each([
    [["/a", "b"], "/a/b"],
    [["/a/", "b"], "/a/b"],
    [["/a", "b/"], "/a/b"],
    [["/a", "", "b"], "/a/b"],
    [["/a", "/"], "/a"],
    [["", "b"], "b"],
    // 纯分隔符的**首段**是根，必须保留：`/` + `x` 不能退化成相对路径 `x`。
    [["/", "p"], "/p"],
    [["///", "p"], "/p"],
    [["/", ""], "/"],
    // Windows 盘符根同理：去尾反斜杠后仍是绝对路径。
    [["C:\\", "p"], "C:\\p"],
    // 分隔符跟首段走：Windows 路径拼出来不该混进 `/`（功能上能用，但显示与人读都别扭）。
    [["C:\\x\\packs", "p"], "C:\\x\\packs\\p"],
    [["C:\\Users\\Brid9e\\Documents", "Cardbara"], "C:\\Users\\Brid9e\\Documents\\Cardbara"],
    // 首段全是正斜杠时保持正斜杠（Windows 也认这种写法，别反过来又混一遍）。
    [["C:/Users/u/Documents", "p"], "C:/Users/u/Documents/p"],
    // 首段自身已混着写（旧版本拼出的「文档/Cardbara」曾这样存进首选项）也要一并规整，
    // 否则此后新建的完整路径会一直混着。
    [
      ["C:\\Users\\Brid9e\\Documents/Cardbara", "我的系列"],
      "C:\\Users\\Brid9e\\Documents\\Cardbara\\我的系列",
    ],
    [["/home/u/Documents/Cardbara", "我的系列"], "/home/u/Documents/Cardbara/我的系列"],
  ])("%j -> %j", (parts, expected) => {
    expect(join(...parts)).toBe(expected)
  })
})

describe("isValidPackName", () => {
  it.each(["我的系列", "my-pack", "pack_1", "系列 2", "a.b"])("放行 %j", (name) => {
    expect(isValidPackName(name)).toBe(true)
  })

  it.each([
    "",
    ".",
    "..",
    "a/b",
    "a\\b",
    "a:b",
    "a*b",
    "a?b",
    'a"b',
    "a<b",
    "a>b",
    "a|b",
    // Windows 拒绝以 `.` / 空格结尾，以及设备保留名（含带扩展名形式）。
    "pack.",
    "pack ",
    "CON",
    "con",
    "NUL",
    "COM1",
    "lpt9",
    "CON.txt",
    "aux.log",
  ])("拒绝 %j", (name) => {
    expect(isValidPackName(name)).toBe(false)
  })
})


describe("toPackDirName", () => {
  it("把非法字符换成短横线", () => {
    expect(toPackDirName("a/b:c*?")).toBe("a-b-c--")
  })
  it("空名与保留名有兜底", () => {
    expect(toPackDirName("   ")).toBe("series")
    expect(toPackDirName("CON")).toBe("pack-CON")
  })
})
