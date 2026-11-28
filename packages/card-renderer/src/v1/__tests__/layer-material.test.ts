/**
 * 材质与着色器之间的 uniform 契约。
 *
 * 为什么值得测：GLSL 本身跑不了（node 环境没有 WebGL），但「着色器声明了 `uStops`、
 * 材质却还在写 `uColorCount`」这种错配在类型上完全看不出来，而症状是**颜色静默不动**。
 * 这个测试钉的是那个接缝。祖先蒙版与效果栈的两组 uniform 同理——名字对不上、或某条效果
 * 忘了折成数组，画面会静默失效而类型层面毫无提示。
 *
 * `new ShaderMaterial(...)` 是纯 JS，不需要 GL 上下文，因此可以在 node 里构造。
 */
import { describe, it, expect } from "vitest"
import { Color, DataTexture, NormalBlending, RGBAFormat, Vector2, Vector4, type Texture } from "three"
import {
  EffectSchema,
  ImageParamsSchema,
  LayerSchema,
  MAX_NEST_DEPTH,
  resolveImageMask,
  type Effect,
  type GradientParams,
  type ImageParams,
} from "@prismwright/schema"
import { CARD_ASPECT } from "../card-scene"
import { MAX_PALETTE } from "../palette"
import { createLayerMaterial } from "../materials/layer-material"
import { frontUvTransform } from "../front-uv"

/** 1×1 占位纹理：充当未使用祖先槽位（也充当没有蒙版的祖先）的 sampler 绑定。 */
const placeholder = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat)

/** 2×1 的纹理：自然宽高比 2，用来验证自适应宽度换算。 */
const imageTexture = new DataTexture(new Uint8Array(2 * 4), 2, 1, RGBAFormat)

/** 造一条 image 效果。 */
function image(params: Record<string, unknown> = {}): Effect {
  return EffectSchema.parse({ kind: "image", id: "img", enabled: true, params }) as Effect
}

// 极简图层：色标与相位全局项都已退役到效果栈（`palette` / `gradient`），本层不再持有这些字段，
// 故用 schema 默认值即可，色 / 相位一律经 `effects` 注入。
const layer = LayerSchema.parse({ id: "l1" })

/** 造一条 gradient 效果。 */
function gradient(params: Partial<GradientParams> = {}): Effect {
  return EffectSchema.parse({ kind: "gradient", id: "g", enabled: true, params }) as Effect
}

/** 造一条带色标的渐变效果（原 palette 已并入）。 */
function palette(colors: string[]): Effect {
  return EffectSchema.parse({
    kind: "gradient",
    id: "g",
    enabled: true,
    params: { colors },
  }) as Effect
}

/**
 * 以默认参数构造材质，只按需覆盖效果列表 / 祖先相关字段。
 *
 * 传入的 `effects` 会同时注入 `layer.effects` 与顶层 `effects`：真实调用方给两者传的是同一份
 * 列表（`toUniforms` 读 `layer.effects` 取相位与 `hasHolo`，`toEffectUniforms` 读顶层 `effects`
 * 打包数组），若只注入一处就会测出与线上不一致的行为。
 */
function build(over: Partial<Parameters<typeof createLayerMaterial>[0]> = {}) {
  // 复制成可变数组：`Layer.effects` 是可变类型，而参数里的 `effects` 是只读视图。
  const effects: Effect[] = [...(over.effects ?? [])]
  return createLayerMaterial({
    layer: over.layer ?? { ...layer, effects },
    mask: null,
    ancestors: [],
    maskPlaceholder: placeholder,
    effects,
    inheritedMoire: [],
    aspect: 1,
    cornerRadius: 0.05,
    ...over,
  })
}

describe("createLayerMaterial", () => {
  it("调色板 uniform 是定长的 uColors / uStops，不再有 uColorCount", () => {
    const material = build({ effects: [palette(["#111111", "#222222"])] })
    const keys = Object.keys(material.uniforms)
    expect(keys).toContain("uColors")
    expect(keys).toContain("uStops")
    expect(keys).not.toContain("uColorCount")

    expect(material.uniforms.uColors.value).toHaveLength(MAX_PALETTE)
    expect(material.uniforms.uColors.value[0]).toBeInstanceOf(Color)
    expect(material.uniforms.uStops.value).toHaveLength(MAX_PALETTE)
    // 位置升序且用末项补齐（0 / 1 → 1 重复）。两色等距展开是 CSS 默认的 0 / 100%。
    expect(material.uniforms.uStops.value).toEqual([0, 1, 1, 1, 1, 1, 1, 1])
  })

  it("调色板透明度与颜色等长，随色标写入", () => {
    const material = build({ effects: [palette(["#11111100", "#222222ff"])] })
    expect(material.uniforms.uColorAlphas.value).toHaveLength(MAX_PALETTE)
    expect(material.uniforms.uColorAlphas.value[0]).toBe(0)
    expect(material.uniforms.uColorAlphas.value[1]).toBe(1)
  })

  it("空 colors 的 uStops 以默认色标作占位（不会被采样，见下面的 uHasHolo）", () => {
    const material = build({ effects: [palette([])] })
    expect(material.uniforms.uStops.value).toEqual([
      0,
      0.5,
      1,
      1,
      1,
      1,
      1,
      1,
    ])
  })

  // 空色板 = 纯蒙版：材质把 uHasHolo 置 0，片元据此把本层 alpha 归零（它自己不出图，
  // 但仍作为祖先以其蒙版裁切子树）。名字接错了类型也看不出来，症状是「纯蒙版层照样满屏全息」。
  it("把 colors 是否为空接线到 uHasHolo", () => {
    expect(build().uniforms.uHasHolo.value).toBe(0)
    expect(build({ effects: [palette(["#111111"])] }).uniforms.uHasHolo.value).toBe(1)
  })

  it("没有调色板时，颜色类效果不会把 uHasHolo 打开（箔只认调色板）", () => {
    const gloss = EffectSchema.parse({ kind: "gloss", id: "g", enabled: true, params: {} }) as Effect
    expect(build({ effects: [gloss] }).uniforms.uHasHolo.value).toBe(0)
    const grid = EffectSchema.parse({
      kind: "holoGrid",
      id: "l",
      enabled: true,
      params: {},
    }) as Effect
    expect(build({ effects: [grid] }).uniforms.uHasHolo.value).toBe(0)
  })

  // 内容浮雕只认本层自有的摩尔纹：从卡面继承来的那份是给全息相位和光带切带用的，
  // 若也算进浮雕，整张卡的花纹会被压到每一张图片 / 文字图层上。
  it("uOwnMoireCount 只数本层自有的摩尔纹", () => {
    const moire = (id: string, enabled = true) =>
      EffectSchema.parse({ kind: "moire", id, enabled, params: {} }) as Effect
    expect(build().uniforms.uOwnMoireCount.value).toBe(0)
    expect(build({ inheritedMoire: [moire("fm")] }).uniforms.uOwnMoireCount.value).toBe(0)
    expect(build({ effects: [moire("m")] }).uniforms.uOwnMoireCount.value).toBe(1)
    expect(build({ effects: [moire("m2", false)] }).uniforms.uOwnMoireCount.value).toBe(0)
  })

  // 钉的正是本文件开头说的那类接缝：着色器声明了 uNoiseStrength、材质却忘了接线时，
  // 类型层面完全看不出来，症状是滑块拖了没有反应。
  it("把 noiseStrength 接线到 uNoiseStrength", () => {
    const material = build({ effects: [gradient({ noiseStrength: 0.25 })] })
    expect(material.uniforms.uNoiseStrength.value).toBe(0.25)
  })

  // 同一条缝：着色器声明了 uTransition、材质忘了接线时类型上完全看不出来，
  // 症状是「拖了过渡宽度滑块，色带边缘不变」。
  it("把 transition 接线到 uTransition（缺省 1）", () => {
    expect(build().uniforms.uTransition.value).toBe(1)
    expect(build({ effects: [gradient({ transition: 0.3 })] }).uniforms.uTransition.value).toBe(0.3)
  })

  // 时间项：不传 time 时恒 0——实时预览逐像素维持原观感；离屏导出按帧传 time，全息才流动。
  it("把 time 接线到 uTime（缺省 0）", () => {
    expect(build().uniforms.uTime.value).toBe(0)
    expect(build({ time: 1.25 }).uniforms.uTime.value).toBe(1.25)
  })

  // 同一条缝的另一处：着色器声明了 uOffset、材质忘了接线时类型上完全看不出来，
  // 症状是「拖了偏移滑块，画面不动」。
  it("把 offsetX / offsetY 接线到 uOffset（Vector2）", () => {
    const material = build({ effects: [gradient({ offsetX: -0.25, offsetY: 0.6 })] })
    expect(material.uniforms.uOffset.value.x).toBe(-0.25)
    expect(material.uniforms.uOffset.value.y).toBe(0.6)
  })

  // 祖先蒙版 uniform 必须定长（GLSL 数组长度编译期固定）：未使用的槽位也得填满。
  it("祖先蒙版 uniform 定长，未使用槽位填占位纹理且 hasMask=0", () => {
    const material = build()
    expect(material.uniforms.uAncestorMask.value).toHaveLength(MAX_NEST_DEPTH)
    expect(material.uniforms.uAncestorHasMask.value).toEqual([0, 0, 0, 0])
    expect(material.uniforms.uAncestorMask.value[0]).toBe(placeholder)
  })

  it("祖先有蒙版时逐项接线 hasMask / 模式 / 反转 / 阈值", () => {
    const parent = LayerSchema.parse({
      id: "p",
      effects: [
        {
          kind: "imageMask",
          id: "im",
          params: { path: "m.png", mode: "fill", edge0: 0.2, edge1: 0.7, invert: true },
        },
      ],
    })
    const material = build({
      ancestors: [{ imageMask: resolveImageMask(parent.effects), mask: placeholder }],
    })
    expect(material.uniforms.uAncestorHasMask.value).toEqual([1, 0, 0, 0])
    // fill → 0；未使用槽位默认按 line（1）填。
    expect(material.uniforms.uAncestorMaskMode.value).toEqual([0, 1, 1, 1])
    expect(material.uniforms.uAncestorInvert.value).toEqual([1, 0, 0, 0])
    expect(material.uniforms.uAncestorEdge0.value).toEqual([0.2, 0, 0, 0])
    expect(material.uniforms.uAncestorEdge1.value).toEqual([0.7, 1, 1, 1])
    expect(material.uniforms.uAncestorMask.value[0]).toBe(placeholder)
  })

  // 祖先蒙版的位移 / 缩放 / 旋转逐槽接线：漏了这一段，症状是「父层的蒙版挪了，子层的裁切还
  // 停在老位置」——只有带嵌套图层的系列才看得见。未使用槽位取恒等（hasMask=0 时不参与计算）。
  it("祖先蒙版的位移 / 缩放 / 旋转逐槽接线，未使用槽位取恒等", () => {
    const parent = LayerSchema.parse({
      id: "p",
      effects: [
        {
          kind: "imageMask",
          id: "im",
          // 显式拉伸：本组只验位移 / 缩放 / 旋转的接线，尺寸不掺填充方式的等比换算。
          params: { path: "m.png", x: 0.1, y: -0.2, scale: 2, rotation: 90, fit: "stretch" },
        },
      ],
    })
    const material = build({
      aspect: 0.5,
      ancestors: [{ imageMask: resolveImageMask(parent.effects), mask: placeholder }],
    })
    expect(material.uniforms.uAncestorCenter.value[0].x).toBeCloseTo(0.1)
    expect(material.uniforms.uAncestorCenter.value[0].y).toBeCloseTo(-0.2)
    expect(material.uniforms.uAncestorSize.value[0].x).toBeCloseTo(1) // 0.5 × 2
    expect(material.uniforms.uAncestorSize.value[0].y).toBeCloseTo(2)
    expect(material.uniforms.uAncestorRotation.value[0]).toBeCloseTo(Math.PI / 2)
    // 未使用槽位：中心 0、铺满卡面、不旋转。
    expect(material.uniforms.uAncestorCenter.value[1].x).toBe(0)
    expect(material.uniforms.uAncestorSize.value[1].x).toBeCloseTo(0.5)
    expect(material.uniforms.uAncestorSize.value[1].y).toBeCloseTo(1)
    expect(material.uniforms.uAncestorRotation.value[1]).toBe(0)
  })

  it("祖先无蒙版时 hasMask=0（权重恒 1），即便提供了纹理", () => {
    const material = build({ ancestors: [{ imageMask: null, mask: placeholder }] })
    expect(material.uniforms.uAncestorHasMask.value).toEqual([0, 0, 0, 0])
  })

  // 光泽蒙版：祖先的「作为蒙版」光泽按「槽位 × 条序」展平接线。名字或下标对不上时，子图层
  // 的裁切窗口会静默消失（整层全露或全不露），而类型层面毫无提示。
  it("祖先的光泽蒙版逐槽接线（槽位 × 条序展平）", () => {
    const parentGloss = EffectSchema.parse({
      kind: "gloss",
      id: "gm",
      params: {
        mode: "radial",
        count: 3,
        spacing: 0.4,
        width: 0.1,
        angle: 45,
        twist: 0.2,
        twistSeed: 7,
        asMask: true,
        offsetX: 0.15,
        offsetY: -0.25,
      },
    }) as Extract<Effect, { kind: "gloss" }>
    const glossMasks = [parentGloss.params]
    const material = build({
      ancestors: [
        { imageMask: null, mask: placeholder },
        { imageMask: null, mask: placeholder, glossMasks },
      ],
    })
    expect(material.uniforms.uAncestorGlossCount.value).toEqual([0, 1, 0, 0])
    // 第二个祖先槽位的首条 = 展平下标 2。
    expect(material.uniforms.uAncestorGlossMode.value[2]).toBe(1) // radial
    expect(material.uniforms.uAncestorGlossBands.value[2]).toBe(3)
    expect(material.uniforms.uAncestorGlossSpacing.value[2]).toBeCloseTo(0.4)
    expect(material.uniforms.uAncestorGlossWidth.value[2]).toBeCloseTo(0.1)
    expect(material.uniforms.uAncestorGlossAngle.value[2]).toBe(45)
    expect(material.uniforms.uAncestorGlossTwist.value[2]).toBeCloseTo(0.2)
    expect(material.uniforms.uAncestorGlossTwistSeed.value[2]).toBe(7)
    expect(material.uniforms.uAncestorGlossOffsetX.value[2]).toBeCloseTo(0.15)
    expect(material.uniforms.uAncestorGlossOffsetY.value[2]).toBeCloseTo(-0.25)
    // 未使用槽位全 0；数组长度 = MAX_NEST_DEPTH × GLOSS_MAX。
    expect(material.uniforms.uAncestorGlossMode.value[0]).toBe(0)
    expect(material.uniforms.uAncestorGlossMode.value).toHaveLength(MAX_NEST_DEPTH * 2)
    expect(material.uniforms.uAncestorGlossOffsetX.value).toHaveLength(MAX_NEST_DEPTH * 2)
  })

  // 本层自己的图蒙版走另一条接线路径：祖先那组由 `ancestors` 驱动，本层这组由自身 `effects`
  // 经 `resolveImageMask` 解析。只测祖先就漏掉了本层这一条，漏接的症状同样是「蒙版静默不生效」。
  it("本层 imageMask 接线到 uHasMask / 模式 / 反转 / 阈值", () => {
    const effects = [
      EffectSchema.parse({
        kind: "imageMask",
        id: "im",
        params: { path: "m.png", mode: "fill", edge0: 0.2, edge1: 0.7, invert: true },
      }),
    ]
    const m = build({ effects, mask: placeholder })
    expect(m.uniforms.uHasMask.value).toBe(1)
    expect(m.uniforms.uMaskMode.value).toBe(0)
    expect(m.uniforms.uMaskInvert.value).toBe(1)
    expect(m.uniforms.uLineEdge0.value).toBe(0.2)
    expect(m.uniforms.uLineEdge1.value).toBe(0.7)
  })

  // 本层图蒙版的位移 / 缩放 / 旋转接线三个 uniform：名字对不上时滑块拖了画面不动；
  // 默认若是错的，旧系列的孔洞会整体偏移 / 缩小。
  it("本层图蒙版的位移 / 缩放 / 旋转接线到 uMaskCenter / uMaskSize / uMaskRotation", () => {
    const effects = [
      EffectSchema.parse({
        kind: "imageMask",
        id: "im",
        // 显式拉伸：本组只验位移 / 缩放 / 旋转的接线，尺寸不掺填充方式的等比换算。
        params: { path: "m.png", x: 0.1, y: -0.2, scale: 2, rotation: 90, fit: "stretch" },
      }),
    ]
    const m = build({ aspect: 0.5, effects, mask: placeholder })
    expect(m.uniforms.uMaskCenter.value.x).toBeCloseTo(0.1)
    expect(m.uniforms.uMaskCenter.value.y).toBeCloseTo(-0.2)
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(1) // 0.5 × 2
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(2)
    expect(m.uniforms.uMaskRotation.value).toBeCloseTo(Math.PI / 2)
  })

  // 填充方式靠蒙版纹理的自然比例换算：漏传纹理比例时 cover / contain 会静默退化成拉伸。
  it("本层蒙版填充方式为覆盖时按蒙版图比例换算 uMaskSize", () => {
    const effects = [
      EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "m.png", fit: "cover" } }),
    ]
    const m = build({ aspect: 0.5, effects, mask: imageTexture })
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(2)
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(1)
  })

  it("祖先蒙版的填充方式逐槽接线（覆盖按该祖先的蒙版图比例）", () => {
    const parent = LayerSchema.parse({
      id: "p",
      effects: [
        { kind: "imageMask", id: "im", params: { path: "m.png", fit: "cover" } },
      ],
    })
    const material = build({
      aspect: 0.5,
      ancestors: [{ imageMask: resolveImageMask(parent.effects), mask: imageTexture }],
    })
    expect(material.uniforms.uAncestorSize.value[0].x).toBeCloseTo(2)
    expect(material.uniforms.uAncestorSize.value[0].y).toBeCloseTo(1)
  })

  // path 为空的 imageMask 是「已添加但还没选图」的中间态：不该当作有蒙版——否则会去采一张不存在
  // 的纹理，整层可能消失。这一条钉住 hasMask 判定里「path 非空」那一半（见 mapping.maskIsActive）。
  it("本层 imageMask 的 path 为空时 uHasMask=0", () => {
    const effects = [EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "" } })]
    expect(build({ effects }).uniforms.uHasMask.value).toBe(0)
  })

  // 效果栈走同一条接缝：着色器声明了 uGradient*，材质忘了把效果列表打成数组时类型上完全
  // 看不出来，症状是「改了渐变空间，全息相位纹丝不动」。数组 uniform 里 0 是「无此条」，
  // 故断言都带下标。这里钉住 mode 的枚举 → 整型码（radial = 1）与其余各字段的逐条接线。
  it("把 gradient 效果接线到 uGradient* 数组", () => {
    const effects = [
      EffectSchema.parse({
        kind: "gradient",
        id: "g",
        params: { mode: "radial", count: 7, angle: 90, twist: 0.3 },
      }),
    ]
    const material = build({ effects, inheritedMoire: [] })
    expect(material.uniforms.uGradientCount.value).toBe(1)
    expect(material.uniforms.uGradientMode.value[0]).toBe(1)
    expect(material.uniforms.uGradientDensity.value[0]).toBe(7)
    expect(material.uniforms.uGradientAngle.value[0]).toBe(90)
    expect(material.uniforms.uGradientTwist.value[0]).toBe(0.3)
  })

  // 射线（rays）是后加的第三种取值：钉住它也走同一条 patternModeCode 映射（rays = 2）。
  it("渐变空间为射线时 uGradientMode = 2", () => {
    const effects = [EffectSchema.parse({ kind: "gradient", id: "g", params: { mode: "rays" } })]
    expect(build({ effects }).uniforms.uGradientMode.value[0]).toBe(2)
  })

  // 摩尔纹是卡面级参数，透传进图层材质以驱动折射相位——但它现在走「继承」这条通路：
  // 本层不带 moire 时整体取 inheritedMoire。这里钉继承生效，且 mode 折成整型码（rays = 2）。
  it("本层无 moire 时继承卡面的 moire（uMoireMode 取整型码）", () => {
    const inheritedMoire = [
      EffectSchema.parse({ kind: "moire", id: "m", params: { mode: "rays" } }),
    ]
    const material = build({ effects: [], inheritedMoire })
    expect(material.uniforms.uMoireCount.value).toBe(1)
    expect(material.uniforms.uMoireMode.value[0]).toBe(2)
  })

  // 「本层自带 moire 时以本层为准」是继承规则的另一半：inherit 只在**本层为空**时生效。
  // 写反了症状是「图层自己的摩尔纹怎么调都没反应」，故两侧给不同 mode 才看得出来。
  it("本层自带 moire 时压过继承的卡面 moire", () => {
    const effects = [EffectSchema.parse({ kind: "moire", id: "own", params: { mode: "parallel" } })]
    const inheritedMoire = [
      EffectSchema.parse({ kind: "moire", id: "m", params: { mode: "rays" } }),
    ]
    const material = build({ effects, inheritedMoire })
    expect(material.uniforms.uMoireCount.value).toBe(1)
    expect(material.uniforms.uMoireMode.value[0]).toBe(0)
  })

  // 内置蒙版也走同一条接缝：着色器声明了 uMaskPreset*，材质忘了接线时类型上完全看不出来，
  // 症状是「选了预设 / 拖了密度，画面不动」。着色器现在按 uMaskPresetCount 门控（不再读
  // uHasMaskPreset），故这里首要钉住计数。
  it("把 maskPreset 效果接线到 uMaskPreset* 数组", () => {
    const effects = [
      EffectSchema.parse({
        kind: "maskPreset",
        id: "mp",
        params: {
          id: "polygon",
          sides: 5,
          spike: 0.4,
          irregular: 0.6,
          equilateral: true,
          density: 12,
          size: 0.08,
          sizeJitter: 0.5,
          arrangement: "regular",
          softness: 0.03,
          seed: 7,
          offsetX: 0.1,
          offsetY: -0.2,
          flipX: true,
          flipY: false,
          rotation: 45,
          invert: false,
        },
      }),
    ]
    const m = build({ effects })
    expect(m.uniforms.uMaskPresetCount.value).toBe(1)
    expect(m.uniforms.uMaskPresetSides.value[0]).toBe(5)
    expect(m.uniforms.uMaskPresetSpike.value[0]).toBe(0.4)
    expect(m.uniforms.uMaskPresetIrregular.value[0]).toBe(0.6)
    // 布尔在注册表这一层折成 0/1（着色器只认浮点）。翻 / 不翻各钉一个，折反了才看得出来。
    expect(m.uniforms.uMaskPresetEquilateral.value[0]).toBe(1)
    expect(m.uniforms.uMaskPresetFlipX.value[0]).toBe(1)
    expect(m.uniforms.uMaskPresetFlipY.value[0]).toBe(0)
    expect(m.uniforms.uMaskPresetInvert.value[0]).toBe(0)
    expect(m.uniforms.uMaskPresetRotation.value[0]).toBe(45)
    expect(m.uniforms.uMaskPresetDensity.value[0]).toBe(12)
    expect(m.uniforms.uMaskPresetSize.value[0]).toBe(0.08)
    expect(m.uniforms.uMaskPresetSizeJitter.value[0]).toBe(0.5)
    expect(m.uniforms.uMaskPresetSoftness.value[0]).toBe(0.03)
    expect(m.uniforms.uMaskPresetSeed.value[0]).toBe(7)
    // 位移是 vec2：转成 Vector2 后逐分量断言。
    expect(m.uniforms.uMaskPresetOffset.value[0].x).toBe(0.1)
    expect(m.uniforms.uMaskPresetOffset.value[0].y).toBe(-0.2)
    // 枚举在注册表这一层折成 0/1（着色器只认浮点）：规则排布 = 0。
    expect(m.uniforms.uMaskPresetArrangement.value[0]).toBe(0)
  })

  // 「默认外观 == 改动前」的另一半：排布默认 random，必须折成 1（着色器里 1 = 不归零）。
  // 折反了症状是「所有存量系列的碎片都从散着摆变成排成阵列」，而测试若只钉 0 就看不出来。
  it("排布为 random 时 uMaskPresetArrangement 为 1", () => {
    const effects = [
      EffectSchema.parse({ kind: "maskPreset", id: "mp", params: { id: "polygon" } }),
    ]
    expect(build({ effects }).uniforms.uMaskPresetArrangement.value[0]).toBe(1)
  })

  // 默认（无 maskPreset 效果）：这是「默认外观 == 改动前」的接线保证。
  it("无 maskPreset 效果时 uMaskPresetCount 为 0", () => {
    expect(build().uniforms.uMaskPresetCount.value).toBe(0)
  })

  // 新模型里 enabled 挂在**条目**上，pick() 直接丢弃 disabled 的条目——所以关闭是「整条不
  // 参与」，而非旧的「depth 归零」。两半都要钉：关掉 → 计数为 0；开启 → depth 原样透传。
  it("moire 条目 enabled=false 时整条被丢弃；enabled=true 时透传 depth", () => {
    const off = build({
      effects: [
        EffectSchema.parse({ kind: "moire", id: "m", enabled: false, params: { depth: 0.5 } }),
      ],
    })
    expect(off.uniforms.uMoireCount.value).toBe(0)

    const on = build({
      effects: [EffectSchema.parse({ kind: "moire", id: "m", params: { depth: 0.5 } })],
    })
    expect(on.uniforms.uMoireCount.value).toBe(1)
    expect(on.uniforms.uMoireDepth.value[0]).toBe(0.5)
  })

  // 图片走材质侧的专用接线（与 imageMask 同型）：没有图时 sampler 必须绑占位纹理、
  // uHasImage 置 0，否则会去采一张不存在的纹理，整层可能消失。
  it("无图片时 uHasImage = 0，sampler 绑占位纹理", () => {
    const m = build()
    expect(m.uniforms.uHasImage.value).toBe(0)
    expect(m.uniforms.uImage.value).toBe(placeholder)
  })

  it("有图片时按纹理宽高比与 scale 计算 uImageSize，并接线中心 / 旋转", () => {
    const effect = image({ path: "assets/pic.png", x: 0.1, y: -0.2, rotation: 90, scale: 2 })
    const m = build({
      effects: [effect],
      image: { texture: imageTexture, params: effect.params as ImageParams },
    })
    expect(m.uniforms.uHasImage.value).toBe(1)
    expect(m.uniforms.uImage.value).toBe(imageTexture)
    // aspect = 1、纹理 2:1 → 基准 (1, 0.5)；scale = 2 → (2, 1)。
    expect((m.uniforms.uImageSize.value as Vector2).x).toBeCloseTo(2)
    expect((m.uniforms.uImageSize.value as Vector2).y).toBeCloseTo(1)
    expect((m.uniforms.uImageCenter.value as Vector2).x).toBeCloseTo(0.1)
    expect((m.uniforms.uImageCenter.value as Vector2).y).toBeCloseTo(-0.2)
    expect(m.uniforms.uImageRotation.value).toBeCloseTo(Math.PI / 2)
  })

  // 尺寸换算必须吃调用方给的卡面宽高比：build() 默认 aspect = 1，若材质里写死 1 也照样通过，
  // 故这里用真实卡面比例（2.5 / 3.5）再断言一次。
  it("尺寸换算用图层实际的卡面宽高比（非单位 aspect）", () => {
    const effect = image()
    const m = build({
      aspect: CARD_ASPECT,
      effects: [effect],
      image: { texture: imageTexture, params: effect.params as ImageParams },
    })
    // 纹理 2:1、卡面 A = 2.5/3.5 → 基准 (A, A/2)；误用固定 1 会得到 (0.5, 0.5)。
    expect((m.uniforms.uImageSize.value as Vector2).x).toBeCloseTo(CARD_ASPECT)
    expect((m.uniforms.uImageSize.value as Vector2).y).toBeCloseTo(CARD_ASPECT / 2)
  })

  // 填充方式与卡面底图共用 fitSpan：cover 溢满卡面、stretch 拉伸、contain 完整可见。
  // 缺省 contain 与加 fit 之前的 fitImageSize 逐值相同——存量图层图片不因新字段变形。
  it("图片的填充方式走 fitSpan：cover 铺满、stretch 拉伸", () => {
    const sizeFor = (fit: "cover" | "contain" | "stretch") => {
      const effect = image({ path: "assets/pic.png", fit })
      const m = build({
        aspect: CARD_ASPECT,
        effects: [effect],
        image: { texture: imageTexture, params: effect.params as ImageParams },
      })
      const v = m.uniforms.uImageSize.value as Vector2
      return [v.x, v.y]
    }
    // 纹理 2:1、卡面 A = 2.5/3.5：contain → (A, A/2)；cover → 高度顶满 (2, 1)；
    // stretch → 正好铺满卡面 (A, 1)。
    expect(sizeFor("contain")[0]).toBeCloseTo(CARD_ASPECT)
    expect(sizeFor("contain")[1]).toBeCloseTo(CARD_ASPECT / 2)
    expect(sizeFor("cover")[0]).toBeCloseTo(2)
    expect(sizeFor("cover")[1]).toBeCloseTo(1)
    expect(sizeFor("stretch")[0]).toBeCloseTo(CARD_ASPECT)
    expect(sizeFor("stretch")[1]).toBeCloseTo(1)
  })

  it("图片纹理缺 image 尺寸时按方图兜底", () => {
    // 以基类 Texture 标注：它的 image 是 any，才能直接覆盖（DataTexture 把它收窄成 TextureImageData）。
    const bare: Texture = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat)
    // 抹掉尺寸信息，模拟非常规纹理来源（`Texture.image` 为 any，可直接覆盖）。
    bare.image = {}
    const effect = image()
    const m = build({
      effects: [effect],
      image: { texture: bare, params: effect.params as ImageParams },
    })
    // 方图 + aspect 1 → (1, 1)。
    expect((m.uniforms.uImageSize.value as Vector2).x).toBeCloseTo(1)
    expect((m.uniforms.uImageSize.value as Vector2).y).toBeCloseTo(1)
  })
})

describe("createLayerMaterial 颜色源蒙版", () => {
  /** 造一条颜色源 imageMask。 */
  const colorMask = (params: Record<string, unknown> = {}) =>
    EffectSchema.parse({
      kind: "imageMask",
      id: "im",
      params: { source: "color", color: "#1a2b3c", ...params },
    })

  // 颜色源改采卡面原图（uFrontMap）并按颜色距离取权重。三个 uniform 任一接错，
  // 症状都是「切到颜色源后蒙版整片不生效，且没有任何报错」。
  it("本层颜色源接线 uFrontMap / uMaskSource / uMaskColor", () => {
    const m = build({ effects: [colorMask()], front: imageTexture })
    expect(m.uniforms.uFrontMap.value).toBe(imageTexture)
    expect(m.uniforms.uMaskSource.value).toBe(1)
    expect(m.uniforms.uMaskColor.value.equals(new Color("#1a2b3c"))).toBe(true)
    expect(m.uniforms.uHasMask.value).toBe(1)
  })

  // 颜色源的「蒙版图」就是卡面原图：填充方式按原图比例换算（漏了这条，覆盖 / 适应静默变拉伸）。
  it("本层颜色源的蒙版尺寸按卡面原图比例换算", () => {
    const m = build({ aspect: 0.5, effects: [colorMask({ fit: "cover" })], front: imageTexture })
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(2)
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(1)
  })

  // 无卡面原图时颜色源无从采样：hasMask 归零（否则去采占位纹理，整卡被静默裁掉）。
  it("颜色源但无卡面原图时 uHasMask = 0", () => {
    expect(build({ effects: [colorMask()] }).uniforms.uHasMask.value).toBe(0)
  })

  // 祖先若是颜色蒙版，裁切也必须按颜色距离算：来源与拾取色逐槽接线，未使用槽位取图片源。
  it("祖先颜色源逐槽接线 uAncestorSource / uAncestorColor", () => {
    const parent = LayerSchema.parse({
      id: "p",
      effects: [colorMask({ color: "#102030" })],
    })
    const m = build({
      ancestors: [{ imageMask: resolveImageMask(parent.effects), mask: null }],
      front: imageTexture,
    })
    expect(m.uniforms.uAncestorHasMask.value).toEqual([1, 0, 0, 0])
    expect(m.uniforms.uAncestorSource.value).toEqual([1, 0, 0, 0])
    expect(m.uniforms.uAncestorColor.value[0].equals(new Color("#102030"))).toBe(true)
    // 未使用槽位：图片源 + 默认灰（hasMask=0 时不参与计算）。
    expect(m.uniforms.uAncestorColor.value[1].equals(new Color("#808080"))).toBe(true)
  })

  // 祖先颜色源同样以卡面原图比例为「蒙版图」比例，且无原图时该祖先不裁切。
  it("祖先颜色源按原图比例换算尺寸；无原图时不裁切", () => {
    const parent = LayerSchema.parse({
      id: "p",
      effects: [colorMask({ fit: "cover" })],
    })
    const withFront = build({
      aspect: 0.5,
      ancestors: [{ imageMask: resolveImageMask(parent.effects), mask: null }],
      front: imageTexture,
    })
    expect(withFront.uniforms.uAncestorSize.value[0].x).toBeCloseTo(2)
    expect(withFront.uniforms.uAncestorSize.value[0].y).toBeCloseTo(1)

    const noFront = build({
      ancestors: [{ imageMask: resolveImageMask(parent.effects), mask: null }],
    })
    expect(noFront.uniforms.uAncestorHasMask.value).toEqual([0, 0, 0, 0])
  })
})

describe("createLayerMaterial 蒙版擦除", () => {
  it("layerErase 绑到 uLayerEraseMap", () => {
    const own = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
    const m = build({ layerErase: own })
    expect(m.uniforms.uHasLayerErase.value).toBe(1)
    expect(m.uniforms.uLayerEraseMap.value).toBe(own)
  })

  it("没传本层擦除图时 uHasLayerErase = 0（占位绑定不参与采样）", () => {
    expect(build().uniforms.uHasLayerErase.value).toBe(0)
  })

  // 擦除向下继承：祖先各自的擦除图逐槽位绑入，未使用的槽位 hasErase = 0（权重恒为 1）。
  it("祖先擦除逐槽位绑入，未使用槽位为 0", () => {
    const parentErase = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat)
    const m = build({
      ancestors: [{ imageMask: null, mask: null, erase: parentErase }],
    })
    expect(m.uniforms.uAncestorHasErase.value).toEqual([1, 0, 0, 0])
    expect(m.uniforms.uAncestorEraseMap.value[0]).toBe(parentErase)
    expect(m.uniforms.uAncestorEraseMap.value[1]).toBe(placeholder)
  })

  // 辅助底色默认关：不传参数时输出与正常浏览逐像素一致（导出走的是未开的那条路）。
  it("erasePreview 默认 0，传 true 才为 1", () => {
    expect(build().uniforms.uErasePreview.value).toBe(0)
    expect(build({ erasePreview: true }).uniforms.uErasePreview.value).toBe(1)
  })
})

describe("文字纹理与祖先文字蒙版", () => {
  const textTexture = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat)

  function textLayer(asMask: boolean) {
    return LayerSchema.parse({ id: "t1", kind: "text", text: { content: "AB", asMask } })
  }

  it("文字层：uHasText = 1、uTextMap 绑本层纹理", () => {
    const mat = build({ layer: textLayer(false), text: textTexture })
    expect(mat.uniforms.uHasText.value).toBe(1)
    expect(mat.uniforms.uTextMap.value).toBe(textTexture)
    expect(mat.uniforms.uTextAsMask.value).toBe(0)
  })

  it("没有文字纹理：uHasText = 0，绑占位纹理", () => {
    const mat = build()
    expect(mat.uniforms.uHasText.value).toBe(0)
    expect(mat.uniforms.uTextMap.value).toBe(placeholder)
  })

  it("uTextAsMask 只由 layer.text.asMask 决定", () => {
    const mat = build({ layer: textLayer(true), text: textTexture })
    expect(mat.uniforms.uTextAsMask.value).toBe(1)
  })

  // 文字蒙版复用图蒙版的采样槽位（片元纹理单元只有 16 个），靠 maskKind 区分取值口径。
  it("祖先的 textMask 复用 uAncestorMask 槽位，maskKind = 1；未提供的槽位 kind = 0", () => {
    const mat = build({
      ancestors: [{ imageMask: null, mask: null, textMask: textTexture }],
    })
    expect(mat.uniforms.uAncestorHasMask.value[0]).toBe(1)
    expect(mat.uniforms.uAncestorMask.value[0]).toBe(textTexture)
    expect(mat.uniforms.uAncestorMaskKind.value[0]).toBe(1)
    expect(mat.uniforms.uAncestorHasMask.value[1]).toBe(0)
    expect(mat.uniforms.uAncestorMask.value[1]).toBe(placeholder)
    expect(mat.uniforms.uAncestorMaskKind.value[1]).toBe(0)
  })
})

describe("createLayerMaterial 的法线（bump）绑定", () => {
  const bumpFace = ImageParamsSchema.parse({
    bumpStrength: 0.8,
    bumpDetail: 0.03,
    bumpFlow: 0.2,
    bumpLight: 0.5,
    bumpLightAngle: -15,
    bumpLightColor: "#88ccff",
    bumpInvert: true,
    fit: "cover",
    scale: 2,
    rotation: 90,
  })

  it("默认 uBumpSource = 0（关）", () => {
    const m = build()
    expect(m.uniforms.uBumpSource.value).toBe(0)
    expect(m.uniforms.uBumpStrength.value).toBe(0)
  })

  it("图片自带法线时来源 1，各项参数取自 image 效果", () => {
    const params = ImageParamsSchema.parse({
      bumpStrength: 0.6,
      bumpDetail: 0.02,
      bumpFlow: 0.4,
      bumpLight: 0.3,
      bumpLightAngle: 60,
      bumpLightColor: "#ff8800",
      bumpInvert: true,
    })
    const m = build({ image: { texture: imageTexture, params } })
    expect(m.uniforms.uBumpSource.value).toBe(1)
    expect(m.uniforms.uBumpStrength.value).toBeCloseTo(0.6)
    expect(m.uniforms.uBumpDetail.value).toBeCloseTo(0.02)
    expect(m.uniforms.uBumpFlow.value).toBeCloseTo(0.4)
    expect(m.uniforms.uBumpLight.value).toBeCloseTo(0.3)
    expect(m.uniforms.uBumpLightAngle.value).toBeCloseTo(60)
    expect(m.uniforms.uBumpLightColor.value.equals(new Color("#ff8800"))).toBe(true)
    expect(m.uniforms.uBumpInvert.value).toBe(1)
  })

  it("凹凸光颜色的 alpha 单独接线到 uBumpLightAlpha", () => {
    const params = ImageParamsSchema.parse({ bumpStrength: 0.6, bumpLightColor: "#ff880080" })
    const m = build({ image: { texture: imageTexture, params } })
    expect(m.uniforms.uBumpLightAlpha.value).toBeCloseTo(128 / 255, 10)
  })

  // 图片自带法线优先：即使卡面也开了，图层仍用自己的那份。
  it("图片法线与卡面法线同时在场时以图片为准，来源仍为 1", () => {
    const params = ImageParamsSchema.parse({ bumpStrength: 0.4 })
    const m = build({ image: { texture: imageTexture, params }, front: placeholder, face: bumpFace })
    expect(m.uniforms.uBumpSource.value).toBe(1)
    expect(m.uniforms.uBumpStrength.value).toBeCloseTo(0.4)
  })

  it("图层没有自己的法线时沿用卡面的，来源 2，并接上卡面底图的采样变换", () => {
    const m = build({ front: placeholder, face: bumpFace })
    expect(m.uniforms.uBumpSource.value).toBe(2)
    expect(m.uniforms.uBumpStrength.value).toBeCloseTo(0.8)
    expect(m.uniforms.uBumpDetail.value).toBeCloseTo(0.03)
    expect(m.uniforms.uBumpFlow.value).toBeCloseTo(0.2)
    expect(m.uniforms.uBumpLight.value).toBeCloseTo(0.5)
    expect(m.uniforms.uBumpLightAngle.value).toBeCloseTo(-15)
    expect(m.uniforms.uBumpLightColor.value.equals(new Color("#88ccff"))).toBe(true)
    expect(m.uniforms.uBumpInvert.value).toBe(1)
    // 卡面底图的填充 / 缩放 / 旋转要用自己的矩阵采样，否则继承来的法线会错位。
    expect(m.uniforms.uFaceMapMatrix.value).toBeInstanceOf(Vector4)
    expect(m.uniforms.uFaceMapOffset.value).toBeInstanceOf(Vector2)
    expect(m.uniforms.uFaceMapMatrix.value.x).toBeCloseTo(
      frontUvTransform({
        imageAspect: 1,
        cardAspect: 1,
        fit: "cover",
        offsetX: 0,
        offsetY: 0,
        scale: 2,
        rotation: 90,
      }).matrix[0],
    )
  })

  it("没有卡面图时即使卡面数据开了法线也不启用", () => {
    const m = build({ face: bumpFace })
    expect(m.uniforms.uBumpSource.value).toBe(0)
  })

  // 法线贴图与亮度伪法线共用同一个采样器，材质在构造期就决定绑哪张纹理——片元里不再选纹理，
  // 省掉一个纹理单元（图层片元只剩 15/16）。
  const normalTexture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat)

  it("默认走亮度通路、法线采样器绑占位纹理", () => {
    const m = build()
    expect(m.uniforms.uBumpMode.value).toBe(0)
    expect(m.uniforms.uBumpFlipY.value).toBe(0)
    expect(m.uniforms.uNormalMap.value).toBe(placeholder)
  })

  it("本层自带的法线贴图优先，来源 1、绑本层贴图、带上绿通道翻转", () => {
    const params = ImageParamsSchema.parse({
      bumpStrength: 0.5,
      normalPath: "assets/layer-n.png",
      normalFlipY: true,
    })
    const m = build({ image: { texture: imageTexture, params }, normal: normalTexture })
    expect(m.uniforms.uBumpSource.value).toBe(1)
    expect(m.uniforms.uBumpMode.value).toBe(1)
    expect(m.uniforms.uBumpFlipY.value).toBe(1)
    expect(m.uniforms.uNormalMap.value).toBe(normalTexture)
  })

  it("继承卡面的法线贴图时绑卡面贴图，来源 2", () => {
    const face = ImageParamsSchema.parse({
      bumpStrength: 0.8,
      normalPath: "assets/face-n.png",
    })
    const m = build({ front: placeholder, face, faceNormal: normalTexture })
    expect(m.uniforms.uBumpSource.value).toBe(2)
    expect(m.uniforms.uBumpMode.value).toBe(1)
    expect(m.uniforms.uNormalMap.value).toBe(normalTexture)
  })

  // 本层选了贴图、卡面也选了：本层胜出，采样器绝不能绑到卡面的那张上。
  it("本层与卡面都有法线贴图时绑本层的那张", () => {
    const face = ImageParamsSchema.parse({
      bumpStrength: 0.8,
      normalPath: "assets/face-n.png",
    })
    const params = ImageParamsSchema.parse({ bumpStrength: 0.5, normalPath: "assets/layer-n.png" })
    const other = new DataTexture(new Uint8Array([255, 128, 128, 255]), 1, 1, RGBAFormat)
    const m = build({
      image: { texture: imageTexture, params },
      normal: normalTexture,
      front: placeholder,
      face,
      faceNormal: other,
    })
    expect(m.uniforms.uBumpSource.value).toBe(1)
    expect(m.uniforms.uNormalMap.value).toBe(normalTexture)
  })
})

describe("createLayerMaterial 暗部颜色", () => {
  // 暗部颜色不是固定混合函数：片元按卡面原图亮度把色相铺进暗部、保留底图亮度，故混合走 normal。
  it("shadow 用 normal 混合，由 uShadowMode 打开片元合成", () => {
    const material = build({
      layer: LayerSchema.parse({ id: "l1", blend: "shadow" }),
      front: placeholder,
    })
    expect(material.blending).toBe(NormalBlending)
    expect(material.uniforms.uShadowMode.value).toBe(1)
    expect(material.uniforms.uHasFront.value).toBe(1)
  })

  it("shadow 没有卡面原图时 uHasFront=0，片元跳过暗部合成", () => {
    const material = build({ layer: LayerSchema.parse({ id: "l1", blend: "shadow" }) })
    expect(material.uniforms.uShadowMode.value).toBe(1)
    expect(material.uniforms.uHasFront.value).toBe(0)
  })

  it("其他混合模式 uShadowMode=0", () => {
    expect(build().uniforms.uShadowMode.value).toBe(0)
  })
})

describe("createLayerMaterial 调色板合成", () => {
  it("composite=tint 接线到 uPaletteComposite，并强制开箔", () => {
    const effect = EffectSchema.parse({
      kind: "gradient",
      id: "g",
      enabled: true,
      params: { colors: ["#111111"], composite: "tint" },
    }) as Effect
    const m = build({ effects: [effect] })
    expect(m.uniforms.uPaletteComposite.value).toBe(1)
    expect(m.uniforms.uHasHolo.value).toBe(1)
  })

  it("默认调色板合成是 0", () => {
    const m = build({ effects: [palette(["#111111"])] })
    expect(m.uniforms.uPaletteComposite.value).toBe(0)
  })
})

describe("createLayerMaterial 叠色参数", () => {
  it("叠色参数接到 uPalette* uniform，默认值不变", () => {
    const effect = EffectSchema.parse({
      kind: "gradient",
      id: "g",
      enabled: true,
      params: { colors: ["#111111"], composite: "tint", sat: 1.5 },
    }) as Effect
    const m = build({ effects: [effect] })
    expect(m.uniforms.uPaletteSat.value).toBe(1.5)
    expect(m.uniforms.uPaletteHue.value).toBe(0.036)
    expect(m.uniforms.uPaletteLift.value).toBe(0.4)
    expect(m.uniforms.uPaletteTint.value).toBe(1)
    expect(m.uniforms.uPaletteDeltaBase.value).toBe(0.2)
  })
})

describe("createLayerMaterial holoGrid", () => {
  it("holoGrid 接线到线族 uniform（count→families）与强度/偏移", () => {
    const effect = EffectSchema.parse({
      kind: "holoGrid",
      id: "g",
      enabled: true,
      params: {
        count: 6,
        angle: 30,
        density: 55,
        width: 0.4,
        strength: 0.8,
        offsetX: 0.1,
        offsetY: 0.2,
      },
    }) as Effect
    const m = build({ effects: [effect] })
    expect(m.uniforms.uHoloGridCount.value).toBe(1)
    expect(m.uniforms.uHoloGridFamilies.value[0]).toBe(6)
    expect(m.uniforms.uHoloGridAngle.value[0]).toBe(30)
    expect(m.uniforms.uHoloGridDensity.value[0]).toBe(55)
    expect(m.uniforms.uHoloGridWidth.value[0]).toBe(0.4)
    expect(m.uniforms.uHoloGridStrength.value[0]).toBe(0.8)
    expect(m.uniforms.uHoloGridOffsetX.value[0]).toBe(0.1)
    expect(m.uniforms.uHoloGridOffsetY.value[0]).toBe(0.2)
  })
})
