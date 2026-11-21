/**
 * 导出参数模型的行为测试。
 *
 * 只钉纯逻辑：帧数（由格式与帧率推得）、默认值、默认文件名、保存对话框过滤器。这些算错了
 * 会让导出「少一帧」「文件名带非法字符」这类问题悄悄溜进产物。
 */
import { describe, it, expect } from "vitest"
import { EXPORT_SWAY_PERIOD } from "@prismwright/renderer/v1"
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_SIZE_PRESETS,
  exportFileName,
  exportFrameCount,
  saveFilters,
} from "../exportOptions"

describe("exportFrameCount", () => {
  it("PNG 恒为 1 帧", () => {
    expect(exportFrameCount({ ...DEFAULT_EXPORT_OPTIONS, format: "png" })).toBe(1)
  })

  it("GIF / WebM 为 帧率 × 摆动周期", () => {
    for (const fps of [12, 24, 30]) {
      expect(exportFrameCount({ ...DEFAULT_EXPORT_OPTIONS, format: "gif", fps })).toBe(
        fps * EXPORT_SWAY_PERIOD,
      )
      expect(exportFrameCount({ ...DEFAULT_EXPORT_OPTIONS, format: "webm", fps })).toBe(
        fps * EXPORT_SWAY_PERIOD,
      )
    }
  })
})

describe("DEFAULT_EXPORT_OPTIONS", () => {
  it("默认 720 / 24fps / 透明 / GIF 256 色 + 抖动 / WebM CRF 30", () => {
    expect(DEFAULT_EXPORT_OPTIONS).toMatchObject({
      format: "gif",
      width: 720,
      fps: 24,
      background: "transparent",
      gifColors: 256,
      gifDither: true,
      webmCrf: 30,
    })
  })
})

describe("exportFileName", () => {
  it("卡名 + 扩展名拼成默认文件名", () => {
    expect(exportFileName("星辰之约", "gif")).toBe("card-星辰之约.gif")
    expect(exportFileName("Aurora", "webm")).toBe("card-Aurora.webm")
  })

  it("空卡名退化为 card.<ext>", () => {
    expect(exportFileName("", "png")).toBe("card.png")
    expect(exportFileName("   ", "png")).toBe("card.png")
  })

  it("把路径非法字符换成连字符", () => {
    expect(exportFileName('a/b:c*d?e"f<g>h|i', "png")).toBe("card-a-b-c-d-e-f-g-h-i.png")
  })
})

describe("EXPORT_SIZE_PRESETS 与 saveFilters", () => {
  it("尺寸预设为 512/720/1080", () => {
    expect(EXPORT_SIZE_PRESETS).toEqual([512, 720, 1080])
  })

  it("过滤器按格式给出单一扩展名", () => {
    expect(saveFilters("gif")).toEqual([{ name: "GIF", extensions: ["gif"] }])
    expect(saveFilters("png")).toEqual([{ name: "PNG", extensions: ["png"] }])
    expect(saveFilters("webm")).toEqual([{ name: "WebM", extensions: ["webm"] }])
  })
})
