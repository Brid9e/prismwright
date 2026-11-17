/**
 * 卡面片元的 uniform 名契约。
 *
 * 与 layer-shader.test.ts 同一条接缝：GLSL 跑不了，名字对不上运行时既不报错也不生效。
 * 本文件钉住 base.ts 在本次改造后与 layer.ts 的蒙版通路逐字同构。
 */
import { describe, it, expect } from "vitest"
import { BASE_FRAGMENT } from "../shaders/base"
import { LAYER_FRAGMENT } from "../shaders/layer"

describe("BASE_FRAGMENT 蒙版门控", () => {
  it("改用 uMaskPresetCount 计数门控，不再声明 uHasMaskPreset", () => {
    expect(BASE_FRAGMENT).toContain("uMaskPresetCount > 0.5")
    expect(BASE_FRAGMENT).not.toContain("uHasMaskPreset")
  })

  it("声明 uMaskInvert 且 presetMaskWeight 不收 invert 实参", () => {
    expect(BASE_FRAGMENT).toContain("uniform float uMaskInvert")
    // 旧共用标量名必须彻底消失。\b 词边界：uMaskInvert 不含子串 "uInvert"，故不误伤。
    expect(BASE_FRAGMENT).not.toMatch(/\buInvert\b/)
    expect(BASE_FRAGMENT).not.toMatch(/uniform float uInvert/)
    expect(BASE_FRAGMENT).toContain("presetMaskWeight(vUv)")
  })

  // 卡面与图层的蒙版通路是**各自手抄的同一段代码**（没抽进 GLSL_COMMON），所以「逐字同构」若只写在
  // 注释里就是一句承诺而已：改动一方、漏改另一方时，各自的单文件断言仍绿——静默分叉。这里把两段共用的
  // 关键式拎出来，要求在**两个片元里都逐字出现**，把承诺变成契约。
  it("与 LAYER_FRAGMENT 的蒙版通路逐字同构（采样门控与 mw 分支）", () => {
    const sharedSnippets = [
      "if (uHasMask > 0.5 && uMaskPresetCount < 0.5) {",
      "vec3 ms = maskSampleUv(vUv, uAspect, uMaskCenter, uMaskSize, uMaskRotation);",
      "if (uMaskSource > 0.5) {",
      "art = texture2D(uFrontMap, clamp(ms.xy, 0.0, 1.0)).rgb;",
      "lum = dot(texture2D(uMask, clamp(ms.xy, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));",
      "maskInside = ms.z;",
      "float mw = (uMaskPresetCount > 0.5)",
      "? presetMaskWeight(vUv)",
      ": (uMaskSource > 0.5",
      "? mix(1.0, colorKeyWeight(art, uHasMask, uMaskColor, uMaskInvert, uLineEdge0, uLineEdge1), maskInside)",
      ": mix(1.0, maskWeight(lum, uHasMask, uMaskMode, uMaskInvert, uLineEdge0, uLineEdge1), maskInside));",
    ]
    for (const snippet of sharedSnippets) {
      expect(BASE_FRAGMENT).toContain(snippet)
      expect(LAYER_FRAGMENT).toContain(snippet)
    }
  })

  // 颜色源（吸管拾色）：卡面片元要同时声明原图 sampler、来源开关与拾取色；任一名对不上，
  // 症状是「切到颜色源后蒙版整片不生效，且没有任何报错」。
  it("声明颜色源所需的 uFrontMap / uMaskSource / uMaskColor", () => {
    for (const decl of [
      "uniform sampler2D uFrontMap",
      "uniform float uMaskSource",
      "uniform vec3 uMaskColor",
    ]) {
      expect(BASE_FRAGMENT).toContain(decl)
    }
    expect(BASE_FRAGMENT).toContain("colorKeyWeight(")
  })

  // 图蒙版的位移 / 缩放 / 旋转：uniform 名对不上、或片元仍直接采 vUv，症状都是「拖了蒙版的
  // 位移滑块，孔洞不动」。
  it("图蒙版按 uMaskCenter / uMaskSize / uMaskRotation 变换后采样", () => {
    for (const decl of [
      "uniform vec2 uMaskCenter",
      "uniform vec2 uMaskSize",
      "uniform float uMaskRotation",
    ]) {
      expect(BASE_FRAGMENT).toContain(decl)
    }
    // 蒙版图没盖到的地方视为「没有蒙版数据」→ 权重 1（不裁切），见 mw 分支里的 mix。
    expect(BASE_FRAGMENT).toContain("float maskInside = 1.0;")
  })
})

describe("BASE_FRAGMENT 摩尔纹卡面浮雕", () => {
  // 卡面浮雕是「以刻纹场为高度场、沿固定斜向光取方向导数得明暗」的整条通路——声明的 uniform、
  // 提供高度场的求和件、浮雕件与它的常量、以及真正乘上浮雕因子的那次底图取样，缺一画面就静默
  // 退回「刻纹只切光带」。
  it("经 moireRelief 调制底图（默认 0 时为逐像素恒等）", () => {
    expect(BASE_FRAGMENT).toContain("uniform float uMoireFaceStrength[MOIRE_MAX]")
    expect(BASE_FRAGMENT).toContain("float moireFaceSum(vec2 uv)")
    expect(BASE_FRAGMENT).toContain("float moireRelief(vec2 uv)")
    // 浮雕乘在**底图取样**上：浮雕不改采样点，故底图取样的坐标就是填充方式算出的 mapUv
    // （浮雕本身不参与坐标系，见下方「底图填充方式」一组的断言）。
    expect(BASE_FRAGMENT).toContain("texture2D(uMap, mapUv)")
    expect(BASE_FRAGMENT).toContain("base.rgb * moireRelief(bUv)")
    // 方向导数靠「沿光向偏移一步再作差」，故浮雕件内要有沿 MOIRE_RELIEF_LIGHT 偏移的那次取样。
    expect(BASE_FRAGMENT).toContain("moireFaceSum(uv + MOIRE_RELIEF_LIGHT * MOIRE_RELIEF_STEP)")
  })

  // 折射那套常量 / 接缝必须彻底消失——留着会让人误以为还有第二条卡面通路。
  it("不再残留折射通路（MOIRE_FACE_SCALE / faceUv）", () => {
    expect(BASE_FRAGMENT).not.toContain("MOIRE_FACE_SCALE")
    expect(BASE_FRAGMENT).not.toContain("faceUv")
  })

  // 浮雕只作用于底图：蒙版与圆角仍吃真实 vUv，否则卡片轮廓会随刻纹一起扭动。
  it("蒙版与圆角不随浮雕改变（仍用真实 vUv）", () => {
    expect(BASE_FRAGMENT).toContain("roundedRectMask(vUv, uAspect, uCornerRadius)")
    expect(BASE_FRAGMENT).toContain("presetMaskWeight(vUv)")
  })
})

describe("BASE_FRAGMENT 底图填充方式 / 偏移 / 缩放 / 旋转", () => {
  // 这些调整的全部效果都落在「底图采样坐标」上：uniform 名对不上、或片元仍直接采 vUv，
  // 症状都是「选了覆盖 / 适应、转了角度、画面一点不变」。
  it("声明 uMapMatrix / uMapOffset，并按矩阵变换后的 mapUv 采底图", () => {
    expect(BASE_FRAGMENT).toContain("uniform vec4 uMapMatrix")
    expect(BASE_FRAGMENT).toContain("uniform vec2 uMapOffset")
    // 列主序构造：matrix.xy = 第一列、matrix.zw = 第二列（见 front-uv.ts 的约定）。
    expect(BASE_FRAGMENT).toContain("mat2(uMapMatrix.xy, uMapMatrix.zw)")
    expect(BASE_FRAGMENT).toContain(
      "mat2(uMapMatrix.xy, uMapMatrix.zw) * (vUv - 0.5) + 0.5 + uMapOffset",
    )
    expect(BASE_FRAGMENT).toContain("texture2D(uMap, mapUv)")
  })

  // 适应模式的留白、缩小 / 旋转露出的角，都垫卡面默认底色——不是抠成透明洞。缺了它，
  // 越界处会被 CLAMP_TO_EDGE 拉出边缘像素，表现为卡片四周拖着一条拉伸的色带。
  it("采样坐标越界时垫卡面默认底色", () => {
    expect(BASE_FRAGMENT).toContain("uniform vec3 uMapBackground")
    expect(BASE_FRAGMENT).toMatch(/any\(\s*lessThan\(\s*mapUv/)
    expect(BASE_FRAGMENT).toMatch(/any\(\s*greaterThan\(\s*mapUv/)
    expect(BASE_FRAGMENT).toContain("vec4(uMapBackground, 1.0)")
  })

  // 圆角跟的是卡面轮廓，不是底图 —— 挪图 / 换填充方式 / 旋转不该把圆角一起挪。
  // （蒙版自己有一套按「蒙版图」的变换，见上面的图蒙版一组。）
  it("圆角仍吃真实 vUv", () => {
    expect(BASE_FRAGMENT).toContain("roundedRectMask(vUv, uAspect, uCornerRadius)")
  })
})

describe("BASE_FRAGMENT 蒙版擦除", () => {
  // 擦除图是整卡最后一道乘法：与蒙版种类无关（图片 / 颜色 / 程序化都一样被擦）。
  it("最终 alpha 乘 eraseWeight，且用原始 vUv 取样", () => {
    expect(BASE_FRAGMENT).toContain("float ew = eraseWeight(vUv);")
    expect(BASE_FRAGMENT).toContain("float alpha = base.a * card * mw * ew;")
  })

  // 绘画辅助底色只是「看得见笔迹」的显示手段：必须由 uniform 门控，否则正常浏览 /
  // 离屏导出也会被染上一层红色。
  it("擦除区域底色由 uErasePreview 门控", () => {
    expect(BASE_FRAGMENT).toContain("uniform float uErasePreview;")
    expect(BASE_FRAGMENT).toMatch(/if \(uErasePreview > 0\.5\)/)
  })

  // uniform 声明在 GLSL_COMMON 里（两个片元共用同一份），名字对不上就是「画了没反应」。
  it("擦除所需 uniform 由公共片段声明，两份片元都能拿到", () => {
    for (const decl of ["uniform sampler2D uEraseMap;", "uniform float uHasErase;"]) {
      expect(BASE_FRAGMENT).toContain(decl)
      expect(LAYER_FRAGMENT).toContain(decl)
    }
  })
})
