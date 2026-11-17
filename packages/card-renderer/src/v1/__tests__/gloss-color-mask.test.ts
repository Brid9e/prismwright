/**
 * 光泽换色 / 作为蒙版：GLSL 跑不了（node 无 WebGL），沿用 `tilt-gain.test.ts` 的字符串断言。
 *
 * 钉住四件事：
 * - 光带颜色改由 `uGlossColor` 定长数组提供，不再有写死的暖白常量；
 * - `asMask` 的条目在颜色通路里被跳过（否则「当蒙版用的光泽」还额外加了一层光）；
 * - 蒙版覆盖率用核心带 `1 - smoothstep(0, width, d)`——与加光用的双边界不同，
 *   它必须是 0–1 的覆盖率，而加光带是 0.08 / 0.25 的弱权重；
 * - 祖先侧按 literal 下标逐槽展开（GLSL ES 1.00 的 constant-index-expression 限制，
 *   不能把槽位号当函数入参）。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"
import { LAYER_FRAGMENT } from "../shaders/layer"

describe("光泽换色", () => {
  it("颜色走 uGlossColor 数组，写死的暖白常量已移除", () => {
    expect(GLSL_COMMON).toContain("uniform vec3 uGlossColor[GLOSS_MAX];")
    expect(GLSL_COMMON).toContain("vec3 bandColor = uGlossColor[g] * band * uGlossIntensity[g] * ga;")
    expect(GLSL_COMMON).not.toContain("vec3(1.15, 1.1, 1.05)")
  })

  // 颜色的 alpha 只缩放这一条光带的贡献：0 = 完全不加光、也不压暗底色。
  it("光带颜色自带 alpha，乘进加光与压暗两项", () => {
    expect(GLSL_COMMON).toContain("uniform float uGlossAlpha[GLOSS_MAX];")
    expect(GLSL_COMMON).toContain("float ga = uGlossAlpha[g];")
    expect(GLSL_COMMON).toContain("float darken = 1.0 - 0.2 * uGlossIntensity[g] * ga;")
  })
})

// 光带整场平移：先减 offset 再取坐标，缺省 0 时 gu ≡ uv，存量画面逐位不变。
describe("光泽位移", () => {
  it("平移发生在取坐标之前：半径 / 平行投影 / 扭转吃同一份平移后的 UV", () => {
    expect(GLSL_COMMON).toContain("vec2 gu = uv - vec2(offsetX, offsetY);")
    expect(GLSL_COMMON).toContain("vec2 gc = gu - 0.5;")
    // 扭转也跟着走，否则图案中心与位移分家（种子 0 时扭转中心还在卡心）。
    expect(GLSL_COMMON).toContain("twistPhase(gu, twist, twistSeed)")
    expect(GLSL_COMMON).toContain("1.1180 * dot(gu, gdir)")
    // 射线分支用平移后的中心取极角。
    expect(GLSL_COMMON).toContain("atan(gc.y, gc.x)")
    // 加光通路逐条传入各自槽位的位移。
    expect(GLSL_COMMON).toContain("uGlossOffsetX[g]")
    expect(GLSL_COMMON).toContain("uGlossOffsetY[g]")
  })

  it("祖先光泽蒙版同样带位移（窗口与加光场是同一份图案）", () => {
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossOffsetX[")
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossOffsetY[")
  })
})

// 羽化：光带边缘的软硬。softness = 1 必须与「从中心一路渐隐」的旧画法逐像素一致，
// 否则存量系列一解析就换了个画面。
describe("光泽羽化", () => {
  it("声明了 uGlossSoftness 数组，且边缘剖面由 glossProfile 统一提供", () => {
    expect(GLSL_COMMON).toContain("uniform float uGlossSoftness[GLOSS_MAX];")
    expect(GLSL_COMMON).toContain("float glossProfile(float d, float radius, float softness)")
    // 1 = 羽化铺满整个半径，等价于旧的 smoothstep(0, radius, d)。
    expect(GLSL_COMMON).toContain("float feather = max(r * clamp(softness, 0.0, 1.0), 1e-4);")
    expect(GLSL_COMMON).toContain("return 1.0 - smoothstep(r - feather, r, d);")
  })

  it("两条光带都按各自槽位的羽化取值", () => {
    expect(GLSL_COMMON).toContain("float soft = uGlossSoftness[g];")
    expect(GLSL_COMMON).toContain("glossProfile(d, uGlossWidth[g] * 4.1667, soft)")
    expect(GLSL_COMMON).toContain("glossProfile(d, uGlossWidth[g], soft)")
  })

  it("祖先蒙版也吃同一个羽化参数", () => {
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossSoftness[")
  })
})

describe("光泽作为蒙版", () => {
  it("asMask 条目在颜色通路里被跳过", () => {
    expect(GLSL_COMMON).toContain("uniform float uGlossAsMask[GLOSS_MAX];")
    expect(GLSL_COMMON).toContain("if (float(g) < uGlossCount && uGlossAsMask[g] < 0.5) {")
  })

  it("覆盖率取核心带（0–1），宽度即边缘软硬", () => {
    expect(GLSL_COMMON).toContain("return glossProfile(d, width, softness);")
    // 距离计算被抽成标量入参的公共函数（数组取值留在调用方的定长循环里）。
    expect(GLSL_COMMON).toContain("float glossDistance(")
    expect(GLSL_COMMON).toContain("float glossMaskWeight(")
  })

  it("祖先蒙版的乘入用槽位字面量下标，且早于 alpha 的计算", () => {
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossCount[")
    expect(LAYER_FRAGMENT).toContain("ancestorClip *= glossMaskWeight(")
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossMode[0]")
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossMode[1]")
    // 段 0 的第 0 条：h = 0 * GLOSS_MAX + 0；段 1 的第 0 条：1 * GLOSS_MAX + 0 = 2。
    expect(LAYER_FRAGMENT).toContain("uAncestorGlossMode[2]")
    const mask = LAYER_FRAGMENT.indexOf("ancestorClip *= glossMaskWeight(")
    expect(mask).toBeGreaterThan(-1)
    expect(mask).toBeLessThan(
      LAYER_FRAGMENT.indexOf("float alpha = mw * uHoloMix"),
    )
  })
})
