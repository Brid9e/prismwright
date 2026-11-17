/**
 * `shardField` 逐格散列的入参契约。
 *
 * GLSL 跑不了（node 无 WebGL），但 `shardCell` 把 seed 直接喂进 `hash21` 会在**运行期**出
 * 隐形问题：`hash21` 是 `fract(sin(dot(p, …)) * …)`，seed 一大，sin 的实参就跟着涨，涨到
 * 1e8 量级时逐格坐标差落进浮点粒度之下、散列退化成同一值，碎片从「随机散开」塌回「规整网格」
 * ——只在画面上可见，typecheck / 单测都绿。这里用字符串断言把「seed 先取模再入场」钉住。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON } from "../shaders/common"

describe("shardField 散列入参", () => {
  it("seed 先取模压进安全区间，再进 hash21", () => {
    expect(GLSL_COMMON).toContain("mod(seed, 2048.0)")
  })

  it("四处逐格散列都用取模后的 seed，而非裸的入参", () => {
    // shardCell 内不得再出现「裸 seed 直接进 hash21」——那个位置必须吃取模后的局部 seed。
    // （注意不能笼统地禁掉 uMaskPresetSeed：声明块与 presetMaskWeight 的数组下标本就合法。）
    expect(GLSL_COMMON).not.toMatch(/hash21\(c \+ vec2\([^)]*\) \+ uMaskPresetSeed/)
    // 反过来钉住「进 hash21 的是取模后的 seed」——裸入参一旦出现，即意味着大 seed 会溢出 sin 实参精度。
    expect(GLSL_COMMON).toMatch(/hash21\(c \+ vec2\([^)]*\) \+ seed\)/)
  })
})
