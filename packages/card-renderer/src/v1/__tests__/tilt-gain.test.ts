/**
 * 倾斜灵敏度（tiltGain）：把卡面法线相对「正对相机」的偏离按倍数放大，于是转卡时相位扫得
 * 更快 / 更慢。GLSL 跑不了（node 无 WebGL），故照 `mask-transform.test.ts` 的老规矩用字符串
 * 断言钉住三件事：
 *
 * - 默认 1 走原路：判断写成带死区的 `abs(uTiltGain - 1.0) > 1e-4` 且缩放放在分支里，否则每条
 *   存量系列都会因为多算一次 normalize 在末位抖一下——「默认逐位不变」是这套和色板同一类改动的
 *   底线；
 * - 缩放早于 `grazing` 与 `holoPhase` 求值：漏了顺序，配色与光泽仍按真实倾角算，图案和颜色分家；
 * - 只缩放法线：卡面是平面，平卡时 N 恒为 (0,0,1)，所以任何增益都不改动静止画面。视线方向的
 *   V.xy 在卡边像素上平卡时也不为零，顺手缩它会让「静止画面不变」这个承诺破功。
 */
import { describe, it, expect } from "vitest"
import { LAYER_FRAGMENT } from "../shaders/layer"

describe("倾斜灵敏度", () => {
  it("uniform 已声明", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uTiltGain;")
  })

  it("只缩放法线，且默认 1 时跳过（逐位等于改版前）", () => {
    expect(LAYER_FRAGMENT).toContain("N = normalize(vec3(N.xy * uTiltGain, N.z));")
    expect(LAYER_FRAGMENT).toContain("if (abs(uTiltGain - 1.0) > 1e-4) {")
    expect(LAYER_FRAGMENT).not.toContain("V = normalize(vec3(V.xy * uTiltGain")
  })

  it("缩放早于 grazing 与 holoPhase 的求值", () => {
    const scale = LAYER_FRAGMENT.indexOf("N = normalize(vec3(N.xy * uTiltGain, N.z));")
    expect(scale).toBeGreaterThan(-1)
    // 锚到 main 里那一行：holoPhase 内部也有一句 `float grazing = 1.0 - nd`，
    // 而 GLSL_COMMON 是整块拼在主函数前面的，锚短了会量到函数定义里去。
    expect(scale).toBeLessThan(
      LAYER_FRAGMENT.indexOf("float grazing = 1.0 - clamp(dot(N, V), 0.0, 1.0);"),
    )
    expect(scale).toBeLessThan(LAYER_FRAGMENT.indexOf("holoPhase(V, N,"))
  })
})
