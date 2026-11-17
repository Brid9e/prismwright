/**
 * 封面降采样的纯逻辑：目标尺寸怎么算、什么情况原样保留。
 *
 * 解码 / 画布编码跑不了（node 没有 ImageBitmap），所以把「缩到多大」「要不要重编码」
 * 拆出来钉住，浏览器那一段靠注入的 deps 模拟。
 */
import { describe, expect, it, vi } from "vitest"
import {
  COVER_KEEP_BYTES,
  coverTargetSize,
  isAnimatedWebp,
  prepareCoverImage,
  type CoverImageDeps,
} from "../cover-image"

describe("coverTargetSize", () => {
  it("大封面放进 1200×480，等比缩小", () => {
    expect(coverTargetSize(4000, 1600, "large")).toEqual({ width: 1200, height: 480 })
  })

  it("小封面放进 384×384", () => {
    expect(coverTargetSize(2000, 2000, "small")).toEqual({ width: 384, height: 384 })
  })

  it("头像框与成就图标按展示需求压到 256 / 128", () => {
    expect(coverTargetSize(2000, 2000, "frame")).toEqual({ width: 256, height: 256 })
    expect(coverTargetSize(2000, 2000, "achievement")).toEqual({ width: 128, height: 128 })
    expect(coverTargetSize(2000, 2000, "seriesAvatar")).toEqual({ width: 128, height: 128 })
  })

  it("本来就是小图时原样返回，不放大", () => {
    expect(coverTargetSize(300, 300, "small")).toEqual({ width: 300, height: 300 })
  })

  it("比例比框更宽时按宽缩，高不会被拉满", () => {
    expect(coverTargetSize(4000, 1000, "large")).toEqual({ width: 1200, height: 300 })
  })

  it("很高的图按高缩，宽不会被拉满", () => {
    // 1000×2000 放进 1200×480：高只够 0.24，宽只到 240
    expect(coverTargetSize(1000, 2000, "large")).toEqual({ width: 240, height: 480 })
  })
})

describe("isAnimatedWebp", () => {
  it("RIFF 里有 ANIM 块才算动图", () => {
    const bytes = new TextEncoder().encode("RIFF0000WEBPVP8X........ANIM......")
    expect(isAnimatedWebp(bytes)).toBe(true)
  })

  it("普通 WebP 不是动图", () => {
    const bytes = new TextEncoder().encode("RIFF0000WEBPVP8 .......")
    expect(isAnimatedWebp(bytes)).toBe(false)
  })
})

/** 造一份可控的解码 / 编码依赖。 */
function makeDeps(overrides: Partial<CoverImageDeps> = {}) {
  const close = vi.fn()
  const decode = vi.fn(async () => ({ width: 4000, height: 1600, source: null, close }))
  const encodeWebp = vi.fn(async () => new Uint8Array([1, 2, 3]))
  const deps: CoverImageDeps = { decode, encodeWebp, ...overrides }
  return { deps, close, decode, encodeWebp }
}

const big = new Uint8Array(COVER_KEEP_BYTES + 1)

describe("prepareCoverImage", () => {
  it("大图缩到档位并转成 WebP", async () => {
    const { deps, close, encodeWebp } = makeDeps()

    const out = await prepareCoverImage(big, "png", "large", deps)

    expect(encodeWebp).toHaveBeenCalledWith(null, 1200, 480)
    expect(out.ext).toBe("webp")
    expect(out.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(close).toHaveBeenCalled()
  })

  it("GIF 一律不碰：画布只解首帧，重编码会把动画压成静图", async () => {
    const { deps, decode } = makeDeps()

    const out = await prepareCoverImage(big, "gif", "large", deps)

    expect(decode).not.toHaveBeenCalled()
    expect(out).toEqual({ ext: "gif", bytes: big })
  })

  it("动图 WebP 也不碰", async () => {
    const { deps, decode } = makeDeps()
    const bytes = new TextEncoder().encode("RIFF....WEBPVP8X...ANIM....")

    const out = await prepareCoverImage(bytes, "webp", "small", deps)

    expect(decode).not.toHaveBeenCalled()
    expect(out.ext).toBe("webp")
  })

  it("尺寸本来就够小、体积也在阈值内时原样保留", async () => {
    const { deps, encodeWebp } = makeDeps({
      decode: vi.fn(async () => ({ width: 300, height: 300, source: null, close: vi.fn() })),
    })
    const small = new Uint8Array(1024)

    const out = await prepareCoverImage(small, "png", "small", deps)

    expect(encodeWebp).not.toHaveBeenCalled()
    expect(out).toEqual({ ext: "png", bytes: small })
  })

  it("尺寸超了但编码失败时退回原字节，导入照常完成", async () => {
    const { deps } = makeDeps({ encodeWebp: vi.fn(async () => null) })

    const out = await prepareCoverImage(big, "jpeg", "large", deps)

    expect(out).toEqual({ ext: "jpeg", bytes: big })
  })

  it("解码失败时退回原字节", async () => {
    const { deps } = makeDeps({
      decode: vi.fn(async () => {
        throw new Error("decode")
      }),
    })

    const out = await prepareCoverImage(big, "png", "large", deps)

    expect(out).toEqual({ ext: "png", bytes: big })
  })
})
