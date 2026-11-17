/**
 * 未揭晓底纹的契约。
 *
 * 这里没有 WebGL，能钉住的是画布上的落笔：**纯色底 + 居中一个大问号**，
 * 不再有棋盘格、水豚 logo 或满版问号。着色器本身只能在真机 / 浏览器里看。
 */
import { describe, expect, it } from "vitest"
import {
  createMysteryFace,
  createMysteryTexture,
  drawMysteryCard,
  mysteryTextureWidth,
  MYSTERY_TEXTURE_HEIGHT,
  MYSTERY_TEXTURE_WIDTH,
  type MysteryCanvas2D,
  type MysteryContext2D,
} from "../mystery-face"
import { CARD_ASPECT } from "../card-scene"

/** 一次落笔的记录：伪 2D 上下文只记我们关心的调用。 */
interface Recorded {
  fillRects: Array<{ x: number; y: number; w: number; h: number; color: unknown }>
  texts: Array<{ text: string; x: number; y: number; font: string; color: unknown }>
}

/**
 * 造一个只实现用到的成员的伪画布。
 *
 * 补全 `TextContext2D` 的一堆文字相关成员对这里没有意义（底纹只用矩形与文字），故用类型断言
 * 收窄；断言只发生在本文件，生产代码走的仍是完整接口。
 */
function fakeCanvas(): { canvas: MysteryCanvas2D; recorded: Recorded } {
  const recorded: Recorded = { fillRects: [], texts: [] }
  const ctx = {
    fillStyle: "" as unknown,
    font: "",
    textAlign: "",
    textBaseline: "",
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      recorded.fillRects.push({ x, y, w, h, color: ctx.fillStyle })
    },
    fillText: (text: string, x: number, y: number) => {
      recorded.texts.push({ text, x, y, font: ctx.font, color: ctx.fillStyle })
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  } as unknown as MysteryContext2D
  return {
    canvas: {
      width: MYSTERY_TEXTURE_WIDTH,
      height: MYSTERY_TEXTURE_HEIGHT,
      getContext: () => ctx,
    },
    recorded,
  }
}

const drawWith = (width = MYSTERY_TEXTURE_WIDTH): Recorded => {
  const { canvas, recorded } = fakeCanvas()
  drawMysteryCard(canvas.getContext("2d") as MysteryContext2D, width, MYSTERY_TEXTURE_HEIGHT)
  return recorded
}

describe("栅格化", () => {
  it("底色一次铺满整张卡面，不再有棋盘格", () => {
    const { fillRects } = drawWith()
    expect(fillRects).toHaveLength(1)
    expect(fillRects[0]).toMatchObject({
      x: 0,
      y: 0,
      w: MYSTERY_TEXTURE_WIDTH,
      h: MYSTERY_TEXTURE_HEIGHT,
    })
  })

  it("只印一个大问号，居中且没有 logo", () => {
    const { texts } = drawWith()
    expect(texts).toHaveLength(1)
    const [mark] = texts
    expect(mark.text).toBe("?")
    expect(mark.x).toBe(MYSTERY_TEXTURE_WIDTH / 2)
    expect(mark.y).toBe(MYSTERY_TEXTURE_HEIGHT / 2)
  })

  it("问号够大：字号至少占纹理高度的三成", () => {
    const { texts } = drawWith()
    const size = Number(texts[0].font.match(/bold (\d+)px/)?.[1])
    expect(size).toBeGreaterThanOrEqual(MYSTERY_TEXTURE_HEIGHT * 0.3)
  })

  it("拿不到画布时返回 null（调用方退化成直接显示真卡面）", () => {
    expect(createMysteryTexture(() => null)).toBeNull()
  })
})

describe("材质", () => {
  /** 伪造画布工厂：宽度 / 高度按调用方传入，其余无所谓。 */
  const factory = (w: number, h: number) => {
    const { canvas } = fakeCanvas()
    canvas.width = w
    canvas.height = h
    return canvas
  }

  it("纹理尺寸按 5:7 卡面推算", () => {
    const texture = createMysteryTexture(factory)
    expect(texture?.image.width).toBe(MYSTERY_TEXTURE_WIDTH)
    expect(texture?.image.height).toBe(MYSTERY_TEXTURE_HEIGHT)
  })

  it("圆角半径与卡面宽高比原样传进 uniform（圆角必须与卡面同一口径）", () => {
    const face = createMysteryFace({
      aspect: CARD_ASPECT,
      cornerRadius: 0.06,
      createCanvas: factory,
    })
    expect(face).not.toBeNull()
    expect(face?.material.uniforms.uAspect.value).toBe(CARD_ASPECT)
    expect(face?.material.uniforms.uCornerRadius.value).toBe(0.06)
    face?.dispose()
  })
})

describe("宽高比", () => {
  it("纹理宽度跟着宽高比走，问号不会被拉扁", () => {
    expect(mysteryTextureWidth(5 / 7)).toBe(480)
    expect(mysteryTextureWidth(1)).toBe(672)
    expect(mysteryTextureWidth(2)).toBe(1344)
  })

  it("极端 / 非法宽高比至少给一个像素宽", () => {
    expect(mysteryTextureWidth(0)).toBe(MYSTERY_TEXTURE_WIDTH)
    expect(mysteryTextureWidth(-1)).toBe(MYSTERY_TEXTURE_WIDTH)
    expect(mysteryTextureWidth(0.0001)).toBe(1)
  })

  it("底纹材质按该比例建图", () => {
    const widths: number[] = []
    const factory = (w: number, _h: number) => {
      widths.push(w)
      return fakeCanvas().canvas
    }
    createMysteryFace({ aspect: 1, cornerRadius: 0.06, createCanvas: factory })
    expect(widths[0]).toBe(672)
  })
})
