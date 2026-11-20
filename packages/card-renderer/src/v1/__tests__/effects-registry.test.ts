/**
 * 效果注册表 EFFECT_REGISTRY。
 *
 * 钉住三件事：每种 kind 的角色 / 槽位上限与设计一致（UI 分组与着色器定长数组都靠它）、
 * 默认值能被 schema 接受（新建效果不会写出非法参数）、字段与 uniform 打包的形状自洽
 * （UI 据此生成控件、渲染层据此传参）。三者任一漂移都会让「加一种效果」在别处静默出错。
 */
import { describe, it, expect } from "vitest"
import { EffectSchema } from "@cardbara/schema"
import {
  EFFECT_REGISTRY,
  EFFECT_KINDS,
  MOIRE_MAX,
  GRADIENT_MAX,
  LATTICE_MAX,
  GLOSS_MAX,
  MASK_PRESET_MAX,
  IMAGE_MASK_MAX,
  MASK_ERASE_MAX,
  IMAGE_MAX,
  PALETTE_MAX,
} from "../effects/registry"
import type { FieldDescriptor } from "../effects/registry"

describe("EFFECT_REGISTRY", () => {
  it("每种 kind 都有定义且 role 与设计一致", () => {
    expect(EFFECT_REGISTRY.gradient.role).toBe("phase")
    expect(EFFECT_REGISTRY.lattice.role).toBe("phase")
    expect(EFFECT_REGISTRY.moire.role).toBe("phase")
    expect(EFFECT_REGISTRY.gloss.role).toBe("color")
    expect(EFFECT_REGISTRY.holoGrid.role).toBe("color")
    expect(EFFECT_REGISTRY.maskPreset.role).toBe("alpha")
    expect(EFFECT_REGISTRY.imageMask.role).toBe("alpha")
  })

  it("maskErase 的角色为 alpha、scope 为 both（卡面整卡一张，图层各自一张）", () => {
    expect(EFFECT_REGISTRY.maskErase.role).toBe("alpha")
    expect(EFFECT_REGISTRY.maskErase.scope).toBe("both")
    expect(EFFECT_REGISTRY.maskErase.maxPerTarget).toBe(MASK_ERASE_MAX)
  })

  it("palette 的角色为 color", () => {
    expect(EFFECT_REGISTRY.palette.role).toBe("color")
  })

  it("image 的角色为 content、scope 为 layer（图片只挂在图层上）", () => {
    expect(EFFECT_REGISTRY.image.role).toBe("content")
    expect(EFFECT_REGISTRY.image.scope).toBe("layer")
  })

  it("EFFECT_KINDS 覆盖全部十种（含 image）", () => {
    expect([...EFFECT_KINDS].sort()).toEqual(
      [
        "gradient",
        "gloss",
        "holoGrid",
        "image",
        "imageMask",
        "lattice",
        "maskErase",
        "maskPreset",
        "moire",
        "palette",
      ].sort(),
    )
  })

  it("每个 kind 的 scope 与设计一致（scope 决定卡面菜单是否列出）", () => {
    const EXPECTED: Record<string, string> = {
      gradient: "layer",
      lattice: "layer",
      palette: "layer",
      holoGrid: "layer",
      moire: "both",
      gloss: "both",
      maskPreset: "both",
      imageMask: "both",
      maskErase: "both",
      image: "layer",
    }
    for (const kind of EFFECT_KINDS) expect(EFFECT_REGISTRY[kind].scope).toBe(EXPECTED[kind])
  })

  it("GRADIENT_MAX 收敛为 1（渐变每层一条）", () => {
    expect(GRADIENT_MAX).toBe(1)
    expect(EFFECT_REGISTRY.gradient.maxPerTarget).toBe(1)
  })

  it("palette 的槽位上限为 PALETTE_MAX", () => {
    expect(EFFECT_REGISTRY.palette.maxPerTarget).toBe(PALETTE_MAX)
  })

  it("image 的槽位上限为 IMAGE_MAX = 1", () => {
    expect(IMAGE_MAX).toBe(1)
    expect(EFFECT_REGISTRY.image.maxPerTarget).toBe(IMAGE_MAX)
  })

  it("槽位上限与着色器定长数组一致", () => {
    expect(EFFECT_REGISTRY.gradient.maxPerTarget).toBe(GRADIENT_MAX)
    expect(EFFECT_REGISTRY.lattice.maxPerTarget).toBe(LATTICE_MAX)
    expect(EFFECT_REGISTRY.moire.maxPerTarget).toBe(MOIRE_MAX)
    expect(EFFECT_REGISTRY.gloss.maxPerTarget).toBe(GLOSS_MAX)
    expect(EFFECT_REGISTRY.maskPreset.maxPerTarget).toBe(MASK_PRESET_MAX)
    expect(EFFECT_REGISTRY.imageMask.maxPerTarget).toBe(IMAGE_MASK_MAX)
  })

  it.each(EFFECT_KINDS)("%s 的 defaultParams() 能被 EffectSchema 接受且每次返回新对象", (kind) => {
    const def = EFFECT_REGISTRY[kind]
    const a = def.defaultParams()
    const b = def.defaultParams()
    expect(a).not.toBe(b)
    const parsed = EffectSchema.safeParse({ kind, id: "x", enabled: true, params: a })
    expect(parsed.success).toBe(true)
  })

  it("每种 kind 的 fields 非空且 key 不重复", () => {
    for (const kind of EFFECT_KINDS) {
      const keys = EFFECT_REGISTRY[kind].fields.map((f) => f.key)
      expect(keys.length).toBeGreaterThan(0)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  // 字段级 scope 的契约：moire 的卡面浮雕只作用于卡面片元，标 `face` 让图层面板隐去它。
  // 若哪天误删了这个标注，图层面板会重新冒出一个拖了没反应的滑块。
  it("moire.faceStrength 字段级 scope 为 face（图层上不显示）", () => {
    const field = EFFECT_REGISTRY.moire.fields.find((f) => f.key === "faceStrength")
    expect(field?.scope).toBe("face")
  })

  it("gradient 的字段含斜坡 4 项与相位全局 7 项（相位项从图层搬入后仍可在面板编辑）", () => {
    // twistSeed 紧随 twist：种子不是单独一档效果参数，而是 twist 的伴生量（换种子 = 换转法）。
    expect(EFFECT_REGISTRY.gradient.fields.map((f) => f.key)).toEqual([
      "mode",
      "count",
      "angle",
      "twist",
      "twistSeed",
      "distortionStrength",
      "phaseSpeed",
      "tiltGain",
      "noiseStrength",
      "transition",
      "offsetX",
      "offsetY",
      "straight",
    ])
  })

  it("gradient 的图案偏移滑块量程为 ±3（与 schema 一致，够把光环中心推出卡外）", () => {
    type SliderField = FieldDescriptor & { min: number; max: number; step: number }
    const byKey = Object.fromEntries(
      EFFECT_REGISTRY.gradient.fields.map((f) => [f.key, f as SliderField]),
    )
    expect([byKey.offsetX.min, byKey.offsetX.max, byKey.offsetX.step]).toEqual([-3, 3, 0.01])
    expect([byKey.offsetY.min, byKey.offsetY.max, byKey.offsetY.step]).toEqual([-3, 3, 0.01])
  })

  it("image 字段为 path + 跟随卡面 + 填充方式 + 四个变换滑块 + 法线贴图与四个法线控件，范围与 schema 一致", () => {
    type SliderField = FieldDescriptor & { min: number; max: number; step: number }
    const fields = EFFECT_REGISTRY.image.fields as readonly FieldDescriptor[]
    expect(fields.map((f) => f.key)).toEqual([
      "path",
      "followFront",
      "fit",
      "x",
      "y",
      "rotation",
      "scale",
      "normalPath",
      "normalFlipY",
      "bumpStrength",
      "bumpDetail",
      "bumpFlow",
      "bumpLight",
      "bumpLightAngle",
      "bumpLightColor",
      "bumpInvert",
    ])
    // 跟随卡面时下面几项不显示：写了也会被卡面值覆盖。
    const byVisible = Object.fromEntries(fields.map((f) => [f.key, f]))
    for (const key of ["fit", "x", "y", "rotation", "scale"]) {
      expect(byVisible[key].visibleWhen?.({ followFront: false })).toBe(true)
      expect(byVisible[key].visibleWhen?.({ followFront: true })).toBe(false)
    }
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f as SliderField]))
    expect([byKey.x.min, byKey.x.max, byKey.x.step]).toEqual([-1, 1, 0.01])
    expect([byKey.y.min, byKey.y.max, byKey.y.step]).toEqual([-1, 1, 0.01])
    expect([byKey.rotation.min, byKey.rotation.max, byKey.rotation.step]).toEqual([-180, 180, 1])
    expect([byKey.scale.min, byKey.scale.max, byKey.scale.step]).toEqual([0.1, 4, 0.01])
    // 法线：强度 / 细节 / 流向 / 光照与 schema 同量程（强度上限 10）；反转是开关。
    // 它们不随「跟随卡面」隐藏。
    expect([byKey.bumpStrength.min, byKey.bumpStrength.max, byKey.bumpStrength.step]).toEqual([0, 10, 0.01])
    expect([byKey.bumpDetail.min, byKey.bumpDetail.max, byKey.bumpDetail.step]).toEqual([
      0.001, 0.05, 0.001,
    ])
    // 法线贴图与底图亮度法线二选一：有贴图时「细节」（亮度取样步长）不起作用，故隐去；
    // 绿通道翻转只在选了贴图后才有意义。
    expect(byVisible.bumpDetail.visibleWhen?.({ normalPath: "" })).toBe(true)
    expect(byVisible.bumpDetail.visibleWhen?.({ normalPath: "assets/n.png" })).toBe(false)
    expect(byVisible.normalFlipY.visibleWhen?.({ normalPath: "" })).toBe(false)
    expect(byVisible.normalFlipY.visibleWhen?.({ normalPath: "assets/n.png" })).toBe(true)
    expect([byKey.bumpFlow.min, byKey.bumpFlow.max, byKey.bumpFlow.step]).toEqual([0, 1, 0.01])
    expect([byKey.bumpLight.min, byKey.bumpLight.max, byKey.bumpLight.step]).toEqual([0, 1, 0.01])
    expect([byKey.bumpLightAngle.min, byKey.bumpLightAngle.max, byKey.bumpLightAngle.step]).toEqual([
      -180, 180, 1,
    ])
    expect(byVisible.bumpLightAngle.precision).toBe(0)
    expect(byVisible.bumpLightColor.type).toBe("color")
    expect(byVisible.bumpInvert.type).toBe("switch")
  })

  it("packUniforms 产出全部数值或二元数组", () => {
    for (const kind of EFFECT_KINDS) {
      const def = EFFECT_REGISTRY[kind]
      const packed = def.packUniforms(def.defaultParams() as never)
      for (const v of Object.values(packed)) {
        const ok = typeof v === "number" || (Array.isArray(v) && v.length === 2)
        expect(ok).toBe(true)
      }
    }
  })

  it("gloss 的宽度上限 1、位移 ±1（与 schema 一致）", () => {
    type SliderField = FieldDescriptor & { min: number; max: number; step: number }
    const byKey = Object.fromEntries(
      (EFFECT_REGISTRY.gloss.fields as readonly FieldDescriptor[]).map((f) => [
        f.key,
        f as SliderField,
      ]),
    )
    expect([byKey.width.min, byKey.width.max]).toEqual([0.005, 1])
    expect([byKey.offsetX.min, byKey.offsetX.max, byKey.offsetX.step]).toEqual([-1, 1, 0.01])
    expect([byKey.offsetY.min, byKey.offsetY.max, byKey.offsetY.step]).toEqual([-1, 1, 0.01])
  })

  it("packUniforms 的键集与着色器 uniform 契约一致（Task 4 / 8 的依据）", () => {
    // 键名不必等于参数键名（如刻纹 count→families、光泽 count→bands）——这里钉的是
    // 消费方真正依赖的 uniform 键集合，改动它会静默改坏画面，故逐个写死。
    const EXPECTED: Record<string, readonly string[]> = {
      gradient: ["mode", "density", "angle", "twist", "twistSeed", "straight"],
      lattice: ["families", "angle", "density", "width", "strength", "offsetX", "offsetY"],
      moire: ["mode", "angle", "density", "depth", "twist", "twistSeed", "faceStrength"],
      gloss: [
        "mode",
        "bands",
        "spacing",
        "width",
        "angle",
        "twist",
        "twistSeed",
        "intensity",
        "asMask",
        "offsetX",
        "offsetY",
        "softness",
      ],
      maskPreset: [
        "sides",
        "spike",
        "irregular",
        "equilateral",
        "density",
        "size",
        "sizeJitter",
        "arrangement",
        "softness",
        "seed",
        "offset",
        "flipX",
        "flipY",
        "rotation",
        "invert",
      ],
      imageMask: [],
      maskErase: [],
      palette: [],
      holoGrid: ["size", "strength"],
      image: [],
    }
    for (const kind of EFFECT_KINDS) {
      const def = EFFECT_REGISTRY[kind]
      const packed = def.packUniforms(def.defaultParams() as never)
      expect(Object.keys(packed).sort()).toEqual([...EXPECTED[kind]].sort())
    }
  })

  it("labelKey 相对 effect 命名空间（不带命名空间前缀，与 MODE_OPTIONS 一致）", () => {
    // 消费方 useTranslation("effect") 后直接 t(labelKey)；带前缀会导致查不全、渲染出原始键名。
    for (const kind of EFFECT_KINDS) {
      const def = EFFECT_REGISTRY[kind]
      expect(def.labelKey.startsWith("effect.")).toBe(false)
      // 收窄成 FieldDescriptor[]：`as const` 下 fields 是字面量元组，只有部分成员带 options。
      const fields: readonly FieldDescriptor[] = def.fields
      for (const f of fields) {
        expect(f.labelKey.startsWith("effect.")).toBe(false)
        for (const o of f.options ?? []) expect(o.labelKey.startsWith("effect.")).toBe(false)
      }
    }
  })
})
