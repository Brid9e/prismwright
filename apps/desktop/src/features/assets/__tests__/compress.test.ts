/**
 * 导入图片压缩的选档逻辑。
 *
 * 真正的解码 / 画布编码跑不了（node 环境没有 WebGL 也没有 ImageBitmap），但那部分只是
 * 「按档位画一遍、编码一遍」；**选哪一档**才是容易写错的地方——顺序错了会先出低质量图、
 * 全超限时会把最大的一张当结果。故把选档拆成纯函数钉住。
 */
import { describe, it, expect } from "vitest"
import { buildAttempts, pickUnderLimit, targetSize, extForType } from "../compress"

describe("targetSize", () => {
  it("长边超过上限时等比缩到上限", () => {
    expect(targetSize(4000, 2000, 2048)).toEqual({ width: 2048, height: 1024 })
  })

  it("竖图按高缩", () => {
    expect(targetSize(1000, 4000, 2048)).toEqual({ width: 512, height: 2048 })
  })

  it("长边未超上限时原样返回（不放大）", () => {
    expect(targetSize(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })
})

describe("buildAttempts", () => {
  it("不透明 JPEG：只出 JPEG，质量从 0.9 逐档降到 0.5，再缩尺寸重来", () => {
    const a = buildAttempts({ ext: "jpg", hasAlpha: false, width: 1000, height: 1000 })
    expect(a.every((x) => x.type === "image/jpeg")).toBe(true)
    expect(a.slice(0, 5).map((x) => x.quality)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5])
    // 第一轮 5 档之后换 0.75 倍尺寸，质量重新从 0.9 起步。
    expect(a[5]).toMatchObject({ width: 750, height: 750, quality: 0.9 })
  })

  it("不透明 PNG：先试无损 PNG，再退 JPEG", () => {
    const a = buildAttempts({ ext: "png", hasAlpha: false, width: 1000, height: 1000 })
    expect(a[0]).toMatchObject({ type: "image/png", width: 1000, height: 1000 })
    expect(a[1]).toMatchObject({ type: "image/jpeg", quality: 0.9 })
  })

  it("带透明通道：只出 PNG——JPEG 存不了透明，选了就会把透明区涂黑", () => {
    const a = buildAttempts({ ext: "png", hasAlpha: true, width: 1000, height: 1000 })
    expect(a.every((x) => x.type === "image/png")).toBe(true)
    expect(a.length).toBeGreaterThan(1)
  })

  it("长边超 2048 时第一档就缩到 2048", () => {
    const a = buildAttempts({ ext: "jpg", hasAlpha: false, width: 4000, height: 2000 })
    expect(a[0]).toMatchObject({ width: 2048, height: 1024 })
  })
})

describe("extForType", () => {
  it("JPEG → jpg，PNG → png（落盘扩展名随编码格式）", () => {
    expect(extForType("image/jpeg")).toBe("jpg")
    expect(extForType("image/png")).toBe("png")
  })
})

describe("pickUnderLimit", () => {
  it("取第一档不超过上限的结果，命中即停", async () => {
    const tried: number[] = []
    const r = await pickUnderLimit(
      [{ n: 1 }, { n: 2 }, { n: 3 }],
      async (attempt) => {
        tried.push(attempt.n)
        return new Uint8Array(attempt.n === 2 ? 100 : 300)
      },
      200,
    )
    expect(r?.attempt).toEqual({ n: 2 })
    expect(r?.bytes.byteLength).toBe(100)
    // 命中后不再继续编码——后面还有 3 号档，白编一次就是白卡一下。
    expect(tried).toEqual([1, 2])
  })

  it("全部超限时取体积最小的一档，而不是最后一档", async () => {
    const r = await pickUnderLimit(
      [{ n: 1 }, { n: 2 }],
      async (attempt) => new Uint8Array(attempt.n === 1 ? 300 : 250),
      100,
    )
    expect(r?.attempt).toEqual({ n: 2 })
  })

  it("没有可试的档位时返回 null", async () => {
    expect(await pickUnderLimit([], async () => new Uint8Array(1), 100)).toBe(null)
  })
})
