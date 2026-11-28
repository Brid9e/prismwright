/**
 * 卡面材质与着色器之间的 uniform 契约。
 *
 * 与 `layer-material.test.ts` 同一条接缝、同一个理由：GLSL 跑不了（node 环境没有 WebGL），
 * 「着色器声明了 `uMaskPresetCount`、材质却把计数写进了别的名字」这种错配在类型上完全看不出来，
 * 症状是**画面静默不动**。卡面材质这一侧此前没有单测，本文件补上——它新接了一整条蒙版通路
 * （图蒙版三件套 + 程序化蒙版计数门控），正是最容易接错、又最难从屏幕上归因的地方。
 *
 * `new ShaderMaterial(...)` 是纯 JS，不需要 GL 上下文，故能在 node 里构造。
 */
import { describe, it, expect } from "vitest"
import { Color, DataTexture, RGBAFormat } from "three"
import { EffectSchema } from "@prismwright/schema"
import { createBaseMaterial } from "../materials/base-material"
import { BASE_FRAGMENT } from "../shaders/base"
import { CARD_BACKGROUND_COLOR } from "../card-scene"

/** 1×1 占位纹理：充当底图 / 蒙版 sampler 的绑定。 */
const placeholder = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat)

/** 2×1 的纹理：自然宽高比 2，用来验证填充方式的等比换算。 */
const wideTexture = new DataTexture(new Uint8Array(2 * 4), 2, 1, RGBAFormat)

/** 以默认参数构造卡面材质，只按需覆盖蒙版纹理 / 效果列表。 */
function build(over: Partial<Parameters<typeof createBaseMaterial>[0]> = {}) {
  return createBaseMaterial({
    map: placeholder,
    aspect: 1,
    cornerRadius: 0.06,
    effects: [],
    mask: null,
    ...over,
  })
}

describe("createBaseMaterial", () => {
  // 默认无蒙版：这是「默认外观 == 改动前」的接线保证——蒙版通路必须默认关闭。
  it("无蒙版时 uHasMask 为 0", () => {
    expect(build().uniforms.uHasMask.value).toBe(0)
  })

  it("自流动时间默认 0，显式传入时接到 uTime", () => {
    expect(build().uniforms.uTime.value).toBe(0)
    expect(build({ time: 1.25 }).uniforms.uTime.value).toBe(1.25)
  })

  // 蒙版三件套的枚举 / 布尔在材质这一层折成 0/1（着色器只认浮点）：mode fill → 0、invert → 1。
  // 折反了症状是「蒙版明暗颠倒 / 反转开关没反应」，只钉一个方向看不出来。图蒙版改由效果解析。
  it("有 imageMask 效果时逐项接线 hasMask / 模式 / 反转 / 阈值", () => {
    const effects = [
      EffectSchema.parse({
        kind: "imageMask",
        id: "im",
        params: { path: "assets/m.png", mode: "fill", edge0: 0.2, edge1: 0.7, invert: true },
      }),
    ]
    const m = build({ mask: placeholder, effects })
    expect(m.uniforms.uHasMask.value).toBe(1)
    expect(m.uniforms.uMaskMode.value).toBe(0)
    expect(m.uniforms.uMaskInvert.value).toBe(1)
    expect(m.uniforms.uLineEdge0.value).toBe(0.2)
    expect(m.uniforms.uLineEdge1.value).toBe(0.7)
    expect(m.uniforms.uMask.value).toBe(placeholder)
  })

  // path 为空串 = 「已添加但未上传」：这是合法中间态，权重应恒为 1（不裁切）。
  it("imageMask 的 path 为空串时 uHasMask 为 0（已添加未上传）", () => {
    const effects = [EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "" } })]
    expect(build({ mask: placeholder, effects }).uniforms.uHasMask.value).toBe(0)
  })

  // line 是默认语义，折成 1（与 layer 一致）。单钉一个方向会漏掉「写死 0」的错。
  it("imageMask 模式为 line 时 uMaskMode 为 1", () => {
    const effects = [
      EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "m.png", mode: "line" } }),
    ]
    expect(build({ effects }).uniforms.uMaskMode.value).toBe(1)
  })

  // 图蒙版的位移 / 缩放 / 旋转接三个 uniform：名字对不上时滑块拖了画面不动；默认若是错的，
  // 旧系列的孔洞会整体偏移 / 缩小。
  it("图蒙版的位移 / 缩放 / 旋转接线到 uMaskCenter / uMaskSize / uMaskRotation", () => {
    const effects = [
      EffectSchema.parse({
        kind: "imageMask",
        id: "im",
        // 显式拉伸：本组只验位移 / 缩放 / 旋转的接线，尺寸不掺填充方式的等比换算。
        params: { path: "m.png", x: 0.1, y: -0.2, scale: 2, rotation: 90, fit: "stretch" },
      }),
    ]
    const m = build({ aspect: 0.5, mask: placeholder, effects })
    expect(m.uniforms.uMaskCenter.value.x).toBeCloseTo(0.1)
    expect(m.uniforms.uMaskCenter.value.y).toBeCloseTo(-0.2)
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(1) // 0.5 × 2
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(2)
    expect(m.uniforms.uMaskRotation.value).toBeCloseTo(Math.PI / 2)
  })

  // 填充方式靠蒙版纹理的自然比例换算：漏传纹理比例时 cover / contain 会静默退化成拉伸。
  it("蒙版填充方式为覆盖时按蒙版图比例换算 uMaskSize", () => {
    const effects = [
      EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "m.png", fit: "cover" } }),
    ]
    const m = build({ aspect: 0.5, mask: wideTexture, effects })
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(2)
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(1)
  })

  it("缺省覆盖：按蒙版图比例等比铺满卡面", () => {
    const effects = [EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "m.png" } })]
    const m = build({ aspect: 0.5, mask: wideTexture, effects })
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(2)
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(1)
  })

  // 无蒙版时变换必须恒等：尺寸按卡面兜底（不是 0），否则着色器里的除法与裁剪会静默出错。
  it("无蒙版时蒙版变换恒等（中心 0、铺满卡面、不旋转）", () => {
    const m = build({ aspect: 0.5 })
    expect(m.uniforms.uMaskCenter.value.x).toBe(0)
    expect(m.uniforms.uMaskCenter.value.y).toBe(0)
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(0.5)
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(1)
    expect(m.uniforms.uMaskRotation.value).toBe(0)
  })

  // 效果数组整批绑入：光泽走 color 组，count → uGlossCount、模式 → uGlossMode、强度 → uGlossIntensity。
  // 名字对不上时着色器读到的恒为 0，画面是「加了光泽却什么都没有」。
  it("把 gloss 效果接线到 uGloss* 数组", () => {
    const effects = [
      EffectSchema.parse({
        kind: "gloss",
        id: "gl",
        params: { mode: "radial", count: 3, intensity: 0.8 },
      }),
    ]
    const m = build({ effects })
    expect(m.uniforms.uGlossCount.value).toBe(1)
    expect(m.uniforms.uGlossMode.value[0]).toBe(1)
    expect(m.uniforms.uGlossBands.value[0]).toBe(3)
    expect(m.uniforms.uGlossIntensity.value[0]).toBe(0.8)
    // 颜色：没设 color 的条目（含未占用槽位）都是老暖白常量，存量卡逐像素不变。
    expect(m.uniforms.uGlossColor.value).toHaveLength(2)
    for (const c of m.uniforms.uGlossColor.value) {
      expect(c.r).toBeCloseTo(1.15, 5)
      expect(c.g).toBeCloseTo(1.1, 5)
      expect(c.b).toBeCloseTo(1.05, 5)
    }
  })

  // 换色与「当蒙版」走同一条打包接缝：color 是 vec3（不进 packUniforms），asMask 是标量数组。
  it("gloss 的 color / asMask 逐条接线", () => {
    const effects = [
      EffectSchema.parse({
        kind: "gloss",
        id: "gl",
        params: { color: "#ffffff", asMask: true },
      }),
    ]
    const m = build({ effects })
    expect(m.uniforms.uGlossColor.value[0].r).toBeCloseTo(1, 5)
    expect(m.uniforms.uGlossColor.value[0].r).not.toBeCloseTo(1.15, 5)
    expect(m.uniforms.uGlossAsMask.value).toEqual([1, 0])
  })

  it("gloss 的 color alpha 接线到 uGlossAlpha，未占用槽位补 1", () => {
    const effects = [
      EffectSchema.parse({ kind: "gloss", id: "gl", params: { color: "#ff880080" } }),
    ]
    const m = build({ effects })
    expect(m.uniforms.uGlossAlpha.value).toHaveLength(2)
    expect(m.uniforms.uGlossAlpha.value[0]).toBeCloseTo(128 / 255, 10)
    expect(m.uniforms.uGlossAlpha.value[1]).toBe(1)
  })

  // 位移与其它光泽参数同一条数组接缝：漏绑或改错名字，滑杆拖动就毫无反应（静默）。
  it("gloss 的 offsetX / offsetY 接线到 uGlossOffsetX / uGlossOffsetY", () => {
    const effects = [
      EffectSchema.parse({
        kind: "gloss",
        id: "gl",
        params: { offsetX: 0.25, offsetY: -0.5 },
      }),
    ]
    const m = build({ effects })
    expect(m.uniforms.uGlossOffsetX.value).toEqual([0.25, 0])
    expect(m.uniforms.uGlossOffsetY.value).toEqual([-0.5, 0])
  })

  // 卡面浮雕走与光泽同一条「整批绑入」接缝：着色器声明 uMoireFaceStrength、材质若写错名字，
  // 刻纹在卡面上的浮雕滑块就恒不生效（画面静默退回「只切光带」）。这里钉住它带上了 faceStrength 的值。
  it("把 moire 的 faceStrength 接线到 uMoireFaceStrength", () => {
    const effects = [EffectSchema.parse({ kind: "moire", id: "mo", params: { faceStrength: 0.6 } })]
    const m = build({ effects })
    expect(m.uniforms.uMoireCount.value).toBe(1)
    expect(m.uniforms.uMoireFaceStrength.value[0]).toBe(0.6)
  })

  // 卡面片元的程序化蒙版已改与图层同构的计数门控：不再有标量 uHasMaskPreset，改读 uMaskPresetCount。
  // 旧的标量 uniform 若残留，着色器会读到一个恒 0 的门控 —— 症状是「卡面内置蒙版整条不生效」。
  it("不再有 uHasMaskPreset（卡面片元改读 uMaskPresetCount）", () => {
    expect("uHasMaskPreset" in build().uniforms).toBe(false)
  })

  // 空效果列表：各档计数应全部为 0（着色器据此整档跳过），尤其相位组的两组。
  it("无效果时各档计数为 0", () => {
    const m = build()
    expect(m.uniforms.uGlossCount.value).toBe(0)
    expect(m.uniforms.uMoireCount.value).toBe(0)
    expect(m.uniforms.uMaskPresetCount.value).toBe(0)
  })

  // 底图采样变换：屏幕上的「填充方式 / 偏移 / 缩放 / 旋转」全靠这几个 uniform。名字写错 /
  // 没绑 → 着色器恒读 0，症状是整张卡面变透明或缩成一个小块，和「图坏了」很难区分。
  it("按纹理的真实宽高算出覆盖模式的采样矩阵", () => {
    // 2:1 的图铺进 0.5:1 的卡面：高顶满、横向只采中间 0.5/2。
    const wide = new DataTexture(new Uint8Array([0, 0, 0, 255]), 2, 1, RGBAFormat)
    const m = build({ map: wide, aspect: 0.5, frontFit: "cover" })
    // 列主序：x = m00（u 方向跨度），w = m11（v 方向跨度）。
    expect(m.uniforms.uMapMatrix.value.x).toBeCloseTo(0.25)
    expect(m.uniforms.uMapMatrix.value.w).toBeCloseTo(1)
  })

  it("默认按覆盖模式、零偏移、1 倍、0 度接线（矩阵为单位阵）", () => {
    const m = build({ map: placeholder })
    expect(m.uniforms.uMapMatrix.value.x).toBeCloseTo(1)
    expect(m.uniforms.uMapMatrix.value.y).toBeCloseTo(0)
    expect(m.uniforms.uMapMatrix.value.z).toBeCloseTo(0)
    expect(m.uniforms.uMapMatrix.value.w).toBeCloseTo(1)
    expect(m.uniforms.uMapOffset.value.x).toBeCloseTo(0)
    expect(m.uniforms.uMapOffset.value.y).toBeCloseTo(0)
  })

  it("偏移按卡高换算后进 uMapOffset（正 = 图片向右 / 向上移）", () => {
    const m = build({
      map: placeholder,
      aspect: 0.5,
      frontFit: "stretch",
      frontOffsetX: 0.1,
      frontOffsetY: 0.2,
    })
    expect(m.uniforms.uMapOffset.value.x).toBeCloseTo(-0.2)
    expect(m.uniforms.uMapOffset.value.y).toBeCloseTo(-0.2)
  })

  it("缩放 2 倍使采样矩阵各分量减半", () => {
    const m = build({ map: placeholder, aspect: 0.5, frontFit: "stretch", frontScale: 2 })
    expect(m.uniforms.uMapMatrix.value.x).toBeCloseTo(0.5)
    expect(m.uniforms.uMapMatrix.value.w).toBeCloseTo(0.5)
  })

  it("旋转 90 度写出交叉项（正角度 = 图片顺时针）", () => {
    // 卡面 0.5 宽、图按拉伸铺满：x 分量经旋转进 v 方向，故 y = A/spanY = 0.5；
    // y 分量进 u 方向，故 z = -1/spanX = -2。
    const m = build({ map: placeholder, aspect: 0.5, frontFit: "stretch", frontRotation: 90 })
    expect(m.uniforms.uMapMatrix.value.y).toBeCloseTo(0.5)
    expect(m.uniforms.uMapMatrix.value.z).toBeCloseTo(-2)
  })

  // 越界处垫的是卡面默认底色：uniform 漏绑 → 那圈露出黑色（0,0,0），与深灰底色肉眼可分。
  it("把卡面默认底色接线到 uMapBackground", () => {
    const m = build()
    expect(m.uniforms.uMapBackground.value.getHex()).toBe(CARD_BACKGROUND_COLOR)
  })

  it("自定义底色接线到 uMapBackground", () => {
    expect(build({ baseColor: "#88ccff" }).uniforms.uMapBackground.value.getHex()).toBe(0x88ccff)
  })

  // 没有真底图时不能采 1×1 占位纹理：否则底色设置对空卡无效。
  it("没有真底图时 uHasFront 为 0，片元用 uMapBackground 垫色", () => {
    expect(build().uniforms.uHasFront.value).toBe(1)
    expect(build({ frontValid: false }).uniforms.uHasFront.value).toBe(0)
    expect(BASE_FRAGMENT).toContain("uHasFront < 0.5")
  })
})

describe("createBaseMaterial 颜色源蒙版", () => {
  /** 造一条颜色源 imageMask。 */
  const colorMask = (params: Record<string, unknown> = {}) =>
    EffectSchema.parse({
      kind: "imageMask",
      id: "im",
      params: { source: "color", color: "#1a2b3c", ...params },
    })

  // 颜色源不再采样蒙版图，而是采样卡面原图（uFrontMap）并按颜色距离取权重。
  // 三个 uniform 任一接错，症状都是「切到颜色源后蒙版整片不生效，且没有任何报错」。
  it("接线 uFrontMap / uMaskSource / uMaskColor", () => {
    const m = build({ map: wideTexture, effects: [colorMask()] })
    expect(m.uniforms.uFrontMap.value).toBe(wideTexture)
    expect(m.uniforms.uMaskSource.value).toBe(1)
    expect(m.uniforms.uMaskColor.value.equals(new Color("#1a2b3c"))).toBe(true)
    expect(m.uniforms.uHasMask.value).toBe(1)
  })

  // 颜色源的「蒙版图」就是卡面原图，故填充方式要按**原图**比例换算，而不是按（不存在的）蒙版图。
  // 漏了这条，覆盖 / 适应会静默退化为拉伸，吸管拾取的区域与实际看到的卡面错位。
  it("蒙版尺寸按卡面原图比例换算", () => {
    // 卡面 0.5 宽、原图 2:1 → 覆盖模式跨度 (2, 1)。
    const m = build({ map: wideTexture, aspect: 0.5, effects: [colorMask({ fit: "cover" })] })
    expect(m.uniforms.uMaskSize.value.x).toBeCloseTo(2)
    expect(m.uniforms.uMaskSize.value.y).toBeCloseTo(1)
  })

  // 没有卡面原图时颜色源无从采样：hasMask 必须归零。否则会去采 1×1 占位纹理，
  // 整卡按「离拾取色很远」被静默裁掉（或反过来整片保留），用户只会看到蒙版莫名失效。
  it("颜色源但无卡面原图时 uHasMask = 0", () => {
    expect(build({ effects: [colorMask()], frontValid: false }).uniforms.uHasMask.value).toBe(0)
  })

  // 图片源不受 frontValid 影响：它采的是独立的蒙版图，有没有卡面原图都成立。
  it("图片源不看 frontValid，且 uMaskSource 为 0", () => {
    const effects = [
      EffectSchema.parse({ kind: "imageMask", id: "im", params: { path: "m.png" } }),
    ]
    const m = build({ mask: placeholder, effects, frontValid: false })
    expect(m.uniforms.uHasMask.value).toBe(1)
    expect(m.uniforms.uMaskSource.value).toBe(0)
  })
})

describe("createBaseMaterial 蒙版擦除", () => {
  // 有纹理才开门：片元按 uHasErase 决定要不要采样，漏了它就是「画了擦除图但画面不变」。
  it("传入擦除纹理时 uHasErase = 1，并绑定到 uEraseMap", () => {
    const m = build({ erase: wideTexture })
    expect(m.uniforms.uHasErase.value).toBe(1)
    expect(m.uniforms.uEraseMap.value).toBe(wideTexture)
  })

  it("没传擦除纹理时 uHasErase = 0（占位绑定不参与采样）", () => {
    expect(build().uniforms.uHasErase.value).toBe(0)
  })

  // 辅助底色默认关：不传参数时输出必须与正常浏览一致（导出走的也是未开的那条路）。
  it("默认不带辅助底色（uErasePreview = 0）", () => {
    expect(build().uniforms.uErasePreview.value).toBe(0)
  })

  it("erasePreview 为真时 uErasePreview = 1", () => {
    expect(build({ erasePreview: true }).uniforms.uErasePreview.value).toBe(1)
  })
})

describe("createBaseMaterial 的法线（bump）绑定", () => {
  // 默认关是「存量画面逐像素不变」的接线保证：强度 0 时着色器整段跳过。
  it("默认 uBumpSource = 0（关）且各项参数取中性值", () => {
    const m = build()
    expect(m.uniforms.uBumpSource.value).toBe(0)
    expect(m.uniforms.uBumpStrength.value).toBe(0)
    expect(m.uniforms.uBumpDetail.value).toBeCloseTo(0.01)
    expect(m.uniforms.uBumpFlow.value).toBeCloseTo(0.5)
    expect(m.uniforms.uBumpLight.value).toBeCloseTo(1)
    expect(m.uniforms.uBumpLightAngle.value).toBeCloseTo(127)
    expect(m.uniforms.uBumpLightColor.value.equals(new Color("#ffffff"))).toBe(true)
    expect(m.uniforms.uBumpInvert.value).toBe(0)
  })

  it("开了法线后逐项接线，来源 1 = 卡面底图", () => {
    const m = build({
      frontBumpStrength: 0.7,
      frontBumpDetail: 0.02,
      frontBumpFlow: 0.3,
      frontBumpLight: 0.6,
      frontBumpLightAngle: -20,
      frontBumpLightColor: "#ffcc00",
      frontBumpInvert: true,
    })
    expect(m.uniforms.uBumpSource.value).toBe(1)
    expect(m.uniforms.uBumpStrength.value).toBeCloseTo(0.7)
    expect(m.uniforms.uBumpDetail.value).toBeCloseTo(0.02)
    expect(m.uniforms.uBumpFlow.value).toBeCloseTo(0.3)
    expect(m.uniforms.uBumpLight.value).toBeCloseTo(0.6)
    expect(m.uniforms.uBumpLightAngle.value).toBeCloseTo(-20)
    expect(m.uniforms.uBumpLightColor.value.equals(new Color("#ffcc00"))).toBe(true)
    expect(m.uniforms.uBumpInvert.value).toBe(1)
  })

  it("凹凸光颜色的 alpha 单独接线到 uBumpLightAlpha", () => {
    const m = build({ frontBumpStrength: 0.7, frontBumpLightColor: "#ffcc0080" })
    expect(m.uniforms.uBumpLightAlpha.value).toBeCloseTo(128 / 255, 10)
  })

  // 没有真底图时（1×1 占位）亮度没有意义：整段必须关掉，不能拿占位像素算出假的斜度。
  it("没有真底图（frontValid=false）时不启用", () => {
    expect(build({ frontValid: false, frontBumpStrength: 0.7 }).uniforms.uBumpSource.value).toBe(0)
  })
})

describe("createBaseMaterial 的法线贴图绑定", () => {
  /** 一张独立于底图的法线纹理。 */
  const normalTexture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat)

  // 默认走亮度通路的接线保证：模式 / 翻转都得是 0，采样器绑一张已有的纹理（不会真的被采样）。
  it("默认 uBumpMode = 0、uBumpFlipY = 0，法线采样器绑占位纹理", () => {
    const m = build()
    expect(m.uniforms.uBumpMode.value).toBe(0)
    expect(m.uniforms.uBumpFlipY.value).toBe(0)
    expect(m.uniforms.uNormalMap.value).toBe(placeholder)
  })

  it("选了法线贴图时走法线通路（uBumpMode = 1），绑上贴图并带上绿通道翻转", () => {
    const m = build({
      frontBumpStrength: 0.7,
      frontNormalPath: "assets/n.png",
      frontNormalFlipY: true,
      normal: normalTexture,
    })
    expect(m.uniforms.uBumpSource.value).toBe(1)
    expect(m.uniforms.uBumpMode.value).toBe(1)
    expect(m.uniforms.uBumpFlipY.value).toBe(1)
    expect(m.uniforms.uNormalMap.value).toBe(normalTexture)
  })

  // 路径写了但纹理没载入（读盘失败）：退回亮度通路，而不是整段失效。
  it("路径非空但纹理没载入时退回亮度通路（uBumpMode = 0）", () => {
    const m = build({ frontBumpStrength: 0.7, frontNormalPath: "assets/n.png" })
    expect(m.uniforms.uBumpMode.value).toBe(0)
    expect(m.uniforms.uNormalMap.value).toBe(placeholder)
  })

  it("强度 0 时整段关（哪怕贴图在场）", () => {
    const m = build({ frontNormalPath: "assets/n.png", normal: normalTexture })
    expect(m.uniforms.uBumpSource.value).toBe(0)
    expect(m.uniforms.uBumpMode.value).toBe(0)
  })
})
