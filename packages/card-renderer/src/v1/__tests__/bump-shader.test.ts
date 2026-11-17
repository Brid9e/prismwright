/**
 * 法线（bump）在着色器里的落点。
 *
 * GLSL 在 node 里跑不了（没有 WebGL），这里只钉字符串契约：顶点着色器要带上卡面切线的两个
 * varying，公共块要有斜率 / 法线 / 流向前提的数学，两个片元都要用扰动后的法线算光泽与全息、
 * 用扰动后的 UV 取摩尔纹与刻纹的走势。任何一处没接上，症状都是「滑块拖了画面不动」。
 */
import { describe, it, expect } from "vitest"
import { GLSL_COMMON, GLSL_VERTEX } from "../shaders/common"
import { BASE_FRAGMENT } from "../shaders/base"
import { LAYER_FRAGMENT } from "../shaders/layer"

describe("GLSL_VERTEX 的法线空间", () => {
  it("输出卡面切线与副切线（世界空间）", () => {
    expect(GLSL_VERTEX).toContain("varying vec3 vWorldTangent;")
    expect(GLSL_VERTEX).toContain("varying vec3 vWorldBitangent;")
    expect(GLSL_VERTEX).toContain("vWorldTangent = normalize((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);")
    expect(GLSL_VERTEX).toContain(
      "vWorldBitangent = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);",
    )
  })
})

describe("GLSL_COMMON 的法线数学", () => {
  it("有斜率、扰动法线与 UV 流向三个公共函数", () => {
    expect(GLSL_COMMON).toContain("vec2 bumpSlope(")
    expect(GLSL_COMMON).toContain("vec3 bumpNormal(")
    expect(GLSL_COMMON).toContain("vec2 bumpWarp(")
  })

  // 反转 = 斜率整体取反：凹变凸。符号必须乘在斜率上，改 N 的符号会把光照方向一起翻。
  it("bumpSlope 在 invert > 0.5 时取反", () => {
    expect(GLSL_COMMON).toMatch(/vec2 bumpSlope\([^)]*invert[^)]*\)\s*\{[^}]*invert > 0\.5[^}]*\}/)
  })

  // 法线贴图通路：一条采样器 + 两个模式 uniform。声明在公共块里，两个片元共用。
  it("声明法线贴图的采样器与模式 / 绿通道翻转 uniform", () => {
    expect(GLSL_COMMON).toContain("uniform sampler2D uNormalMap;")
    expect(GLSL_COMMON).toContain("uniform float uBumpMode;")
    expect(GLSL_COMMON).toContain("uniform float uBumpFlipY;")
  })

  // 解码：RGB 0–1 → 切线空间 -1–1，取负得到与 bumpSlope 同符号的斜率矩阵。
  it("normalMapSlope 解码切线空间法线、支持绿通道翻转与反转，越界按平地", () => {
    expect(GLSL_COMMON).toMatch(/vec2 normalMapSlope\(vec2 uv, float flipY, float invert\)/)
    expect(GLSL_COMMON).toContain("texture2D(uNormalMap, uv).xyz * 2.0 - 1.0")
    expect(GLSL_COMMON).toContain("if (flipY > 0.5) tn.y = -tn.y;")
    expect(GLSL_COMMON).toContain("return invert > 0.5 ? -s : s;")
    // 越界返回 (0,0)：图外视为平地，与亮度通路图外取 0 高度同口径。
    expect(GLSL_COMMON).toMatch(/normalMapSlope[\s\S]*any\(lessThan\(uv, vec2\(0\.0\)\)\)[\s\S]*return vec2\(0\.0\)/)
  })

  // 明暗项是一束可调方向 / 颜色的斜光；light 0 时恒为 1（不出明暗）。缺省 127° 与刻纹浮雕
  // 的固定斜光同向同号，两者凸起处的亮暗不会互相打架。
  it("bumpShadeAmount 按光照方向与颜色算逐通道明暗，light 0 时恒为 1", () => {
    expect(GLSL_COMMON).toMatch(/vec3 bumpShadeAmount\([^)]*light[^)]*\)\s*\{/)
    expect(GLSL_COMMON).toMatch(/vec3 bumpShadeAmount\([^)]*angle[^)]*tint[^)]*\)/)
    expect(GLSL_COMMON).toMatch(/vec2\(cos\(a\), sin\(a\)\)/)
    // 亮侧染光色、暗侧只按灰度压暗（不染补色）。
    expect(GLSL_COMMON).toMatch(/vec3\(1\.0\) \+ min\(d, 0\.0\) \+ max\(d, 0\.0\) \* tint/)
  })
})

describe("BASE_FRAGMENT 的法线通路", () => {
  const src = BASE_FRAGMENT

  it("声明法线 uniform、光照颜色与切线 varying", () => {
    for (const key of [
      "uBumpSource",
      "uBumpStrength",
      "uBumpDetail",
      "uBumpFlow",
      "uBumpLight",
      "uBumpLightAngle",
      "uBumpInvert",
    ]) {
      expect(src).toContain(`uniform float ${key};`)
    }
    expect(src).toContain("uniform vec3 uBumpLightColor;")
    expect(src).toContain("uniform float uBumpLightAlpha;")
    expect(src).toContain("varying vec3 vWorldTangent;")
    expect(src).toContain("varying vec3 vWorldBitangent;")
  })

  // 没有光泽 / 摩尔纹 / 刻纹可扰动时，凹凸只靠这一项显形。
  it("卡面明暗由高度场斜深乘出来，并乘进底色", () => {
    expect(src).toContain("vec3 bumpShade = vec3(1.0);")
    expect(src).toMatch(/bUv = vUv \+ bumpWarp\([^)]*\);\s*bumpShade = bumpShadeAmount\(/)
    expect(src).toContain("uBumpLightAngle, mix(vec3(1.0), uBumpLightColor, uBumpLightAlpha))")
    expect(src).toMatch(/vec3 rgb = base\.rgb \* .*\* bumpShade;/)
  })

  it("按卡面底图取高度场，并在启用时扰动法线与 UV", () => {
    expect(src).toContain("if (uBumpSource > 0.5)")
    expect(src).toContain("float faceBumpHeightAt(vec2 uv)")
    expect(src).toMatch(/N = bumpNormal\(N, .*vWorldTangent.*, .*vWorldBitangent.*, slope, uBumpStrength\)/)
    expect(src).toMatch(/bUv = vUv \+ bumpWarp\(slope, uBumpStrength, uBumpFlow\)/)
  })

  // 选了法线贴图时整段改采贴图（按底图的填充 / 偏移 / 缩放 / 旋转），不再取亮度差。
  // mapUv 必须先算出来：它原本在法线段之后。
  it("uBumpMode > 0.5 时改采卡面法线贴图，采样点用底图变换后的 mapUv", () => {
    expect(src).toMatch(/if \(uBumpMode > 0\.5\)\s*\{[\s\S]*normalMapSlope\(mapUv, uBumpFlipY, uBumpInvert\)/)
    expect(src.indexOf("vec2 mapUv =")).toBeGreaterThan(-1)
    expect(src.indexOf("vec2 mapUv =")).toBeLessThan(src.indexOf("normalMapSlope(mapUv"))
  })

  it("光泽 / 摩尔纹切带 / 浮雕都吃扰动后的 UV 与法线", () => {
    // 自流动只挪光泽/摩尔纹的 UV；底图仍按真实 mapUv 采样。
    expect(src).toContain("vec2 flowUv = bUv + vec2(0.0, uTime * 0.08);")
    expect(src).toContain("float moireSum = moireSliceSum(flowUv);")
    expect(src).toContain("moireRelief(bUv)")
    expect(src).toMatch(/glossBands\(rgb, flowUv, moireSum, R\.x\)/)
    // R 来自扰动后的 N。
    expect(src).toContain("vec3 R = reflect(-V, N);")
  })
})

describe("LAYER_FRAGMENT 的法线通路", () => {
  const src = LAYER_FRAGMENT

  it("声明法线 uniform、光照颜色、卡面底图采样矩阵与切线 varying", () => {
    for (const key of [
      "uBumpSource",
      "uBumpStrength",
      "uBumpDetail",
      "uBumpFlow",
      "uBumpLight",
      "uBumpLightAngle",
      "uBumpInvert",
    ]) {
      expect(src).toContain(`uniform float ${key};`)
    }
    expect(src).toContain("uniform vec3 uBumpLightColor;")
    expect(src).toContain("uniform float uBumpLightAlpha;")
    expect(src).toContain("uniform vec4 uFaceMapMatrix;")
    expect(src).toContain("uniform vec2 uFaceMapOffset;")
    expect(src).toContain("varying vec3 vWorldTangent;")
  })

  it("来源 2 时采样卡面底图，否则采样本层图片", () => {
    expect(src).toContain("float faceBumpHeightAt(vec2 uv)")
    expect(src).toContain("float imageBumpHeightAt(vec2 uv)")
    expect(src).toMatch(/uBumpSource > 1\.5/)
  })

  // 法线贴图的采样点跟着「哪张图」走：来源 2 用卡面的底图变换，否则用本层图片的变换。
  it("法线通路按来源选采样点，并在该支路采贴图", () => {
    expect(src).toContain("vec2 normalMapUv(vec2 uv)")
    expect(src).toMatch(/normalMapUv[\s\S]*uBumpSource > 1\.5/)
    expect(src).toMatch(/if \(uBumpMode > 0\.5\)\s*\{[\s\S]*normalMapSlope\(normalMapUv\(vUv\), uBumpFlipY, uBumpInvert\)/)
  })

  it("全息相位 / 光泽 / 浮雕吃扰动后的 UV 与法线", () => {
    expect(src).toMatch(/holoPhase\(V, N, bUv,/)
    expect(src).toContain("float moireSum = moireSliceSum(bUv);")
    expect(src).toMatch(/glossBands\(holo, bUv, moireSum, R\.x\)/)
    expect(src).toContain("layerContentRelief(bUv)")
  })

  // 图层明暗乘在内容上：透明区不能凭空出现明暗块，故乘在图片 / 文字取色之后。
  it("图层明暗由高度场斜深乘出来，并乘进取色结果", () => {
    expect(src).toContain("vec3 bumpShade = vec3(1.0);")
    expect(src).toMatch(/bUv = vUv \+ bumpWarp\([^)]*\);\s*bumpShade = bumpShadeAmount\(/)
    expect(src).toContain("uBumpLightAngle, mix(vec3(1.0), uBumpLightColor, uBumpLightAlpha))")
    expect(src).toMatch(/imgC \*= .*\* bumpShade;/)
    expect(src).toMatch(/textC \*= .*\* bumpShade;/)
  })

  // 图片 / 文字本身不能被 UV 流向拖走：内容采样留在真实 vUv 上。
  it("图片内容仍按真实 vUv 采样", () => {
    expect(src).toContain("vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);")
  })
})
