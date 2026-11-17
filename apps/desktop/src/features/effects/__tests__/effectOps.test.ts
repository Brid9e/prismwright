/**
 * 效果栈面板纯逻辑的行为钉桩。
 *
 * 分组与槽位这两件事看似「一眼就对」，却是面板最容易悄悄跑偏的地方：分组漏了空组，
 * 「＋ 添加效果」就整块消失；槽位上限抄错一档，用户点得进一个着色器装不下的条目。
 * 故用测试把两处的契约固定下来。
 */
import { describe, it, expect } from "vitest"
import type { Effect, EffectKind } from "@cardbara/schema"
import { EFFECT_REGISTRY, GRADIENT_MAX, MASK_PRESET_MAX, MASK_PRESETS } from "@cardbara/renderer/v1"
import {
  groupByRole,
  canAddKind,
  fieldsForScope,
  hasEnabledKind,
  imageTargetForEffect,
  maskSourcePatch,
  presetChangePatch,
  ROLE_ORDER,
} from "../effectOps"

/**
 * 造一个合法条目。kind 是运行时字符串，判别联合无法据此收窄，故用一次定向 cast——
 * 参数由注册表的 `defaultParams()` 给出，形状必与 kind 匹配，这里只是让 TS 相信这一点。
 */
function fx(kind: EffectKind, id: string, enabled = true): Effect {
  return { id, enabled, kind, params: EFFECT_REGISTRY[kind].defaultParams() } as Effect
}

describe("groupByRole", () => {
  it("按角色顺序返回，且空组也保留（UI 靠空组渲染添加入口）", () => {
    const groups = groupByRole([])
    expect(groups.map((g) => g.role)).toEqual([...ROLE_ORDER])
    expect(groups.every((g) => g.effects.length === 0)).toBe(true)
  })

  it("条目按角色落到对应组：渐变/刻纹/摩尔纹 → 相位，光泽 → 颜色，两类蒙版 → alpha", () => {
    const effects = [
      fx("gradient", "g"),
      fx("lattice", "l"),
      fx("moire", "m"),
      fx("gloss", "s"),
      fx("maskPreset", "p"),
      fx("imageMask", "im"),
    ]
    const byRole = Object.fromEntries(
      groupByRole(effects).map((g) => [g.role, g.effects.map((e) => e.kind)]),
    )

    expect(byRole.phase).toEqual(["gradient", "lattice", "moire"])
    expect(byRole.color).toEqual(["gloss"])
    // 程序化蒙版与图蒙版并列在 alpha 组，顺序按列表序。
    expect(byRole.alpha).toEqual(["maskPreset", "imageMask"])
  })

  it("图片落到 content 组，且 content 组排在相位组之前", () => {
    const effects = [fx("gradient", "g"), fx("image", "img")]
    const groups = groupByRole(effects)
    expect(groups.map((g) => g.role)).toEqual(["content", "phase", "color", "alpha"])
    expect(groups[0].effects.map((e) => e.kind)).toEqual(["image"])
  })

  it("组内保持列表序（两条渐变按插入先后出现）", () => {
    const phase = groupByRole([fx("gradient", "a"), fx("gradient", "b")]).find(
      (g) => g.role === "phase",
    )
    expect(phase?.effects.map((e) => e.id)).toEqual(["a", "b"])
  })
})

describe("canAddKind", () => {
  it("未达上限时可加", () => {
    expect(canAddKind([], "gradient")).toBe(true)
  })

  it("达到槽位上限后不可加（上限取自注册表）", () => {
    const full = Array.from({ length: GRADIENT_MAX }, (_, i) => fx("gradient", `g${i}`))
    expect(canAddKind(full, "gradient")).toBe(false)
    // 另一 kind 的计数互不干扰：渐变满了，蒙版仍然可加。
    expect(canAddKind(full, "maskPreset")).toBe(true)
  })

  it("上限逐 kind 独立（蒙版上限与渐变不同）", () => {
    const full = Array.from({ length: MASK_PRESET_MAX }, (_, i) => fx("maskPreset", `p${i}`))
    expect(canAddKind(full, "maskPreset")).toBe(false)
  })
})

describe("hasEnabledKind", () => {
  // 覆盖提示的判定：图蒙版与程序化蒙版同处 alpha 组、着色器二选一，故「目标上是否启用了
  // 程序化蒙版」决定图蒙版要不要显示「已被覆盖」。禁用条目不算启用，否则关掉程序化蒙版后
  // 提示会错误地一直挂着。
  it("检出启用中的指定 kind（禁用的不计）", () => {
    const list = [fx("maskPreset", "p", true), fx("imageMask", "m", false)]
    expect(hasEnabledKind(list, "maskPreset")).toBe(true)
    expect(hasEnabledKind(list, "imageMask")).toBe(false)
  })
})

describe("fieldsForScope", () => {
  it("字段级 scope：moire 的卡面浮雕只对卡面显示，图层面板里隐去", () => {
    const keysFor = (scope: "layer" | "face") => fieldsForScope("moire", scope).map((f) => f.key)
    expect(keysFor("face")).toContain("faceStrength")
    expect(keysFor("layer")).not.toContain("faceStrength")
  })

  it("未标注 scope 的字段两端都显示（默认不筛）", () => {
    const layer = fieldsForScope("moire", "layer").map((f) => f.key)
    // depth / twist 等通用字段不受字段级 scope 影响，图层上照常出现。
    expect(layer).toContain("depth")
    expect(layer).toContain("twist")
  })

  it("全程无字段级 scope 的 kind 两端字段完全一致", () => {
    expect(fieldsForScope("lattice", "layer")).toEqual(fieldsForScope("lattice", "face"))
  })

  it("光泽的「作为蒙版」只对图层显示：光带裁的是子树，卡面底下没有可裁的东西", () => {
    const keysFor = (scope: "layer" | "face") =>
      fieldsForScope("gloss", scope).map((f) => f.key)
    expect(keysFor("layer")).toContain("asMask")
    expect(keysFor("face")).not.toContain("asMask")
  })
})

describe("imageTargetForEffect", () => {
  // 图片字段的控件是共享的（imageMask / image 都用它），落盘目标必须按 kind 分流：
  // 分流写死成 maskEffect 时，图片贴片会静默写进蒙版路径——画面不动、也不报错。
  it("image 效果落到 imageEffect 目标", () => {
    expect(imageTargetForEffect(fx("image", "img"), "L1")).toEqual({
      kind: "imageEffect",
      layerId: "L1",
      effectId: "img",
    })
  })

  it("imageMask 效果落到 maskEffect 目标", () => {
    expect(imageTargetForEffect(fx("imageMask", "mask"), "L1")).toEqual({
      kind: "maskEffect",
      layerId: "L1",
      effectId: "mask",
    })
  })

  // 同一个 image 效果里有两个图片字段：主图与法线贴图。落盘目标必须再按字段分流，
  // 否则选法线图会覆盖掉主图（画面变、且没有报错）。
  it("image 效果的 normalPath 字段落到 normalEffect 目标", () => {
    expect(imageTargetForEffect(fx("image", "img"), "L1", "normalPath")).toEqual({
      kind: "normalEffect",
      layerId: "L1",
      effectId: "img",
    })
  })

  it("条目不存在或不是图片字段的效果时返回 null（不落盘）", () => {
    expect(imageTargetForEffect(undefined, "L1")).toBeNull()
    expect(imageTargetForEffect(fx("gradient", "g"), "L1")).toBeNull()
  })
})

describe("presetChangePatch", () => {
  it("切到某预设时，下发的是该预设整组形状参数，而非只改 id", () => {
    const stars = MASK_PRESETS.find((p) => p.id === "stars")!
    const patch = presetChangePatch("stars", { arrangement: "random" })
    expect(patch).not.toBeNull()
    // 形状档位随预设落到位——这是「切换生效」的关键；只写 id 时这几项会留在旧档。
    expect(patch!.sides).toBe(stars.params.sides)
    expect(patch!.spike).toBe(stars.params.spike)
    expect(patch!.density).toBe(stars.params.density)
    expect(patch!.size).toBe(stars.params.size)
    // id 也一并写入，供下拉回显与落盘引用。
    expect(patch!.id).toBe("stars")
  })

  it("切档保留当前排布（规则 / 随机与形状正交，不该被重置）", () => {
    const patch = presetChangePatch("dots", { arrangement: "regular" })
    expect(patch!.arrangement).toBe("regular")
  })

  it("切档把位移与种子重置为默认（每次选中都是可预期的初值）", () => {
    const patch = presetChangePatch("stars", { arrangement: "random" })
    // 位移归零、种子回到默认，不继承上一次的挪动 / 重掷结果（见 materializePreset 注释）。
    expect(patch!.offsetX).toBe(0)
    expect(patch!.offsetY).toBe(0)
    expect(EFFECT_REGISTRY.maskPreset.defaultParams().seed).toBe(patch!.seed)
  })

  it("未知预设 id 返回 null（调用方跳过，不留空撤销步）", () => {
    expect(presetChangePatch("does-not-exist", { arrangement: "random" })).toBeNull()
  })
})

describe("maskSourcePatch", () => {
  // 颜色源的阈值是「颜色距离」，与图片源的亮度阈值不同量纲：沿用 0 / 1 会让颜色蒙版恒为
  // 全权重（整卡毫无变化），用户会以为「切到颜色源后什么都没发生」。
  it("切到颜色源且阈值仍是图片源默认值时，给一条可用的颜色带宽", () => {
    const patch = maskSourcePatch("color", { edge0: 0, edge1: 1 })
    expect(patch).toEqual({ edge0: 0.05, edge1: 0.25 })
  })

  // 用户调过的阈值不该被覆盖——那是他自己的蒙版参数，不是初值。
  it("阈值已被调过时不动", () => {
    expect(maskSourcePatch("color", { edge0: 0.1, edge1: 0.6 })).toBeNull()
  })

  it("切回图片源不产生补丁", () => {
    expect(maskSourcePatch("image", { edge0: 0, edge1: 1 })).toBeNull()
  })
})

