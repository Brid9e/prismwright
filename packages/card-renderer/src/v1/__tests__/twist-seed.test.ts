/**
 * 扭转种子：种子换的是扭转「怎么转」（绕哪个点、沿卡面绞得多紧），而不是绞多狠。
 *
 * GLSL 跑不了（node 无 WebGL），故照 `mask-transform.test.ts` 的老规矩用字符串断言钉住三件事：
 *
 * - 种子 0 走旧式（绕卡心、率恒定），逐位等于改版前的 `twist * length(uv - 0.5) * 2π`——
 *   存量系列的画面因此一格不变；
 * - moire / gradient / gloss 三处扭转（gloss 有两处）**都**经 `twistPhase` 入场——漏一处，
 *   那一路的种子滑杆就成了死旋钮，属最难发现的那类「拖了没反应」；
 * - 种子先折进哈希的安全区间再入场，否则 1e6 量级会把画面塌回规整图案（同 shardCell）。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"

describe("扭转种子", () => {
  it("种子 0 逐位退回旧式：绕卡心、扭转率恒定", () => {
    expect(GLSL_COMMON).toContain(
      "if (seed < 0.5) return twist * length(uv - 0.5) * 6.2831853;",
    )
  })

  it("摩尔纹与渐变的扭转经 twistPhase 入场（种子随之生效）", () => {
    expect(GLSL_COMMON).toContain("coord += twistPhase(uv, twist, twistSeed);")
    expect(GLSL_COMMON).toContain("return ramp + twistPhase(uvw, twist, twistSeed);")
    // 老式的「强度 × 绕卡心半径」直写不该再有残留。
    expect(GLSL_COMMON).not.toContain("twist * length(c) * 6.2831853")
    expect(GLSL_COMMON).not.toContain("twist * around * 6.2831853")
  })

  it("光泽的两处扭转（射线 / 平行光环）都带种子", () => {
    // 距离计算抽进 glossDistance 后，扭转以标量入参入场；两处分支都必须带 twistSeed。
    // 入参是**平移后**的 gu（见 glossDistance 开头的 gu = uv - offset），扭转中心随光带一起走。
    expect(GLSL_COMMON).toContain(
      "radians(angle) + viewX * 0.35 + twistPhase(gu, twist, twistSeed);",
    )
    expect(GLSL_COMMON).toContain("coord += twistPhase(gu, twist, twistSeed);")
    expect(GLSL_COMMON).not.toContain("uGlossTwist[g] * length(gc)")
  })

  it("种子先折进哈希的安全区间再使用", () => {
    expect(GLSL_COMMON).toContain("mod(seed, 2048.0)")
  })
})
