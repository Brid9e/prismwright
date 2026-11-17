/**
 * 预览资产路径命名的行为测试。
 *
 * 这些是**约定**而非实现细节：`.previews/` 的位置决定了产物与系列同生命周期，帧文件
 * `frame_0001.png` 的「从 1 起数、4 位零填充」必须与 Rust 侧 `encode_webm` 拼出的
 * `frame_%04d.png` 严格对齐，错一位 ffmpeg 就读不到帧序列。故用测试把命名钉死。
 */
import { describe, it, expect } from "vitest"
import {
  MANIFEST_REL,
  PREVIEW_DIR,
  frameRel,
  framesDirRel,
  previewPngRel,
  previewWebmRel,
} from "../paths"

describe("预览资产路径", () => {
  it("产物落在系列内的 .previews 隐藏目录", () => {
    expect(PREVIEW_DIR).toBe(".previews")
    expect(MANIFEST_REL).toBe(".previews/manifest.json")
  })

  it("PNG / WebM 以卡片 id 命名", () => {
    expect(previewPngRel("c1")).toBe(".previews/c1.png")
    expect(previewWebmRel("c1")).toBe(".previews/c1.webm")
  })

  it("每张卡的临时帧目录按 id 分子目录", () => {
    expect(framesDirRel("c1")).toBe(".previews/.frames/c1")
  })

  it("帧文件名从 1 起数、4 位零填充（与 Rust 侧 frame_%04d 对齐）", () => {
    expect(frameRel("c1", 0)).toBe(".previews/.frames/c1/frame_0001.png")
    expect(frameRel("c1", 9)).toBe(".previews/.frames/c1/frame_0010.png")
    expect(frameRel("c1", 59)).toBe(".previews/.frames/c1/frame_0060.png")
  })
})
