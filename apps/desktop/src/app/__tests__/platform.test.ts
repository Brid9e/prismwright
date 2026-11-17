/**
 * 平台判定的行为测试。
 *
 * 判定只拿得到 UA 字符串——真机上没法把各种 UA 试一遍，故用测试钉死。三个平台分别对应
 * 「自绘标题栏与否」与「原生菜单与否」两种**独立**取舍（见 `platform.ts`）：Windows 自绘
 * 且无原生菜单；macOS 自绘但有原生菜单；其余两者皆无。
 */
import { describe, it, expect } from "vitest"
import { detectPlatform, hasTauriEnv, usesHtmlTitleBar, usesNativeMenu } from "../platform"

const WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
const IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)"
const LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

describe("detectPlatform", () => {
  it.each([
    [WIN, "windows"],
    [MAC, "macos"],
    // iOS 的 UA 也含 `like Mac OS X`，必须落到 other 而非 macos（故匹配 Macintosh）。
    [IOS, "other"],
    [LINUX, "other"],
    ["", "other"],
  ])("%j -> %j", (userAgent, expected) => {
    expect(detectPlatform(userAgent)).toBe(expected)
  })
})

describe("usesHtmlTitleBar", () => {
  it.each([
    ["windows", true],
    ["macos", true],
    ["other", false],
  ] as const)("%s -> %s", (platform, expected) => {
    expect(usesHtmlTitleBar(platform)).toBe(expected)
  })
})

describe("usesNativeMenu", () => {
  it.each([
    ["windows", false],
    ["macos", true],
    ["other", true],
  ] as const)("%s -> %s", (platform, expected) => {
    expect(usesNativeMenu(platform)).toBe(expected)
  })
})

describe("hasTauriEnv", () => {
  it("桌面壳里有 __TAURI_INTERNALS__", () => {
    expect(hasTauriEnv({ __TAURI_INTERNALS__: {} })).toBe(true)
  })

  it("dev:web 的纯浏览器里没有", () => {
    expect(hasTauriEnv({})).toBe(false)
  })
})
