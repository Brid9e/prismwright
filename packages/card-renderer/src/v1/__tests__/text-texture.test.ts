/**
 * 文字栅格化：绘制顺序（投影两遍 / 描边先于填充）、字体与基线、y 轴映射、空内容与
 * 无画布时的降级，以及按参数键复用的纹理缓存。
 *
 * 这里用假 2D 上下文记录调用——真 canvas 在 node 里没有，而这些约定错了不会报错，
 * 只会「字歪了 / 投影叠了两次 / 什么都没画出来」。
 */
import { describe, it, expect, vi } from "vitest"
import { DataTexture } from "three"
import { LayerSchema, TextParamsSchema, type Layer } from "@prismwright/schema"
import {
  TEXT_TEXTURE_HEIGHT,
  TEXT_TEXTURE_WIDTH,
  TextTextureCache,
  createTextTexture,
  hexToRgba,
  renderTextRaster,
  textTextureSize,
  scopedLayerId,
  type TextCanvas2D,
} from "../text-texture"

/** 假 2D 上下文：记录调用与当前状态，measureText 每个字符宽 10px。 */
function fakeCanvas(width: number, height: number) {
  const calls: { op: string; args: unknown[] }[] = []
  /** 每次 measureText 时的 `ctx.font`；用来钉「先设字体、再测量」的顺序。 */
  const fontsAtMeasure: string[] = []
  const state = {
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  // 让翻转可验证：每个像素的 R = 行号。
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels[(y * width + x) * 4] = y
  }
  const ctx = {
    ...state,
    save: () => {
      calls.push({ op: "save", args: [] })
    },
    restore: () => {
      calls.push({ op: "restore", args: [] })
    },
    clearRect: (...args: number[]) => {
      calls.push({ op: "clearRect", args })
    },
    translate: (...args: number[]) => {
      calls.push({ op: "translate", args })
    },
    rotate: (a: number) => {
      calls.push({ op: "rotate", args: [a] })
    },
    scale: (x: number, y: number) => {
      calls.push({ op: "scale", args: [x, y] })
    },
    measureText: (text: string) => {
      fontsAtMeasure.push(ctx.font)
      return { width: text.length * 10 }
    },
    fillText: (text: string, x: number, y: number) => {
      calls.push({ op: "fillText", args: [text, x, y] })
    },
    strokeText: (text: string, x: number, y: number) => {
      calls.push({ op: "strokeText", args: [text, x, y] })
    },
    getImageData: () => ({ data: pixels }),
    // 供断言读取当前状态（绘制时属性是就地赋值的）。
    snapshot: () => ({ ...ctx }),
  }
  const canvas: TextCanvas2D = { width, height, getContext: () => ctx as never }
  return { canvas, calls, ctx, fontsAtMeasure }
}

function params(patch: Record<string, unknown> = {}) {
  return TextParamsSchema.parse({ content: "AB", ...patch })
}

function textLayer(patch: Record<string, unknown> = {}): Layer {
  return LayerSchema.parse({ id: "l1", kind: "text", text: { content: "AB", ...patch } })
}

describe("createTextTexture", () => {
  it("空内容 / 纯空白：返回 null（不出图，也不作为蒙版，子树不会消失）", () => {
    expect(createTextTexture(params({ content: "" }))).toBeNull()
    expect(createTextTexture(params({ content: "  \n " }))).toBeNull()
  })

  it("拿不到 2D 画布：返回 null 而不是抛异常", () => {
    const texture = createTextTexture(params(), { createCanvas: () => null })
    expect(texture).toBeNull()
  })

  it("字体 / 基线 / 变换与 y 轴映射", () => {
    const { canvas, calls } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    const texture = createTextTexture(
      params({ content: "A", fontSize: 0.1, fontFamily: "Microsoft YaHei", fontWeight: 700, x: 0.1, y: 0.2 }),
      { createCanvas: () => canvas },
    )
    expect(texture).toBeInstanceOf(DataTexture)
    // 块中心：x = W/2 + 0.1H，y = H/2 − 0.2H。
    const translate = calls.find((c) => c.op === "translate")
    expect(translate?.args).toEqual([
      TEXT_TEXTURE_WIDTH / 2 + 0.1 * TEXT_TEXTURE_HEIGHT,
      TEXT_TEXTURE_HEIGHT / 2 - 0.2 * TEXT_TEXTURE_HEIGHT,
    ])
    // 单字居中：字宽 10 → 左缘 −5；行中线落在块中心 → 画布 y = 0。
    // 用 toBeCloseTo 比 y：`-0` 与 `+0` 在 Object.is 下不相等，toBe 会误报。
    const fill = calls.find((c) => c.op === "fillText")
    expect(fill?.args[1]).toBe(-5)
    expect(fill?.args[2] as number).toBeCloseTo(0)
  })

  it("投影：同样两遍绘制，投影只在第一遍生效", () => {
    const { canvas, calls, ctx } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    const textures: string[] = []
    const originalFill = ctx.fillText
    ctx.fillText = (text: string, x: number, y: number) => {
      textures.push(String(ctx.shadowColor))
      originalFill(text, x, y)
    }
    createTextTexture(
      params({ content: "A", shadow: { color: "#ff0000", opacity: 0.5, offsetX: 0.01, offsetY: 0.02, blur: 0.03 } }),
      { createCanvas: () => canvas },
    )
    expect(calls.filter((c) => c.op === "fillText")).toHaveLength(2)
    expect(textures[0]).toBe("rgba(255, 0, 0, 0.5)")
    expect(textures[1]).toBe("transparent")
    // 第二遍之前把投影参数清干净，否则会叠两层投影。
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.shadowOffsetY).toBe(0)
  })

  // 测量必须发生在设好 `ctx.font` 之后：新画布默认是 10px sans-serif，先测后设字体的话
  // 量出来的宽度与真正落笔的字号差一个数量级，居中 / 右对齐会整块偏出去。
  it("先设字体再测量：每次 measureText 时 ctx.font 已是目标字号", () => {
    const { canvas, fontsAtMeasure } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    createTextTexture(params({ content: "AB", fontSize: 0.1 }), { createCanvas: () => canvas })
    expect(fontsAtMeasure.length).toBeGreaterThan(0)
    for (const font of fontsAtMeasure) {
      expect(font).toBe(`400 102.4px sans-serif`)
    }
  })

  it("描边先于填充（填充盖住描边的内半边）", () => {
    const { canvas, calls } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    createTextTexture(params({ content: "A", stroke: { color: "#00ff00", width: 0.01 } }), {
      createCanvas: () => canvas,
    })
    const ops = calls.map((c) => c.op).filter((op) => op === "fillText" || op === "strokeText")
    expect(ops).toEqual(["strokeText", "fillText"])
  })

  it("纹理：sRGB、线性过滤、不生成 mipmap、行序已翻转", () => {
    const { canvas } = fakeCanvas(4, 4)
    // 宽高必须跟着假画布走：行翻转按 width/height 切行，尺寸对不上会把整块像素当越界行清掉。
    const texture = createTextTexture(params({ content: "A" }), {
      createCanvas: () => canvas,
      width: 4,
      height: 4,
    }) as DataTexture
    expect(texture.colorSpace).toBe("srgb")
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.flipY).toBe(false)
    // 假像素 R = 原行号：翻转后第一行应是原来的最后一行（3）。
    const data = texture.image.data as Uint8ClampedArray
    expect(data[0]).toBe(3)
    expect(data[3 * 4 * 4]).toBe(0)
  })

  it("字距非零时逐字符绘制（emoji 按码位切分不乱码）", () => {
    const { canvas, calls } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    createTextTexture(params({ content: "😀A", letterSpacing: 0.01 }), { createCanvas: () => canvas })
    const drawn = calls.filter((c) => c.op === "fillText").map((c) => c.args[0])
    expect(drawn).toEqual(["😀", "A"])
  })
})

describe("颜色透明度", () => {
  it("hexToRgba 把 8 位 hex 自带的 alpha 乘进参数", () => {
    expect(hexToRgba("#ff000080", 1)).toBe("rgba(255, 0, 0, 0.502)")
    expect(hexToRgba("#ff000080", 0.5)).toBe("rgba(255, 0, 0, 0.251)")
    // 6 位 / 3 位不受影响，仍按参数给的不透明度。
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)")
    expect(hexToRgba("#f00", 0.25)).toBe("rgba(255, 0, 0, 0.25)")
  })

  it("文字填充与描边都带自己的透明度（画布用 rgba，不依赖 8 位 hex 支持）", () => {
    const { canvas, ctx } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    createTextTexture(
      params({
        content: "A",
        color: "#00ff0040",
        stroke: { color: "#0000ff80", width: 0.004 },
      }),
      { createCanvas: () => canvas },
    )
    expect(ctx.snapshot().fillStyle).toBe("rgba(0, 255, 0, 0.251)")
    expect(ctx.snapshot().strokeStyle).toBe("rgba(0, 0, 255, 0.502)")
  })

  it("投影的最终 alpha = 颜色自带 alpha × 投影不透明度", () => {
    const { canvas, ctx } = fakeCanvas(TEXT_TEXTURE_WIDTH, TEXT_TEXTURE_HEIGHT)
    // 第二遍绘制会把 shadowColor 清成 transparent，故在第一遍落笔时读。
    const textures: string[] = []
    const originalFill = ctx.fillText
    ctx.fillText = (text: string, x: number, y: number) => {
      textures.push(String(ctx.shadowColor))
      originalFill(text, x, y)
    }
    createTextTexture(
      params({
        content: "A",
        shadow: { color: "#ff000080", opacity: 0.5, offsetX: 0, offsetY: 0, blur: 0 },
      }),
      { createCanvas: () => canvas },
    )
    expect(textures[0]).toBe("rgba(255, 0, 0, 0.251)")
  })
})

describe("renderTextRaster", () => {
  // 发布时要把文字烤成 PNG：PNG 的行序是「第 0 行在上」，而纹理上传要的是翻转过的。
  // 底层导出必须给未翻转的原始像素，翻转只发生在 createTextTexture 内部。
  it("返回未翻转的像素：第 0 行是画面顶部", () => {
    const { canvas } = fakeCanvas(4, 4)
    const raster = renderTextRaster(params({ content: "A" }), {
      createCanvas: () => canvas,
      width: 4,
      height: 4,
    })
    expect(raster?.width).toBe(4)
    expect(raster?.height).toBe(4)
    expect(raster?.data[0]).toBe(0)
    expect(raster?.data[3 * 4 * 4]).toBe(3)
  })

  it("空内容 / 拿不到画布：返回 null", () => {
    expect(renderTextRaster(params({ content: "  " }))).toBeNull()
    expect(renderTextRaster(params(), { createCanvas: () => null })).toBeNull()
  })
})

describe("TextTextureCache 按面分域", () => {
  it("同 id 的图层在两面各自缓存，互不覆盖", () => {
    const created: { dispose: ReturnType<typeof vi.fn> }[] = []
    const cache = new TextTextureCache({
      createTexture: () => {
        const texture = new DataTexture(new Uint8Array(4), 1, 1)
        texture.dispose = vi.fn()
        created.push(texture as never)
        return texture
      },
    })
    const front = cache.get(textLayer(), "")
    const back = cache.get(textLayer(), "back")

    expect(back).not.toBe(front)
    expect(created).toHaveLength(2)
    expect(cache.get(textLayer(), "back")).toBe(back)
    expect(created).toHaveLength(2)
  })

  it("retain 用拼好的 id：只保一面时另一面的纹理被释放", () => {
    const created: { dispose: ReturnType<typeof vi.fn> }[] = []
    const cache = new TextTextureCache({
      createTexture: () => {
        const texture = new DataTexture(new Uint8Array(4), 1, 1)
        texture.dispose = vi.fn()
        created.push(texture as never)
        return texture
      },
    })
    cache.get(textLayer(), "")
    cache.get(textLayer(), "back")

    cache.retain(new Set([scopedLayerId("", "l1")]))

    expect(created[0].dispose).not.toHaveBeenCalled()
    expect(created[1].dispose).toHaveBeenCalledTimes(1)
  })
})

describe("TextTextureCache", () => {
  it("同键复用同一张纹理；参数变化建新纹理并释放旧的", () => {
    const created: { dispose: ReturnType<typeof vi.fn> }[] = []
    const cache = new TextTextureCache({
      createTexture: () => {
        const texture = new DataTexture(new Uint8Array(4), 1, 1)
        texture.dispose = vi.fn()
        created.push(texture as never)
        return texture
      },
    })
    const first = cache.get(textLayer())
    expect(cache.get(textLayer())).toBe(first)
    expect(created).toHaveLength(1)

    const second = cache.get(textLayer({ fontSize: 0.3 }))
    expect(second).not.toBe(first)
    expect(created).toHaveLength(2)
    expect(created[0].dispose).toHaveBeenCalledTimes(1)
  })

  it("普通图层返回 null，不创建纹理", () => {
    const createTexture = vi.fn()
    const cache = new TextTextureCache({ createTexture })
    expect(cache.get(LayerSchema.parse({ id: "n1" }))).toBeNull()
    expect(createTexture).not.toHaveBeenCalled()
  })

  it("retain 释放已不存在的图层（关掉眼睛不重建，删层才释放）", () => {
    const created: { dispose: ReturnType<typeof vi.fn> }[] = []
    const cache = new TextTextureCache({
      createTexture: () => {
        const texture = new DataTexture(new Uint8Array(4), 1, 1)
        texture.dispose = vi.fn()
        created.push(texture as never)
        return texture
      },
    })
    cache.get(textLayer())
    cache.retain(new Set(["l1"]))
    expect(created[0].dispose).not.toHaveBeenCalled()
    cache.retain(new Set())
    expect(created[0].dispose).toHaveBeenCalledTimes(1)
  })

  it("创建失败不缓存：下次重建再试，且每个图层只警告一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const createTexture = vi.fn(() => null)
    const cache = new TextTextureCache({ createTexture })
    expect(cache.get(textLayer())).toBeNull()
    expect(cache.get(textLayer())).toBeNull()
    expect(createTexture).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe("宽高比", () => {
  it("栅格化尺寸随宽高比，高度固定 1024", () => {
    expect(textTextureSize(1)).toEqual({ width: 1024, height: 1024 })
    expect(textTextureSize(2)).toEqual({ width: 2048, height: 1024 })
    expect(textTextureSize(2.5 / 3.5)).toEqual({
      width: TEXT_TEXTURE_WIDTH,
      height: TEXT_TEXTURE_HEIGHT,
    })
  })

  it("renderTextRaster 按 aspect 取画布尺寸（不传 width 时）", () => {
    const seen: Array<{ width: number; height: number }> = []
    renderTextRaster(params({ content: "A" }), {
      aspect: 1,
      createCanvas: (w, h) => {
        seen.push({ width: w, height: h })
        return fakeCanvas(w, h).canvas
      },
    })
    expect(seen).toEqual([{ width: 1024, height: 1024 }])
  })

  it("文字纹理缓存按 aspect 的尺寸建纹理", () => {
    const sizes: Array<{ width: number; height: number }> = []
    const cache = new TextTextureCache({
      aspect: 1,
      createTexture: (_params, size) => {
        sizes.push(size)
        return new DataTexture(new Uint8Array(4), 1, 1)
      },
    })
    expect(cache.get(textLayer())).not.toBeNull()
    expect(sizes).toEqual([{ width: 1024, height: 1024 }])
  })
})
