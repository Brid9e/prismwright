import { describe, it, expect } from "vitest"
import { createEmptyPack } from "../defaults"
import {
  LayerSchema,
  CardFaceSchema,
  CardSchema,
  PackSchema,
  GlossParamsSchema,
  MoireParamsSchema,
  GradientParamsSchema,
  HoloGridParamsSchema,
  MaskPresetParamsSchema,
  PaletteParamsSchema,
  evenlySpacedStops,
} from "../schema"

const validLayer = {
  id: "l1",
  name: "面纱",
  enabled: true,
  holoMix: 0.9,
  holoAlpha: 1,
  blend: "add" as const,
  opacity: 1,
}

describe("LayerSchema", () => {
  it("接受合法图层", () => {
    expect(LayerSchema.parse(validLayer).id).toBe("l1")
  })

  it("填充缺省字段", () => {
    const parsed = LayerSchema.parse({ id: "l2" })
    expect(parsed.holoMix).toBeCloseTo(0.9)
    expect(parsed.effects).toEqual([])
  })

  it("拒绝未知的 blend", () => {
    const bad = { ...validLayer, blend: "overlay" }
    expect(() => LayerSchema.parse(bad)).toThrow()
  })

  it("拒绝超出范围的 holoMix", () => {
    const bad = { ...validLayer, holoMix: 1.5 }
    expect(() => LayerSchema.parse(bad)).toThrow()
  })
})

describe("PaletteParamsSchema 的色标解析与归一化", () => {
  it("默认 colors 为空数组", () => {
    expect(PaletteParamsSchema.parse({}).colors).toEqual([])
  })

  it("接受 3 位 hex 颜色，并展开为单个色标", () => {
    expect(PaletteParamsSchema.parse({ colors: ["#fff"] }).colors).toEqual([
      { color: "#fff", at: 0.5 },
    ])
  })

  it("拒绝非法 hex 颜色", () => {
    expect(() => PaletteParamsSchema.parse({ colors: ["red"] })).toThrow()
  })

  it("接受恰好 8 个色标", () => {
    const colors = Array.from({ length: 8 }, () => "#ffffff")
    expect(PaletteParamsSchema.parse({ colors }).colors).toHaveLength(8)
  })

  it("拒绝超过 8 个色标", () => {
    const colors = Array.from({ length: 9 }, () => "#ffffff")
    expect(() => PaletteParamsSchema.parse({ colors })).toThrow()
  })

  it("旧格式（裸字符串数组）按下标等距展开：位置 0, 1/(N-1), …, 1", () => {
    expect(PaletteParamsSchema.parse({ colors: ["#111111", "#222222", "#333333"] }).colors).toEqual(
      [
        { color: "#111111", at: 0 },
        { color: "#222222", at: 0.5 },
        { color: "#333333", at: 1 },
      ],
    )
  })

  it("新格式原样通过，且不是同一份对象引用", () => {
    const stops = [{ color: "#111111", at: 0.25 }]
    const parsed = PaletteParamsSchema.parse({ colors: stops }).colors
    expect(parsed).toEqual([{ color: "#111111", at: 0.25 }])
    expect(parsed[0]).not.toBe(stops[0])
  })

  it("未排序的位置在解析期排序", () => {
    const parsed = PaletteParamsSchema.parse({
      colors: [
        { color: "#111111", at: 0.9 },
        { color: "#222222", at: 0.1 },
      ],
    }).colors
    expect(parsed.map((s) => s.at)).toEqual([0.1, 0.9])
  })

  it("混格式：字符串按它在数组里的下标展开，其余原样，最后统一排序", () => {
    // 下标 0 / 1，n=2 → at = 0 / 1；再按 at 升序排 → [#111111@0, #222222@0.9]
    expect(
      PaletteParamsSchema.parse({ colors: ["#111111", { color: "#222222", at: 0.9 }] }).colors,
    ).toEqual([
      { color: "#111111", at: 0 },
      { color: "#222222", at: 0.9 },
    ])
  })

  it("位置重合是允许的（表达硬边）", () => {
    const parsed = PaletteParamsSchema.parse({
      colors: [
        { color: "#111111", at: 0.5 },
        { color: "#222222", at: 0.5 },
      ],
    }).colors
    expect(parsed).toHaveLength(2)
  })

  it("拒绝越界的 at", () => {
    expect(() => PaletteParamsSchema.parse({ colors: [{ color: "#111111", at: 1.5 }] })).toThrow()
    expect(() => PaletteParamsSchema.parse({ colors: [{ color: "#111111", at: -0.1 }] })).toThrow()
  })

  it("拒绝缺 at 或色值非法的对象形式", () => {
    expect(() => PaletteParamsSchema.parse({ colors: [{ color: "#111111" }] })).toThrow()
    expect(() => PaletteParamsSchema.parse({ colors: [{ color: "red", at: 0 }] })).toThrow()
  })

  it("对象形式的第 9 个色标同样被拒", () => {
    const colors = Array.from({ length: 9 }, (_, i) => ({ color: "#ffffff", at: i / 8 }))
    expect(() => PaletteParamsSchema.parse({ colors })).toThrow()
  })

  it("整个系列：palette 效果里的裸字符串色标（旧格式）仍能解析", () => {
    const layer = {
      ...validLayer,
      effects: [{ kind: "palette" as const, id: "e1", params: { colors: ["#ff00ff", "#00ffff"] } }],
    }
    const pack = PackSchema.parse({
      schemaVersion: 9,
      id: "p1",
      name: "旧包",
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
      cards: [{ id: "c1", num: 1, name: "旧卡", layers: [layer] }],
    })
    expect(pack.cards[0].layers[0].effects[0]).toMatchObject({
      kind: "palette",
      params: {
        colors: [
          { color: "#ff00ff", at: 0 },
          { color: "#00ffff", at: 1 },
        ],
      },
    })
  })
})

describe("evenlySpacedStops", () => {
  it("按下标等距展开：位置 0, 1/(N-1), …, 1（与 CSS 渐变默认一致）", () => {
    expect(evenlySpacedStops(["#111111", "#222222", "#333333"])).toEqual([
      { color: "#111111", at: 0 },
      { color: "#222222", at: 0.5 },
      { color: "#333333", at: 1 },
    ])
  })

  it("单个色标落在中点（否则会除以 0）", () => {
    expect(evenlySpacedStops(["#111111"])).toEqual([{ color: "#111111", at: 0.5 }])
  })

  it("空数组给出空数组", () => {
    expect(evenlySpacedStops([])).toEqual([])
  })
})

describe("GlossParamsSchema / MoireParamsSchema / GradientParamsSchema", () => {
  it("gloss.count 接受端点、拒绝越界与非整数", () => {
    expect(GlossParamsSchema.parse({ count: 1 }).count).toBe(1)
    expect(GlossParamsSchema.parse({ count: 16 }).count).toBe(16)
    expect(() => GlossParamsSchema.parse({ count: 1.5 })).toThrow()
    expect(() => GlossParamsSchema.parse({ count: 0 })).toThrow()
    expect(() => GlossParamsSchema.parse({ count: 17 })).toThrow()
  })

  // 颜色可缺省是「存量卡逐像素不变」的前提：缺省 = 着色器里的老暖白常量，
  // 一旦补上一个默认 hex，老系列的光带颜色就会变。
  it("gloss.color 可缺省；接受 3 / 6 位 hex，拒绝非法值", () => {
    expect(GlossParamsSchema.parse({}).color).toBeUndefined()
    expect(GlossParamsSchema.parse({ color: "#abc" }).color).toBe("#abc")
    expect(GlossParamsSchema.parse({ color: "#A1B2C3" }).color).toBe("#A1B2C3")
    expect(() => GlossParamsSchema.parse({ color: "red" })).toThrow()
    expect(() => GlossParamsSchema.parse({ color: "#abcd" })).toThrow()
    expect(() => GlossParamsSchema.parse({ color: "#12345g" })).toThrow()
  })

  // asMask 缺省 false = 普通光泽（存量行为）；true 才转成子树蒙版。
  it("gloss.asMask 缺省 false、接受 true", () => {
    expect(GlossParamsSchema.parse({}).asMask).toBe(false)
    expect(GlossParamsSchema.parse({ asMask: true }).asMask).toBe(true)
  })

  // 宽度上限放到 1：那是「整幅都亮着」的大光晕，仍是有效画法；下界不动。
  it("gloss.width 接受 1、拒绝越界", () => {
    expect(GlossParamsSchema.parse({ width: 1 }).width).toBe(1)
    expect(() => GlossParamsSchema.parse({ width: 1.01 })).toThrow()
    expect(() => GlossParamsSchema.parse({ width: 0.004 })).toThrow()
  })

  // 羽化：0 = 硬边，1 = 从中心一路渐隐（也就是原来的画法）。缺省必须取 1，
  // 否则老系列一解析，光带边缘就会凭空变硬。
  it("gloss.softness 缺省 1、接受端点、拒绝越界", () => {
    expect(GlossParamsSchema.parse({}).softness).toBe(1)
    expect(GlossParamsSchema.parse({ softness: 0 }).softness).toBe(0)
    expect(() => GlossParamsSchema.parse({ softness: -0.01 })).toThrow()
    expect(() => GlossParamsSchema.parse({ softness: 1.01 })).toThrow()
  })

  // 光带整体平移：缺省 0 = 钉在原来位置，存量画面逐像素不变。
  it("gloss.offsetX / offsetY 缺省 0、接受 ±1、拒绝越界", () => {
    expect(GlossParamsSchema.parse({}).offsetX).toBe(0)
    expect(GlossParamsSchema.parse({}).offsetY).toBe(0)
    expect(GlossParamsSchema.parse({ offsetX: -1, offsetY: 1 }).offsetX).toBe(-1)
    expect(() => GlossParamsSchema.parse({ offsetX: 1.01 })).toThrow()
    expect(() => GlossParamsSchema.parse({ offsetY: -1.01 })).toThrow()
  })

  it("moire.density 接受端点、拒绝越界与非整数", () => {
    expect(MoireParamsSchema.parse({ density: 1 }).density).toBe(1)
    expect(MoireParamsSchema.parse({ density: 64 }).density).toBe(64)
    expect(() => MoireParamsSchema.parse({ density: 1.5 })).toThrow()
    expect(() => MoireParamsSchema.parse({ density: 0 })).toThrow()
    expect(() => MoireParamsSchema.parse({ density: 65 })).toThrow()
  })

  // contentRelief 默认 1：保持图层内容浮雕的现有行为；旧面级 faceStrength 由 v9 迁移显式写入。
  it("moire.contentRelief 缺省补 1、接受端点、拒绝越界", () => {
    expect(MoireParamsSchema.parse({}).contentRelief).toBe(1)
    expect(MoireParamsSchema.parse({ contentRelief: 0 }).contentRelief).toBe(0)
    expect(MoireParamsSchema.parse({ contentRelief: 1 }).contentRelief).toBe(1)
    expect(() => MoireParamsSchema.parse({ contentRelief: -0.01 })).toThrow()
    expect(() => MoireParamsSchema.parse({ contentRelief: 1.01 })).toThrow()
  })

  it("PatternMode 非法值被拒、合法值被接受", () => {
    expect(() => GlossParamsSchema.parse({ mode: "diagonal" })).toThrow()
    expect(() => GradientParamsSchema.parse({ mode: "diagonal" })).toThrow()
    expect(GlossParamsSchema.parse({ mode: "radial" }).mode).toBe("radial")
    // 射线是后加的第三种取值：镜面校验、渐变空间、摩尔纹三处共用这一枚举，任一处漏加都会在此暴露。
    expect(GlossParamsSchema.parse({ mode: "rays" }).mode).toBe("rays")
    expect(GradientParamsSchema.parse({ mode: "rays" }).mode).toBe("rays")
    expect(MoireParamsSchema.parse({ mode: "rays" }).mode).toBe("rays")
  })

  it("gradient 缺省时补默认（平行斜坡、count 31、angle 38.4、相位取默认）", () => {
    expect(GradientParamsSchema.parse({})).toEqual({
      mode: "parallel",
      count: 31,
      angle: 38.4,
      twist: 0,
      // 种子默认 0 = 不随机：存量系列解析后扭转仍由手调值决定，画面逐像素不变。
      twistSeed: 0,
      distortionStrength: 5,
      phaseSpeed: 1,
      tiltGain: 1,
      noiseStrength: 0,
      transition: 1,
      offsetX: 0,
      offsetY: 0,
      // 整齐默认 0 = 保留原来的折射 / 噪声扰动，存量画面逐像素不变。
      straight: 0,
    })
  })

  // 整齐：1 = 只留渐变斜坡本身，色带笔直等距。取值域夹在 0–1。
  it("gradient.straight 缺省 0、接受端点、拒绝越界", () => {
    expect(GradientParamsSchema.parse({}).straight).toBe(0)
    expect(GradientParamsSchema.parse({ straight: 1 }).straight).toBe(1)
    expect(() => GradientParamsSchema.parse({ straight: -0.01 })).toThrow()
    expect(() => GradientParamsSchema.parse({ straight: 1.01 })).toThrow()
  })
})

describe("CardSchema", () => {
  it("接受含图层列表的卡片并填充默认", () => {
    const card = CardSchema.parse({ id: "c1", num: 1, name: "卡名", layers: [validLayer] })
    expect(card.notes).toBe("")
    expect(card.rarity).toBe("common")
    expect(card.layers).toHaveLength(1)
  })

  it("要求 num 为非负整数", () => {
    expect(() => CardSchema.parse({ id: "c1", num: 1.5, name: "x", layers: [] })).toThrow()
  })

  it("接受 num: 0", () => {
    expect(CardSchema.parse({ id: "c1", num: 0, name: "x", layers: [] }).num).toBe(0)
  })

  it("拒绝 num: -1", () => {
    expect(() => CardSchema.parse({ id: "c1", num: -1, name: "x", layers: [] })).toThrow()
  })
})

describe("PackSchema", () => {
  const minimal = {
    schemaVersion: 9 as const,
    id: "p1",
    name: "星辰之约",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  }

  it("接受最小系列并填充集合默认值", () => {
    const pack = PackSchema.parse(minimal)
    expect(pack.cards).toEqual([])
    expect(pack.hiddenCards).toEqual([])
    expect(pack.back).toBeNull()
    expect(pack.rarityGradients).toEqual({})
    expect(pack.notes).toBe("")
  })

  it("editorVersion 缺省填 v1，接受 vN 并拒绝其他写法", () => {
    expect(PackSchema.parse(minimal).editorVersion).toBe("v1")
    expect(PackSchema.parse({ ...minimal, editorVersion: "v2" }).editorVersion).toBe("v2")
    expect(() => PackSchema.parse({ ...minimal, editorVersion: "1" })).toThrow()
    expect(() => PackSchema.parse({ ...minimal, editorVersion: "v1.0" })).toThrow()
  })

  it("要求 name 非空", () => {
    expect(() => PackSchema.parse({ ...minimal, name: "" })).toThrow()
  })

  it("要求 schemaVersion 恰为 9", () => {
    expect(PackSchema.parse(minimal).schemaVersion).toBe(9)
    expect(() => PackSchema.parse({ ...minimal, schemaVersion: 3 })).toThrow()
    expect(() => PackSchema.parse({ ...minimal, schemaVersion: 6 })).toThrow()
  })

  it("接受合法的 rarityGradients 键", () => {
    const pack = PackSchema.parse({ ...minimal, rarityGradients: { legendary: ["#ffd700"] } })
    expect(pack.rarityGradients).toEqual({ legendary: ["#ffd700"] })
  })

  it("拒绝非法的 rarityGradients 键", () => {
    expect(() => PackSchema.parse({ ...minimal, rarityGradients: { foo: ["#ffffff"] } })).toThrow()
  })
})

describe("HoloGridParamsSchema", () => {
  it("缺省时补默认（3 族、0°、频率 30、粗细 1/7、强度 0.5、位移 0）", () => {
    expect(HoloGridParamsSchema.parse({})).toEqual({
      count: 3,
      angle: 0,
      density: 30,
      // 线宽默认值必须**恰好**是 1/7：着色器历史上的阈值就是 6/7（见 common.ts 的
      // latticeField），取这个值才能保证「加了粗细参数之后，老系列画面逐像素不变」。
      width: 1 / 7,
      strength: 0.5,
      offsetX: 0,
      offsetY: 0,
    })
  })

  it("count 接受端点 1 与 8、拒绝越界与非整数", () => {
    expect(HoloGridParamsSchema.parse({ count: 1 }).count).toBe(1)
    expect(HoloGridParamsSchema.parse({ count: 8 }).count).toBe(8)
    expect(() => HoloGridParamsSchema.parse({ count: 0 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ count: 9 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ count: 2.5 })).toThrow()
  })

  it("density 接受端点 1 与 100、拒绝越界与非整数", () => {
    expect(HoloGridParamsSchema.parse({ density: 1 }).density).toBe(1)
    expect(HoloGridParamsSchema.parse({ density: 100 }).density).toBe(100)
    expect(() => HoloGridParamsSchema.parse({ density: 0 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ density: 101 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ density: 30.5 })).toThrow()
  })

  it("angle / strength 接受端点、拒绝越界", () => {
    expect(HoloGridParamsSchema.parse({ angle: 360 }).angle).toBe(360)
    expect(HoloGridParamsSchema.parse({ strength: 1 }).strength).toBe(1)
    expect(() => HoloGridParamsSchema.parse({ angle: -1 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ angle: 361 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ strength: -0.01 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ strength: 1.01 })).toThrow()
  })

  it("width 接受端点、拒绝越界与 0（着色器里要拿它做除数）", () => {
    expect(HoloGridParamsSchema.parse({ width: 0.02 }).width).toBe(0.02)
    expect(HoloGridParamsSchema.parse({ width: 0.6 }).width).toBe(0.6)
    expect(() => HoloGridParamsSchema.parse({ width: 0 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ width: 0.019 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ width: 0.61 })).toThrow()
  })

  it("offsetX / offsetY 默认为 0（点阵不动）", () => {
    expect(HoloGridParamsSchema.parse({}).offsetX).toBe(0)
    expect(HoloGridParamsSchema.parse({}).offsetY).toBe(0)
  })

  it("offsetX / offsetY 接受端点 -1 与 1、拒绝越界", () => {
    const out = HoloGridParamsSchema.parse({ offsetX: -1, offsetY: 1 })
    expect(out.offsetX).toBe(-1)
    expect(out.offsetY).toBe(1)
    expect(() => HoloGridParamsSchema.parse({ offsetX: -1.01 })).toThrow()
    expect(() => HoloGridParamsSchema.parse({ offsetY: 1.01 })).toThrow()
  })
})

describe("MaskPresetParamsSchema", () => {
  // id 现在是**必填**（效果条目自带 id 表达「哪种预设」）；先钉住默认值，再逐个字段验证。
  const p = (over: Record<string, unknown> = {}) =>
    MaskPresetParamsSchema.parse({ id: "seed", ...over })

  it("缺省时补默认（四边形碎片、spike 1、密度 14、种子 1）", () => {
    expect(p()).toEqual({
      id: "seed",
      sides: 4,
      spike: 1,
      irregular: 0,
      equilateral: false,
      density: 14,
      size: 0.06,
      sizeJitter: 0.5,
      arrangement: "random",
      offsetX: 0,
      offsetY: 0,
      flipX: false,
      flipY: false,
      rotation: 0,
      seed: 1,
      softness: 0.02,
      invert: false,
    })
  })

  it("id 必填、接受任意非空字符串、拒绝空串（不当它是枚举，注册表是前端概念）", () => {
    expect(MaskPresetParamsSchema.parse({ id: "shards" }).id).toBe("shards")
    expect(MaskPresetParamsSchema.parse({ id: "未来新增的预设" }).id).toBe("未来新增的预设")
    // "" 不是任何真实预设：若放行，会拿默认形状意外开启程序化蒙版。
    expect(() => MaskPresetParamsSchema.parse({ id: "" })).toThrow()
    expect(() => MaskPresetParamsSchema.parse({})).toThrow()
  })

  it("sides 接受端点 3 与 64、拒绝越界与非整数", () => {
    expect(p({ sides: 3 }).sides).toBe(3)
    expect(p({ sides: 64 }).sides).toBe(64)
    expect(() => p({ sides: 2 })).toThrow()
    expect(() => p({ sides: 65 })).toThrow()
    expect(() => p({ sides: 4.5 })).toThrow()
  })

  it("spike 接受端点 0.1 与 1、拒绝越界", () => {
    expect(p({ spike: 0.1 }).spike).toBe(0.1)
    expect(p({ spike: 1 }).spike).toBe(1)
    expect(() => p({ spike: 0.09 })).toThrow()
    expect(() => p({ spike: 1.01 })).toThrow()
  })

  // 不规则度：0 = 完全规则多边形（= 加该参数之前的画面），1 = 顶点半径随机缩放到底（碎片感）。
  // 默认取 0，存量系列解析后画面才能逐像素不变。
  it("irregular 默认 0、接受端点 0 与 1、拒绝越界", () => {
    expect(p().irregular).toBe(0)
    expect(p({ irregular: 1 }).irregular).toBe(1)
    expect(() => p({ irregular: -0.01 })).toThrow()
    expect(() => p({ irregular: 1.01 })).toThrow()
  })

  // 等边：开 = 把形状锁成正多边形（等边三角 / 正方形 / 正六边形），不规则滑块拖到哪都不生效。
  // 默认 false = 由 irregular 决定，存量系列解析后画面逐像素不变（着色器里该项只以「乘 1.0」入场）。
  it("equilateral 默认 false、只收布尔", () => {
    expect(p().equilateral).toBe(false)
    expect(p({ equilateral: true }).equilateral).toBe(true)
    expect(() => p({ equilateral: 1 })).toThrow()
    expect(() => p({ equilateral: "true" })).toThrow()
  })

  // 整场翻转：把整张蒙版（格子排布 + 每块碎片）当贴图镜像。默认关 = 不翻。
  it("flipX / flipY 默认 false、只收布尔", () => {
    const d = p()
    expect(d.flipX).toBe(false)
    expect(d.flipY).toBe(false)
    const out = p({ flipX: true, flipY: true })
    expect(out.flipX).toBe(true)
    expect(out.flipY).toBe(true)
    expect(() => p({ flipX: 1 })).toThrow()
  })

  // 旋转取**度**、值域 0–360（与 GradientParams.angle / HoloGridParams.angle 同口径），换算弧度交给着色器。
  // 默认 0 = 不转，着色器里 cos(0)/sin(0) 恰好是 1/0，采样点逐位不动。
  it("rotation 默认 0（度）、接受端点 0 与 360、拒绝越界", () => {
    expect(p().rotation).toBe(0)
    expect(p({ rotation: 0 }).rotation).toBe(0)
    expect(p({ rotation: 360 }).rotation).toBe(360)
    expect(() => p({ rotation: -0.01 })).toThrow()
    expect(() => p({ rotation: 360.01 })).toThrow()
  })

  it("density 接受端点 1 与 64、拒绝越界与非整数", () => {
    expect(p({ density: 1 }).density).toBe(1)
    expect(p({ density: 64 }).density).toBe(64)
    expect(() => p({ density: 0 })).toThrow()
    expect(() => p({ density: 65 })).toThrow()
    expect(() => p({ density: 14.5 })).toThrow()
  })

  it("size / sizeJitter 接受端点、拒绝越界", () => {
    expect(p({ size: 0.01 }).size).toBe(0.01)
    expect(p({ size: 0.3 }).size).toBe(0.3)
    expect(() => p({ size: 0.009 })).toThrow()
    expect(() => p({ size: 0.31 })).toThrow()
    expect(p({ sizeJitter: 0 }).sizeJitter).toBe(0)
    expect(p({ sizeJitter: 1 }).sizeJitter).toBe(1)
    expect(() => p({ sizeJitter: -0.01 })).toThrow()
    expect(() => p({ sizeJitter: 1.01 })).toThrow()
  })

  it("offsetX / offsetY 默认 0、接受端点 -1 与 1、拒绝越界", () => {
    expect(p().offsetX).toBe(0)
    expect(p().offsetY).toBe(0)
    const out = p({ offsetX: -1, offsetY: 1 })
    expect(out.offsetX).toBe(-1)
    expect(out.offsetY).toBe(1)
    expect(() => p({ offsetX: -1.01 })).toThrow()
    expect(() => p({ offsetY: 1.01 })).toThrow()
  })

  // 排布：random = 位置/朝向/大小都随机（= 加该参数之前的画面），regular = 规整网格。
  // 默认取 random，存量系列解析后画面才能逐像素不变。
  it("arrangement 默认 random、接受 regular、拒绝其他取值", () => {
    expect(p().arrangement).toBe("random")
    expect(p({ arrangement: "regular" }).arrangement).toBe("regular")
    expect(() => p({ arrangement: "jittered" })).toThrow()
  })

  // 种子参与哈希输入，须为整数：非整数会让「重掷」按钮的相邻取值产出同一批布局。
  it("seed 接受端点 0 与 1e6、拒绝越界与非整数", () => {
    expect(p({ seed: 0 }).seed).toBe(0)
    expect(p({ seed: 1e6 }).seed).toBe(1e6)
    expect(() => p({ seed: -1 })).toThrow()
    expect(() => p({ seed: 1e6 + 1 })).toThrow()
    expect(() => p({ seed: 1.5 })).toThrow()
  })

  it("softness 接受端点 0 与 0.5、拒绝越界", () => {
    expect(p({ softness: 0 }).softness).toBe(0)
    expect(p({ softness: 0.5 }).softness).toBe(0.5)
    expect(() => p({ softness: -0.01 })).toThrow()
    expect(() => p({ softness: 0.51 })).toThrow()
  })
})

describe("卡面形状", () => {
  const minimalPack = {
    schemaVersion: 9 as const,
    id: "p1",
    name: "星辰之约",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  }

  it("卡面不再持有比例，只留圆角（缺省 6%）", () => {
    const parsed = CardFaceSchema.parse({})
    expect(parsed).not.toHaveProperty("aspect")
    expect(parsed.cornerRadius).toBeCloseTo(0.06)
  })

  it("圆角接受 0–0.5，拒绝越界", () => {
    expect(CardFaceSchema.parse({ cornerRadius: 0.5 }).cornerRadius).toBe(0.5)
    expect(() => CardFaceSchema.parse({ cornerRadius: -0.01 })).toThrow()
    expect(() => CardFaceSchema.parse({ cornerRadius: 0.51 })).toThrow()
  })

  it("比例挂在系列上：缺省 5:7，接受任意值，拒绝越界", () => {
    expect(PackSchema.parse(minimalPack).aspect).toBeCloseTo(2.5 / 3.5)
    expect(PackSchema.parse({ ...minimalPack, aspect: 1 }).aspect).toBe(1)
    expect(() => PackSchema.parse({ ...minimalPack, aspect: 0.1 })).toThrow()
    expect(() => PackSchema.parse({ ...minimalPack, aspect: 5 })).toThrow()
  })

  it("卡面里多出来的 aspect 会被丢弃（老数据不回流）", () => {
    const pack = PackSchema.parse({ ...minimalPack, cards: [{ id: "c1", num: 0, name: "", aspect: 2 }] })
    expect(pack.cards[0]).not.toHaveProperty("aspect")
  })
})

describe("系列封面", () => {
  it("缺 coverLarge / coverSmall 的老包解析后补空串", () => {
    const pack = PackSchema.parse({
      schemaVersion: 9,
      id: "p1",
      name: "老系列",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    expect(pack.coverLarge).toBe("")
    expect(pack.coverSmall).toBe("")
    expect(pack.packArt).toBe("")
  })

  it("createEmptyPack 的封面字段默认空串", () => {
    const pack = createEmptyPack("新系列")
    expect(pack.coverLarge).toBe("")
    expect(pack.coverSmall).toBe("")
    expect(pack.packArt).toBe("")
  })
})

describe("卡包图样式", () => {
  const minimalPack = {
    schemaVersion: 9 as const,
    id: "p1",
    name: "星辰之约",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  }

  it("缺 packArtStyle 的老包补默认值：叠加、不透明、cover、居中、无滤镜", () => {
    expect(PackSchema.parse(minimalPack).packArtStyle).toEqual({
      blend: "screen",
      opacity: 1,
      packBrightness: 1,
      packContrast: 1,
      packInvert: false,
      fit: "cover",
      x: 50,
      y: 50,
      artBrightness: 1,
      artSaturate: 1,
    })
  })

  it("只给部分字段时其余补默认", () => {
    const pack = PackSchema.parse({
      ...minimalPack,
      packArtStyle: { blend: "soft-light", opacity: 0.6 },
    })
    expect(pack.packArtStyle.blend).toBe("soft-light")
    expect(pack.packArtStyle.opacity).toBeCloseTo(0.6)
    expect(pack.packArtStyle.fit).toBe("cover")
  })

  it("拒绝未知的混合模式、未知的填充方式与越界数值", () => {
    const p = (packArtStyle: unknown) => () => PackSchema.parse({ ...minimalPack, packArtStyle })
    expect(p({ blend: "plus-lighter" })).toThrow()
    expect(p({ fit: "stretch" })).toThrow()
    expect(p({ opacity: 2 })).toThrow()
    expect(p({ x: -1 })).toThrow()
    expect(p({ artBrightness: 0 })).toThrow()
  })
})
