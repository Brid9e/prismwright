/**
 * 片元着色器的「声明的 uniform 名」契约。
 *
 * GLSL 跑不了（node 无 WebGL），但材质的 uniform 名与着色器里声明的名一旦对不上，运行时既
 * 不报错也不生效——裁切会静默失效。这里用字符串断言把这个接缝钉住。
 */
import { describe, it, expect } from "vitest"
import { MAX_NEST_DEPTH } from "@cardbara/schema"
import { HOLO_POLE_SOFTEN_UV, GLSL_COMMON } from "../shaders/common"
import { LAYER_FRAGMENT } from "../shaders/layer"

describe("LAYER_FRAGMENT 祖先裁切", () => {
  it("按 MAX_NEST_DEPTH 展开深度宏", () => {
    expect(LAYER_FRAGMENT).toContain(`#define MAX_NEST_DEPTH ${MAX_NEST_DEPTH}`)
  })

  it("声明了材质会写入的每一个祖先 uniform", () => {
    // 名字与类型逐一显式列出：只有 uAncestorMask 是 sampler2D，其余都是 float。
    // （不要用「名字含 Mask 就是 sampler」之类的启发式——uAncestorHasMask 名字也含 Mask 但它是 float。）
    const declarations: Record<string, string> = {
      uAncestorMask: "sampler2D",
      uAncestorHasMask: "float",
      uAncestorMaskMode: "float",
      uAncestorInvert: "float",
      uAncestorEdge0: "float",
      uAncestorEdge1: "float",
      // 祖先蒙版的位移 / 缩放 / 旋转（与自身蒙版同一套变换）。
      uAncestorCenter: "vec2",
      uAncestorSize: "vec2",
      uAncestorRotation: "float",
      // 颜色源：来源开关与拾取色（祖先颜色蒙版按卡面原图采样）。
      uAncestorSource: "float",
      uAncestorColor: "vec3",
    }
    for (const [name, type] of Object.entries(declarations)) {
      expect(LAYER_FRAGMENT).toContain(`uniform ${type} ${name}[MAX_NEST_DEPTH]`)
    }
  })

  // 片元可用的纹理单元有硬上限：WebGL2 的 `MAX_TEXTURE_IMAGE_UNITS` 保底 16，Windows 上
  // ANGLE/D3D11 就落在这个下限。超了整段片元编译失败，症状与祖先采样下标问题一样——图层
  // 全部不出图。数组声明按长度展开后再数。
  it("片元采样器总数不超过 16（ANGLE/D3D11 的下限）", () => {
    const samplers: string[] = []
    for (const m of LAYER_FRAGMENT.matchAll(/uniform\s+sampler2D\s+(\w+)\s*(\[\s*(\w+)\s*\])?/g)) {
      const [, name, , lenMacro] = m
      const size = lenMacro ? (lenMacro === "MAX_NEST_DEPTH" ? MAX_NEST_DEPTH : Number(lenMacro)) : 1
      for (let i = 0; i < size; i++) samplers.push(`${name}[${i}]`)
    }
    expect(samplers.length).toBeLessThanOrEqual(16)
  })

  it("把祖先权重乘进 alpha", () => {
    expect(LAYER_FRAGMENT).toContain("ancestorClip")
    expect(LAYER_FRAGMENT).toContain("* ancestorClip")
  })

  it("声明 uHasHolo 并把该门乘进 alpha（空色板 = 纯蒙版）", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uHasHolo")
    expect(LAYER_FRAGMENT).toContain("* uHasHolo")
  })

  it("采样祖先 sampler 只用字面量下标", () => {
    // GLSL ES 1.00 只允许用「常量整型表达式」索引 sampler 数组：把 `texture2D(uAncestorMask[i], …)`
    // 里的下标换成循环变量会让整段片元编译失败（实测 ANGLE 报 `array index for samplers must be
    // constant integral expressions`），图层材质于是全部不出图——症状是「全息渐变整个消失、只剩卡面
    // 底图」，且只在运行期可见（typecheck / 单测都绿）。故祖先裁切在 TS 侧按 MAX_NEST_DEPTH 展开，
    // 这条断言把「展开后每段都写字面量下标」钉死，防止有人改回循环。
    for (let i = 0; i < MAX_NEST_DEPTH; i++) {
      expect(LAYER_FRAGMENT).toContain(`texture2D(uAncestorMask[${i}]`)
    }
    // 任何以非数字下标采样祖先 sampler 的写法都判失败（声明处 `uAncestorMask[MAX_NEST_DEPTH]` 不含
    // `texture2D(`，故不会被这条误伤）。
    expect(LAYER_FRAGMENT).not.toMatch(/texture2D\(\s*uAncestorMask\[\s*(?!\d)/)
  })

  // 祖先蒙版也要吃位移 / 缩放 / 旋转：漏掉这一路，症状是「父层的蒙版挪了，子层的裁切还停在
  // 老位置」——只有带嵌套图层的系列才看得见。
  it("祖先蒙版经 maskSampleUv 变换后采样，越界视为不裁切", () => {
    for (let i = 0; i < MAX_NEST_DEPTH; i++) {
      expect(LAYER_FRAGMENT).toContain(
        `maskSampleUv(vUv, uAspect, uAncestorCenter[${i}], uAncestorSize[${i}], uAncestorRotation[${i}])`,
      )
      expect(LAYER_FRAGMENT).toContain(`clamp(aMs.xy, 0.0, 1.0)`)
    }
    expect(LAYER_FRAGMENT).toContain("float aInside = 1.0;")
    // 颜色源与图片源各走一支权重：祖先若是颜色蒙版，裁切必须按颜色距离算。
    expect(LAYER_FRAGMENT).toContain("? colorKeyWeight(aArt")
    expect(LAYER_FRAGMENT).toContain(": maskWeight(aLum")
    expect(LAYER_FRAGMENT).toContain("aArt = texture2D(uFrontMap")
  })
})

describe("LAYER_FRAGMENT 材质参数", () => {
  it("声明了共享材质 uniform（含光泽）", () => {
    for (const name of [
      "uMoireMode",
      "uMoireAngle",
      "uMoireDensity",
      "uMoireDepth",
      "uMoireTwist",
      "uGradientMode",
      "uGradientCount",
      "uGradientAngle",
      "uGradientTwist",
      "uGlossCount",
      "uGlossMode",
      "uGlossBands",
      "uGlossAngle",
      "uGlossIntensity",
    ]) {
      expect(LAYER_FRAGMENT).toContain(`uniform float ${name}`)
    }
  })

  // 光泽是「颜色组」效果，作用于目标颜色。图层片元一度漏了这条通路——挂在图层上的光泽是空操作
  // （见 spec §6.3）。这里钉住图层确实把光泽叠到了全息色 holo 上：只 `toContain("glossBands(")`
  // 不够，那只证明共享函数被内联进来了，没证明 main 里调了它；故断言具体的调用式 `glossBands(holo,`。
  it("光泽接到图层：把光带叠到全息色 holo 上，并用有效摩尔纹切带", () => {
    expect(LAYER_FRAGMENT).toContain("glossBands(holo,")
    expect(LAYER_FRAGMENT).toMatch(/moireSliceSum\(vUv\)/)
  })

  it("主空间项改用 gradientRamp", () => {
    expect(LAYER_FRAGMENT).toMatch(/gradientRamp\(uvw, uGradientMode\[/)
    expect(LAYER_FRAGMENT).not.toContain("uvw.x * 24.0")
  })

  // 整齐：把骑在渐变斜坡上的扰动（方向项 / 三处固定正弦 / 逐像素噪声位移）按 (1 - straight)
  // 淡出，straight = 1 时只剩斜坡本身，色带笔直等距。
  it("渐变整齐：扰动项统一乘 keep 淡出，参数传进 holoPhase", () => {
    expect(GLSL_COMMON).toContain("uniform float uGradientStraight;")
    expect(GLSL_COMMON).toContain("float keep = clamp(1.0 - straight, 0.0, 1.0);")
    expect(GLSL_COMMON).toContain("uvw += keep * 0.15 * distortionStrength")
    expect(GLSL_COMMON).toContain("uvw += keep * 0.07 * distortionStrength")
    expect(GLSL_COMMON).toContain("float phase = keep * (")
    expect(GLSL_COMMON).toContain("phase += keep * sin(")
    expect(LAYER_FRAGMENT).toContain("poleSoft, uGradientStraight)")
  })

  // holoPhase 末尾叠加 latticeField(uv, uLatticeFamilies[i], …)：名字对不上或调用被删，刻纹都会静默不生效。
  it("声明了几何刻纹 uniform 并在相位末尾叠加 latticeField", () => {
    for (const name of [
      "uLatticeCount",
      "uLatticeAngle",
      "uLatticeDensity",
      "uLatticeWidth",
      "uLatticeStrength",
      "uLatticeOffsetX",
      "uLatticeOffsetY",
    ]) {
      expect(LAYER_FRAGMENT).toContain(`uniform float ${name}`)
    }
    expect(LAYER_FRAGMENT).toMatch(/latticeField\(uv, uLatticeFamilies\[/)
  })

  // 线宽是**除数**又是阈值：写反了画面会朝反方向变（越调越细 / 越调越粗），
  // 而屏幕上只看到「滑块方向不对」，很容易被当成口味问题放过。故把式子钉住。
  it("刻纹线宽同时进阈值与除数（width 越大线越粗）", () => {
    expect(LAYER_FRAGMENT).toContain("uLatticeWidth")
    expect(LAYER_FRAGMENT).toContain("abs(cos(")
    // 老式子的 6/7 阈值不该再有残留：宽度参数接管之后，硬编码阈值就等于把它废掉。
    expect(LAYER_FRAGMENT).not.toContain("7.0 * abs(cos(")
    // 除数必须兜底：schema 下限虽然大于 0，但入参由外部写入，别让 0 除进去。
    expect(LAYER_FRAGMENT).toContain("max(width, 0.01)")
  })

  // 声明 + 分支两件事都要钉：uniform 名对不上或分支被删，内置蒙版都会静默不生效 / 静默变回图蒙版。
  it("声明了内置蒙版 uniform，并在片元里分支到 shardField / presetMaskWeight", () => {
    for (const name of [
      "uMaskPresetCount",
      "uMaskPresetSides",
      "uMaskPresetSpike",
      "uMaskPresetIrregular",
      "uMaskPresetEquilateral",
      "uMaskPresetDensity",
      "uMaskPresetSize",
      "uMaskPresetSizeJitter",
      "uMaskPresetArrangement",
      "uMaskPresetSoftness",
      "uMaskPresetSeed",
    ]) {
      expect(LAYER_FRAGMENT).toContain(`uniform float ${name}`)
    }
    expect(LAYER_FRAGMENT).toContain("uniform vec2 uMaskPresetOffset")
    // 整场变换三项：翻转 / 旋转是**整场**（送进 shardField 的采样点），不是单块。
    for (const name of ["uMaskPresetFlipX", "uMaskPresetFlipY", "uMaskPresetRotation"]) {
      expect(LAYER_FRAGMENT).toContain(`uniform float ${name}`)
    }
    expect(LAYER_FRAGMENT).toContain("uMaskPresetCount > 0.5")
    // presetMaskWeight 不再收 invert 实参：反转已改为逐条自带（uMaskPresetInvert[i]），故调用式钉成
    // 「只吃 uv」。写成 vUv 也顺带钉住「调用发生在 main 里、用的是真实 uv」。
    expect(LAYER_FRAGMENT).toContain("presetMaskWeight(vUv)")
    expect(LAYER_FRAGMENT).toContain("shardField(")
  })

  it("声明 uMaskInvert 并在图蒙版分支使用（不再有旧的共用 uInvert）", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uMaskInvert")
    // 旧共用标量名必须彻底消失。用 \b 词边界：uMaskInvert 里的 "Invert" 前是 k（词字符），
    // 且 uMaskInvert 整体并不含子串 "uInvert"，故 \buInvert\b 不误伤；而独立的 uInvert 会被逮住。
    expect(LAYER_FRAGMENT).not.toMatch(/\buInvert\b/)
    expect(LAYER_FRAGMENT).not.toMatch(/uniform float uInvert/)
  })

  // 时间项：uTime 由离屏导出驱动（实时预览恒 0）。声明名对不上、或没传进 holoColor，WebM 里
  // 图案就不会流动——而屏幕上只看到「导出的视频是静止的」，很容易被当成编码问题查错方向。
  it("声明 uTime 并传进 holoColor（时间推进相位）", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uTime")
    expect(LAYER_FRAGMENT).toContain("holoColor(phase, grazing, uPhaseSpeed, uTime)")
  })

  // 色标透明度：与颜色同一组混色权重，乘进全息箔的覆盖率（alpha）。
  it("holoColor 返回 vec4，色标 alpha 进全息箔的 coverage", () => {
    expect(GLSL_COMMON).toContain("uniform float uColorAlphas[8];")
    expect(GLSL_COMMON).toContain("float spectrumAlpha(float t)")
    expect(GLSL_COMMON).toContain("vec4 holoColor(")
    expect(LAYER_FRAGMENT).toContain("* holo4.a")
  })
})

describe("LAYER_FRAGMENT 图片合成", () => {
  it("声明图片效果的全部 uniform", () => {
    expect(LAYER_FRAGMENT).toContain("uniform sampler2D uImage;")
    expect(LAYER_FRAGMENT).toContain("uniform float uHasImage;")
    expect(LAYER_FRAGMENT).toContain("uniform vec2 uImageCenter;")
    expect(LAYER_FRAGMENT).toContain("uniform vec2 uImageSize;")
    expect(LAYER_FRAGMENT).toContain("uniform float uImageRotation;")
  })

  it("图片 alpha 跟随图层（蒙版权重 / 不透明度 / 圆角 / 祖先裁剪 / 整卡擦除）", () => {
    expect(LAYER_FRAGMENT).toContain(
      "imgA = tex.a * inside * mw * uOpacity * card * ancestorClip * erase;",
    )
  })

  it("采样坐标按 uImageRotation 反转（屏幕顺时针为正）", () => {
    // R 为数学正方向（逆时针）的旋转矩阵；采样点逆着图片朝向转，图片看起来才顺时针转。
    expect(LAYER_FRAGMENT).toContain("vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);")
    expect(LAYER_FRAGMENT).toContain("vec2 imgUv = r / uImageSize + 0.5;")
  })

  it("先做 over 合成再 discard（纯图片、无全息的层也能出图）", () => {
    const composite = LAYER_FRAGMENT.indexOf("float outA")
    const discard = LAYER_FRAGMENT.indexOf("if (outA < 0.001) discard;")
    expect(composite).toBeGreaterThan(-1)
    expect(discard).toBeGreaterThan(composite)
  })

  // GLSL 跑不起来，变换链只能逐字钉住。下面几条各自对应一种「看起来等价」的改写：
  // 换轴 / 中心符号 / 越界极性 / 朴素合成——每一种都会让贴片位置或混合结果错掉，
  // 而其余断言（只认片断是否存在）都放它过去。
  it("卡面点映射到图片坐标时按卡宽缩放 x 轴（不是 y 轴）", () => {
    expect(LAYER_FRAGMENT).toContain("vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);")
  })

  it("图片中心是平移项（从卡面点里减去，不是加上）", () => {
    expect(LAYER_FRAGMENT).toContain("vec2 q = p - uImageCenter;")
  })

  it("越界遮罩两侧极性正确（step(0, uv) 与 step(uv, 1)）", () => {
    expect(LAYER_FRAGMENT).toContain(
      "float inside = step(0.0, imgUv.x) * step(imgUv.x, 1.0)\n" +
        "                 * step(0.0, imgUv.y) * step(imgUv.y, 1.0);",
    )
  })

  // 合成现在是两段：先图片盖全息成 scene，再文字盖 scene 成 out。两段都必须是
  // 未预乘 alpha 加权、并对各自的 alpha 归一化——写成预乘或漏除分母，半透区域会发黑。
  it("over 合成用未预乘的 alpha 加权，并对各自的 alpha 归一化", () => {
    expect(LAYER_FRAGMENT).toContain("float sceneA = imgA + alpha * (1.0 - imgA);")
    expect(LAYER_FRAGMENT).toContain(
      "(imgC * imgA + holo * alpha * (1.0 - imgA)) / sceneA",
    )
    expect(LAYER_FRAGMENT).toContain("float outA = textA + sceneA * (1.0 - textA);")
    expect(LAYER_FRAGMENT).toContain(
      "(textC * textA + sceneC * sceneA * (1.0 - textA)) / outA",
    )
  })
})

describe("LAYER_FRAGMENT 蒙版擦除", () => {
  // 擦除图整卡一张（挂在卡面），每一层都要乘上去——否则「只留想要的部分」只对卡面底图
  // 生效，全息层原样保留，看起来像完全没擦。两路 alpha（全息 / 图片）都不能漏。
  it("全息与图片两路 alpha 都乘 eraseWeight", () => {
    expect(LAYER_FRAGMENT).toContain("float erase = eraseWeight(vUv) * ownErase * ancestorErase;")
    expect(LAYER_FRAGMENT).toContain(
      "float alpha = mw * uHoloMix * uHoloAlpha * uOpacity * uHasHolo * card * ancestorClip * erase * holo4.a;",
    )
    expect(LAYER_FRAGMENT).toContain("imgA = tex.a * inside * mw * uOpacity * card * ancestorClip * erase;")
  })

  // 图层自己的擦除图：门控 + 取样都写在同一段里，漏了它「图层上画了擦除但画面不动」。
  it("本层擦除由 uHasLayerErase 门控、按原始 vUv 取样", () => {
    expect(LAYER_FRAGMENT).toContain("if (uHasLayerErase > 0.5) {")
    expect(LAYER_FRAGMENT).toContain("texture2D(uLayerEraseMap, vUv)")
  })

  // 擦除向下继承：祖先各自一张，按字面量下标展开（sampler 数组不能用循环变量下标）。
  it("祖先擦除逐槽位展开，且用字面量下标", () => {
    for (let i = 0; i < MAX_NEST_DEPTH; i++) {
      expect(LAYER_FRAGMENT).toContain(`if (uAncestorHasErase[${i}] > 0.5) {`)
      expect(LAYER_FRAGMENT).toContain(`texture2D(uAncestorEraseMap[${i}], vUv)`)
    }
  })

  // 辅助底色只看本层自己那张图：整卡擦除的底色由卡面材质负责。
  it("绘画辅助底色由 uErasePreview 门控，只按本层擦除算", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uErasePreview;")
    expect(LAYER_FRAGMENT).toMatch(/if \(uErasePreview > 0\.5\)/)
    expect(LAYER_FRAGMENT).toContain("float cut = 1.0 - ownErase;")
  })

  it("擦除取样用卡面原始 vUv（不跟底图变换、不跟蒙版变换）", () => {
    expect(LAYER_FRAGMENT).toContain("eraseWeight(vUv)")
    expect(LAYER_FRAGMENT).not.toContain("eraseWeight(ms.xy)")
  })
})

describe("holoPhase 极点软化", () => {
  // 「相机正对着的那一点」上，归一化方向 R.xy / V.xy 没有定义，方向绕它转 2π，色带于是收成
  // 一个尖。这个尖与渐变模式无关（平行模式同样有），倾斜也不挪位置（V 奇点恒在卡心），
  // 只能就地压掉：四种方向分量各自乘上按方向长度取的 smoothstep 门控。
  it("角向分量乘上按方向长度取的平滑门控", () => {
    expect(GLSL_COMMON).toContain("smoothstep(0.0, max(poleSoft, 1e-5), length(Rxy))")
    expect(GLSL_COMMON).toContain("smoothstep(0.0, max(poleSoft, 1e-5), length(Vxy))")
    for (const name of ["snR", "csR", "snV", "csV"]) {
      expect(GLSL_COMMON).toMatch(new RegExp(`${name} \\*= gate[RV]`))
    }
  })

  // 门控半径按相机距离换算：|V.xy| ≈ (卡面 UV 距离) / |C|，所以「卡高 5%」在方向单位里是
  // 固定的 UV 半径除以相机距离——缩放时视觉大小不变。
  it("软化半径按相机距离换算，并传进 holoPhase", () => {
    expect(HOLO_POLE_SOFTEN_UV).toBe(0.05)
    expect(LAYER_FRAGMENT).toContain("invDist = 1.0 / max(length(uCameraPosition), 1e-3)")
    expect(LAYER_FRAGMENT).toContain(`float poleSoft = ${HOLO_POLE_SOFTEN_UV} * invDist`)
    expect(LAYER_FRAGMENT).toContain(
      "holoPhase(V, N, bUv, uOffset, uDistortionStrength, uNoiseStrength, poleView, poleSoft, uGradientStraight)",
    )
  })
})

describe("图层内容吃同一套颜色效果链", () => {
  // 图片 / 文字不是「盖住效果」的独立通路：刻纹 / 摩尔纹以浮雕明暗、光泽以光带作用于它们，
  // 与全息箔上的表现同源（同一批公共件）。否则给图片层加效果等于什么都没发生。
  it("图片与文字都经过 layerContentRelief 和 glossBands", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uOwnMoireCount;")
    expect(LAYER_FRAGMENT).toContain("layerContentRelief(bUv)")
    expect(LAYER_FRAGMENT).toContain("imgC *= relief * bumpShade;")
    expect(LAYER_FRAGMENT).toContain("textC *= relief * bumpShade;")
    expect(LAYER_FRAGMENT).toContain("imgC = glossBands(imgC, bUv, moireSum, R.x);")
    expect(LAYER_FRAGMENT).toContain("textC = glossBands(textC, bUv, moireSum, R.x);")
  })

  it("浮雕高度场只吃本层自有的摩尔纹与刻纹", () => {
    // 自带摩尔纹可能来自卡面继承（见 toEffectUniforms 的 inheritedMoire）：只按自有条数取。
    expect(GLSL_COMMON).toContain("float(m) < uOwnMoireCount")
    expect(GLSL_COMMON).toContain("* uMoireDepth[m]")
    expect(GLSL_COMMON).toContain("* uLatticeStrength[i]")
    // 没有自有相位效果时直接返回 1，图片 / 文字不额外付出高度场计算。
    expect(GLSL_COMMON).toContain("if (uOwnMoireCount < 0.5 && uLatticeCount < 0.5) return 1.0;")
  })
})

describe("LAYER_FRAGMENT 暗部颜色", () => {
  it("声明并使用了 uShadowMode / uHasFront / baseFrontLum", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uShadowMode;")
    expect(LAYER_FRAGMENT).toContain("uniform float uHasFront;")
    expect(LAYER_FRAGMENT).toContain("float baseFrontLum(vec2 uv)")
    expect(LAYER_FRAGMENT).toContain("if (uShadowMode > 0.5 && uHasFront > 0.5)")
    // 保留底图亮度的关键：结果色亮度被换成 baseLum，而不是图层自己的亮度。
    expect(LAYER_FRAGMENT).toContain("outC * (baseLum / styleLum)")
  })
})

describe("LAYER_FRAGMENT 小丑牌合成", () => {
  it("声明并使用了 uPaletteComposite / balatroTint", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uPaletteComposite;")
    expect(LAYER_FRAGMENT).toContain("vec3 balatroTint(")
    expect(LAYER_FRAGMENT).toContain("if (uPaletteComposite > 0.5")
    expect(GLSL_COMMON).toContain("vec4 balatroHSL(")
    expect(GLSL_COMMON).toContain("vec4 balatroRGB(")
  })
})

describe("LAYER_FRAGMENT 小丑牌参数", () => {
  it("小丑牌合成的可调项都来自 uniform", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uPaletteHue;")
    expect(LAYER_FRAGMENT).toContain("holoGridValue(uv, uPaletteGridScale) * uPaletteGrid")
    expect(LAYER_FRAGMENT).toContain("mix(hsl.z, 1.0, uPaletteLift)")
  })
})

describe("LAYER_FRAGMENT 独立网格", () => {
  it("声明并使用 uHoloGrid* / holoHueShift", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uHoloGridCount;")
    expect(LAYER_FRAGMENT).toContain("uHoloGridSize[0]")
    expect(LAYER_FRAGMENT).toContain("holoHueShift(")
    expect(GLSL_COMMON).toContain("vec3 holoHueShift(")
  })
})

describe("LAYER_FRAGMENT 小丑牌合成的边界（final review）", () => {
  it("按内容可用性放行：图片/文字/原图任一即可，无原图不再误走色带", () => {
    expect(LAYER_FRAGMENT).toContain(
      "(uHasImage > 0.5 || uHasText > 0.5 || uHasFront > 0.5)"
    )
    expect(LAYER_FRAGMENT).toContain(
      "uPaletteComposite > 0.5 && uHasImage < 0.5 && uHasText < 0.5 && uHasFront < 0.5"
    )
  })

  it("卡面原图越界时按无内容处理，不拉边", () => {
    expect(LAYER_FRAGMENT).toContain(
      "if (any(lessThan(m, vec2(0.0))) || any(greaterThan(m, vec2(1.0)))) return vec4(0.0);"
    )
  })
})
