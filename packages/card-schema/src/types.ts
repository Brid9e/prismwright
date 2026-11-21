/**
 * @prismwright/schema 的核心数据模型（手写 TypeScript 类型）。
 *
 * 架构位置：本文件是数据层的「类型契约」——只描述形状，不含任何运行时代码、
 * 无 UI / IO 依赖。`schema.ts` 中的 zod schema 与之互为镜像，二者的一致性由
 * `schema.ts` 末尾的编译期双向断言强制保证，任一侧漂移都会在类型检查阶段报错。
 *
 * 对外暴露：`Rarity` / `BlendMode` / `MaskMode` / `MaskArrangement` / `PatternMode` 五个字面量联合，`ColorStop` /
 * `Layer` / `CardFace` / `Card` / `Pack` 五个数据接口，以及效果栈的 `EffectRole` / `EffectKind` /
 * `EffectBase` / `Effect` / `EffectParams` 与八种效果参数接口（`GradientParams` /
 * `MoireParams` / `GlossParams` / `PaletteParams` / `MaskPresetParams` / `MaskImageParams` / `ImageParams`）。
 * 所有符号统一由 `index.ts` 再导出。
 */

/**
 * 稀有度档位：由低到高的有序枚举。
 *
 * 四个值**有序**（common < rare < epic < legendary）——排序、配色梯度、抽卡概率都能按数组
 * 下标取强弱，不必再查表。值用英文小写，展示文案由应用层 i18n 提供（桌面端 `card.rarity.*`），
 * 不把语言耦合进数据。
 *
 * 注：「隐藏款」不是一档稀有度，而是系列里的独立分组（`Pack.hiddenCards`）。
 */
export type Rarity = "common" | "rare" | "epic" | "legendary"

/** 图层与下层的混合模式，取值对齐 canvas `globalCompositeOperation`。 */
export type BlendMode = "add" | "normal" | "screen" | "multiply" | "shadow"

/** 蒙版语义：`line` = 暗线处出全息（对齐 buling 线稿）；`fill` = 亮区出全息。 */
export type MaskMode = "line" | "fill"

/**
 * 自定义蒙版的权重来源。
 *
 * - `image` = 用户上传的蒙版图，按亮度阈值取权重（原有行为）；
 * - `color` = 从卡面原图上吸管拾取一个颜色，按「像素颜色 ↔ 拾取颜色」的距离取权重。
 *   不引入额外图片资源，阈值调整在片元里实时生效。
 */
export type MaskSource = "image" | "color"

/**
 * 卡面底图的填充方式。
 *
 * - `cover` = 等比放大到铺满卡面，超出部分裁掉（不变形，默认）；
 * - `contain` = 整图完整可见，比例不合时四周留空（透明）；
 * - `stretch` = 拉伸铺满（加此字段之前的行为，比例不合会变形）。
 */
export type FrontFit = "cover" | "contain" | "stretch"

/**
 * 程序化蒙版的排布方式。
 *
 * - `random` = 每块在格内抖动中心、各自随机自转与尺寸——碎片散着铺（默认，等价于加该参数
 *   之前的画面）；
 * - `regular` = 落在格子正中、朝向统一、大小一致——整片看着是「排好的阵列」。位置、朝向、
 *   尺寸三者一起归零，故规则模式下 {@link MaskPresetParams.sizeJitter} 不生效。
 *
 * 与形状参数（边数 / 尖角 / 密度 / 尺寸）正交：同一个三角阵列既能散着摆，也能排成行列，
 * 故它是**独立于预设**的一个开关，不写进预设（预设管「摆什么形状」）。
 */
export type MaskArrangement = "random" | "regular"

/**
 * 图样空间的方向模式。
 *
 * - `parallel` = 平行条纹/斜坡（沿某个方向等距）；
 * - `radial` = 到卡心的**半径**（N 圈同心环，外密）——「径向」即「按半径」；
 * - `rays` = 绕卡心的**极角**（N 条从卡心放射的射线）。
 *
 * `radial` 与 `rays` 是一对反义坐标（半径 vs 角），取值 id 因此名副其实；只是 `radial` 的
 * 展示文案改用「光环」，把「放射」让给真正的射线 `rays`（见各端 i18n）。
 *
 * 三个消费方（光泽光带 / 摩尔纹 / 渐变）共用这一语义，但**各自独立实例化**一份参数，
 * 因此它们是同一个字面量联合、却不是同一个实例。
 */
export type PatternMode = "parallel" | "radial" | "rays"

// ─────────────────────────────────────────────────────────────────────────────
// 效果栈（Effect Stack）
//
// 把原先绑死在「卡面 material」、「图层 gradient / holoGrid / maskPreset / 渐变色」与「图层 /
// 卡面蒙版字段」上的视觉效果，统一成「挂在目标上的列表条目」。目标（卡面 / 图层）各持一个
// effects 列表，像 Blender 节点一样「需要就加上去」。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 效果的「落点角色」——决定它在渲染管线的哪一步生效，也是列表内分组的依据。
 *
 * - `phase`：作用于全息相位（渐变 = 主斜坡、摩尔纹 = 扰动取样坐标）；
 * - `color`：作用于颜色（光泽 = 往 RGB 加光带）；
 * - `alpha`：作用于 alpha 权重（程序化蒙版 = 乘权重）；
 * - `content`：图层内容（图片贴片）——不属于相位 / 颜色 / 蒙版三段通路，单列一组。
 *
 * 角色是「类型的固有属性」，由效果注册表给出，**不存进数据**——免得同一 kind 出现两种
 * 角色的非法状态。
 */
export type EffectRole = "content" | "phase" | "color" | "alpha"

/**
 * 效果种类 id。落盘进 `Effect.kind` 与注册表键，**一经发布不应改名**。
 *
 * 从 {@link Effect} 的判别式派生（类型引用与声明顺序无关），这样加一种效果只需改 `Effect`
 * 一处，`EffectKind` 自动跟上，不会漏改。
 */
export type EffectKind = Effect["kind"]

/** 所有效果共有的字段。 */
export interface EffectBase {
  /** 列表内稳定引用的 uuid（调序 / 删除 / 撤销都靠它，创建后不变）。 */
  id: string
  /** 是否启用该效果。默认 `true`。关闭时整条不参与渲染，但参数保留。 */
  enabled: boolean
}

/** 渐变参数：全息色带的空间映射（原「渐变空间」）+ 图层全局的相位设置。 */
export interface GradientParams {
  // ── 主斜坡（受 enabled 门控）──
  /** 空间模式（见 {@link PatternMode}）。默认 `"parallel"`。 */
  mode: PatternMode
  /** 跨卡色带密度（整数 1–64）。默认 31（对应改动前 (24,19) 的频率）。 */
  count: number
  /** 方向角（度，0–360）：平行模式定斜坡方向、射线模式转整扇射线。默认 38.4。 */
  angle: number
  /** 扭转强度，−1–1（转的中心与紧松由 {@link twistSeed} 决定）。默认 0。 */
  twist: number
  /**
   * 「扭转」的随机种子：0 = 绕卡心匀速（改版前的旧行为），非 0 时扭转**绕哪个点、沿卡面
   * 绞得多紧**都由它派生（见渲染器着色器的 twistPhase）。
   *
   * 它换的是扭转的「样子」，不是强度——强度始终由 {@link twist} 单独控制。种子只是个整数，
   * 哈希在着色器里算，故同一份 pack 在小程序 / 导出图里与桌面端逐像素一致。
   *
   * 上限取一百万个整数——与程序化蒙版的种子同一量级，够拖出几乎不重复的扭转样式。
   */
  twistSeed: number
  // ── 相位全局设置（不受 enabled 门控，见设计方案 §3）──
  /** UV 扭曲强度，0–1000，默认 5。 */
  distortionStrength: number
  /** 相位流动速度，0–5，默认 1。为 0 时全息图案静止。 */
  phaseSpeed: number
  /**
   * 倾斜灵敏度，0–3，默认 1：卡面法线相对「正对相机」的偏离按此倍数放大，于是转卡时花纹
   * 扫得更快 / 更慢。1 = 几何真实（存量系列逐位不变），0 = 一直是平卡的样子（倾斜不动），
   * 大于 1 时夸张。只作用于视角驱动的部分，不影响静止画面——平卡时法线就是正对方向。
   */
  tiltGain: number
  /** 逐像素噪声强度，0–1，默认 0。 */
  noiseStrength: number
  /**
   * 相邻色标之间过渡带的宽度，单位是「段长」（0–3），默认 1。
   *
   * 1 = 整段线性过渡（旧观感原样）；0 = 在色标处硬跳，色带成为纯色块；>1 = 带子跨出本段，
   * 相邻色标彼此浑融（代价：相位域两端不再落到纯首 / 纯末色）。
   * 属**相位全局设置**（不受 `enabled` 门控），与 {@link distortionStrength} 同族。
   */
  transition: number
  /**
   * 图案偏移 X（UV 域，−3–3），默认 0：平移整幅全息图案（色带、逐像素噪声、视线奇点一起走）。
   *
   * 图案是**准周期**的：色板以 cos 循环（{@link holoColor} 每 1/0.036 ≈ 27.8 相位一圈），两路取样
   * 又用 0.036 / 0.023 两个频率互相打拍子，故搬远了不会严格重复、但也不是随机——同一 offset
   * 永远同一画面。默认 density 31 下约 0.9 UV 一圈，±1 只够一圈，±3 才够把光环 / 射线中心推出卡外。
   */
  offsetX: number
  /** 图案偏移 Y。语义见 {@link offsetX}。 */
  offsetY: number
  /**
   * 整齐度，0–1，默认 0：把骑在渐变斜坡上的扰动按比例淡出，1 = 只留斜坡本身。
   *
   * 扰动有三处：视线方向项（极点附近的环绕）、三层固定正弦（斜纹 / 同心环 / 斜向条纹）、
   * 以及 `distortionStrength` 驱动的逐像素坐标位移。淡掉它们后，平行模式的色带就是笔直、
   * 等距的一条条。0 = 改版前观感逐像素不变（故取默认值）；它不是开关，中间值是线性过渡。
   */
  straight: number
}



/**
 * 摩尔纹参数：一层「刻上去」的刻蚀微纹，本身很淡，但会切开光带与渐变、并可在卡面上浮出浮雕。
 *
 * `mode = parallel` 是排线；`mode = radial` 是同心圆（外密）；`mode = rays` 是绕心放射的
 * 刻线。`depth = 0` 即完全关闭。
 */
export interface MoireParams {
  /** 形态（见 {@link PatternMode}）。默认 `"parallel"`（= 排线）。 */
  mode: PatternMode
  /** 方向角（度，0–360）：平行模式旋转排线、射线模式旋转刻线。默认 26.6（与光泽默认一致）。 */
  angle: number
  /** 纹路密度（整数 1–64）。默认 12。 */
  density: number
  /** 刻蚀深度 = 纹样高度场 / 切带扰动的强度，0–1。默认 0.25。 */
  depth: number
  /** 扭转强度，−1–1（转的中心与紧松由 {@link twistSeed} 决定）。默认 0。 */
  twist: number
  /** 「扭曲」的随机种子；0 = 绕卡心匀速。语义见 {@link GradientParams.twistSeed}。默认 0。 */
  twistSeed: number
  /**
   * 卡面浮雕强度，0–1。默认 0。
   *
   * 与 {@link depth} 的分工：`depth` 决定纹样本身的深度（既供光泽切带、也供本项浮雕），
   * `faceStrength` 只决定「有多少纹样被渲染成卡面浮雕」。0 = 卡面无浮雕（纹样只能经光泽切带
   * 被看到）；调大则把纹样当作高度场渲染成明暗，卡面呈现出凸起 / 凹陷的磨砂质感。
   */
  faceStrength: number
}

/**
 * 光泽光带参数。
 *
 * `mode = parallel` 时是 N 条平行条纹；`mode = radial` 且 `count > 0` 时是 N 圈同心亮环
 * （光盘观感）；`mode = rays` 时是 N 条从卡心放射的射线。`count = 1` 且 `mode = parallel`
 * 时退化为改动前的单条斜光带。
 */
export interface GlossParams {
  /** 光带方向模式（见 {@link PatternMode}）。默认 `"parallel"`。 */
  mode: PatternMode
  /** 光带 / 环 / 射线数量（整数 1–16）。默认 1。 */
  count: number
  /** 相邻条纹中心的间距（UV，0.02–2）。默认 0.5。射线模式下不参与计算。 */
  spacing: number
  /** 单条亮芯半宽（UV，0.005–1）。默认 0.12。射线模式下为**角**半宽（弧度）。 */
  width: number
  /**
   * 方向角（度，0–360）。平行模式旋转条纹方向、射线模式旋转整扇射线；
   * 光环（`radial`）模式下不起作用。默认 26.6（贴合改动前的斜带）。
   */
  angle: number
  /** 螺旋扭转强度，−1–1（转的中心与紧松由 {@link twistSeed} 决定）。默认 0。 */
  twist: number
  /** 「扭曲」的随机种子；0 = 绕卡心匀速。语义见 {@link GradientParams.twistSeed}。默认 0。 */
  twistSeed: number
  /** 强度，0–1。默认 0.5（= 改动前的 `uSpecularIntensity`）。 */
  intensity: number
  /**
   * 光带颜色（`#rgb` / `#rrggbb`）。**可缺省**：缺省时退回老的暖白常量
   * `(1.15, 1.10, 1.05)`，存量系列逐像素不变；设了则整条光带的加光换成该色。
   *
   * `asMask` 打开时不生效（蒙版维度不发光），UI 上也隐藏。
   */
  color?: string
  /**
   * 作为蒙版：本条目不再往颜色上叠光带，而是把光带的**覆盖率**沿祖先链向下乘给子图层——
   * 光带扫到哪里，子图层才在哪里露出来（与文字蒙版的 `text.asMask` 同一语义）。
   *
   * 默认 `false`（普通光泽）。覆盖率取核心带剖面（`width` 定半径、{@link softness} 定边缘软硬），
   * 光带随倾斜扫动，蒙版窗口也跟着扫。只在图层上有意义
   * （卡面没有子层，UI 不显示该开关）。
   */
  asMask: boolean
  /**
   * 光带整场水平平移（UV 域，正 = 图案向右挪）。默认 0。
   *
   * 与 `asMask` 的窗口共用同一场：蒙版模式下它挪的也是那扇窗口。
   */
  offsetX: number
  /** 光带整场垂直平移（UV 域，正 = 图案向上挪）。默认 0。 */
  offsetY: number
  /**
   * 羽化，0–1，默认 1：光带边缘的软硬。1 = 从中心一路渐隐到 {@link width} 处（改版前的画法，
   * 故取默认值）；0 = 只剩 1e-4 的窄过渡，读作硬边。
   *
   * 两条光带各自按自己的半径羽化：外晕（{@link width} × 4.1667 的 8% 弱光）与亮芯。
   * 作为蒙版时，{@link asMask} 的覆盖率也用同一个剖面，故它同时决定蒙版边缘的软硬。
   */
  softness: number
}

/**
 * 程序化蒙版（内置蒙版）参数：形状是「参数化的 n 边形 + 尖角」，三角 / 四边形 / 六边形 /
 * 五角星 / 圆点全是同一生成器换参数，不是各自的算法。条目存在即引用某档预设，`id` 恒为非空。
 *
 * **生成空间**：形状、格子、位移都在「卡面等比坐标」（卡高 = 1）里算，不直接拿 UV——卡片平面是
 * `PlaneGeometry(aspect, 1)` 而 uv 两轴都是 0–1，拿 UV 当几何空间会把形状横向压扁 1.4 倍
 * （等边三角变等腰）。故 {@link size} / {@link density} 都是卡高口径，且**存量系列的蒙版画面
 * 会因此改变**：修的是「空间用错」的缺陷，这里没有逐像素退回的余地。
 */
export interface MaskPresetParams {
  /** 预设 id（非空）；条目存在即引用某档预设。 */
  id: string
  /** 边数：3=三角 4=四边形碎片 5=五边形 6=六边形… 圆点 = 大边数 + spike 1。 */
  sides: number
  /** 尖角：内外半径比。1 = 规则多边形；≈0.38 + sides 5 = 五角星。 */
  spike: number
  /**
   * 不规则度（0–1）：把每个顶点的半径按「格子 + 顶点序号」的散列缩放，规则多边形于是变成
   * 随机多边形——等边三角变随机三角、正四边形 / 正五边形同理，拉高即得到碎片感。`0` = 完全
   * 规则（默认，等价于加该参数之前的画面；着色器里该项只以「乘 1.0」入场，逐位无损）。
   */
  irregular: number
  /**
   * 等边：`true` = 把形状锁成正多边形（等边三角 / 正方形 / 正六边形），{@link irregular} 随之失效
   * ——着色器里把不规则项乘 0，于是滑块拖到哪形状都不变。`false`（默认）= 交给 `irregular` 决定。
   */
  equilateral: boolean
  /** 密度：网格分辨率（沿**卡高**切多少格），也就是「碎片数量」口径——改它只改变块数。 */
  density: number
  /** 单块直径：占**卡高**的比例，与密度解耦（改它只改每块大小，块数不变）。高密度时块会相互重叠。 */
  size: number
  /** 尺寸随机抖动幅度（0–1）。规则排布下不生效（见 {@link arrangement}）。 */
  sizeJitter: number
  /** 排布方式（见 {@link MaskArrangement}）。默认 `"random"`。 */
  arrangement: MaskArrangement
  /** 位移 X，UV 域 ±1（着色器进网格前按宽高比换算，故 ±1 仍是「一整幅宽」）：整场平移。 */
  offsetX: number
  /** 位移 Y。语义见 {@link offsetX}。 */
  offsetY: number
  /** 整场左右翻转（以卡面竖直中线镜像）。整张蒙版一起翻：格子排布与每块碎片都动。 */
  flipX: boolean
  /** 整场上下翻转（以卡面水平中线镜像）。语义见 {@link flipX}。 */
  flipY: boolean
  /**
   * 整场绕卡面中心旋转的**角度**（度，0–360）。与 {@link GradientParams}.angle 同口径。
   * 在卡面等比坐标里转，故屏幕上就是真旋转。
   */
  rotation: number
  /** 随机种子：换一批布局（「重掷」按钮只改它）。 */
  seed: number
  /** 边缘柔化宽度（0 = 硬边）。抗锯齿用。 */
  softness: number
  /**
   * 是否反转蒙版。默认 `false`。
   *
   * 与 {@link MaskImageParams}.invert 语义一致（反转作用于最终权重），但**各自独立**：一个目标
   * 上若同时挂着两类蒙版，二者各持一份反转，不再共用一个图层级开关。
   */
  invert: boolean
}

/**
 * 图蒙版（自定义蒙版）参数。
 *
 * 与 {@link MaskPresetParams} 是两种**并列**的蒙版效果：本条目引用一张用户上传的图片
 * （`assets/` 下的相对路径），按亮度阈值算蒙版权重。条目存在即「用了图蒙版」；`path` 为空串
 * 表示「已添加但尚未上传图片」——此时权重恒为 1（不裁切），UI 提示去上传。
 */
export interface MaskImageParams {
  /** 蒙版图相对系列根的路径；空串表示尚未上传。默认 `""`。 */
  path: string
  /**
   * 权重来源（见 {@link MaskSource}）。默认 `"image"`，旧系列逐像素不变。
   *
   * `color` 时不用 `path`，改用 {@link color} + 阈值在卡面原图上实时匹配；蒙版自身的
   * 填充方式 / 位移 / 缩放 / 旋转照常作用于取色区域（与蒙版图同一套变换）。
   */
  source: MaskSource
  /**
   * 吸管拾取的颜色（`#rgb` / `#rrggbb`）。仅 `source === "color"` 时参与计算。默认 `"#808080"`。
   *
   * 与片元里的原图采样同处线性工作空间（`Color` 构造时完成 sRGB → 线性转换）。
   */
  color: string
  /** 蒙版语义（见 {@link MaskMode}）。默认 `"line"`。`color` 源下不参与计算。 */
  mode: MaskMode
  /**
   * 下限阈值，0–1，默认 0。
   *
   * `image` 源：line 模式下亮度低于此值即蒙版满权重；fill 模式不参与计算。
   * `color` 源：颜色距离（0–1）低于此值即完全纳入——即「容差下限」。
   */
  edge0: number
  /**
   * 上限阈值，0–1，默认 0.95（与 `edge0` 构成过渡带）。
   *
   * `image` 源：fill 模式不参与计算。`color` 源：颜色距离高于此值即完全排除——即「容差上限」。
   */
  edge1: number
  /**
   * 是否反转蒙版。默认 `false`。
   *
   * 反转作用于**最终权重**（`l = 1 - lum`），与 `mode` 正交——两种模式都吃它。
   */
  invert: boolean
  /**
   * 蒙版图水平位移（卡高单位，正 = 向右）。默认 0。
   *
   * 与 {@link ImageParams}.x 同口径：变换绕「蒙版中心」做，蒙版图默认铺满卡面。
   */
  x: number
  /** 蒙版图垂直位移（卡高单位，正 = 向上）。默认 0。 */
  y: number
  /** 蒙版图等比缩放（1 = 铺满卡面）。默认 1。 */
  scale: number
  /** 蒙版图顺时针旋转角度（度，绕蒙版中心）。默认 0。 */
  rotation: number
  /**
   * 是否跟随卡面的填充方式 / 位移 / 缩放 / 旋转。默认 `false`。
   *
   * 只是编辑期的联动标记：打开后编辑器在写卡面变换时把值抄进本条目，落盘的参数始终是
   * 具体数值——渲染器（含旧版小程序）不读这个标志，看到的永远是对齐好的画面。
   * 注意两张图宽高比不同时，同参数的画面也未必逐像素重合——这是参数级对齐的固有边界。
   */
  followFront: boolean
  /**
   * 蒙版图填充方式（见 {@link FrontFit}）。默认 `"cover"`，与底图一致。
   *
   * 加该字段之前蒙版图是被拉伸到铺满卡面的，故对「蒙版图比例 ≠ 卡面比例」的存量卡，
   * 缺省值从拉伸变覆盖会改变孔洞画面。
   */
  fit: FrontFit
}

/**
 * 图片效果参数：一张图片在卡片平面上的自由变换。
 *
 * 坐标单位一律「卡高 = 1」：x 向右、y 向上，两轴同比例（不做卡面宽高比拉伸）。
 * 尺寸由图片自身宽高比与卡片宽高比算出「宽度顶满卡宽、高度不超过卡高」的自适应基准，
 * 再乘 {@link scale}（见渲染器 `image-fit.ts`）。
 */
export interface ImageParams {
  /** 系列内相对路径；空串 = 已添加但未选择图片（合法中间态）。 */
  path: string
  /** 水平偏移（卡高单位）。正 = 向右。默认 0。 */
  x: number
  /** 垂直偏移（卡高单位）。正 = 向上。默认 0。 */
  y: number
  /** 绕图片中心旋转，角度制，正 = 屏幕上顺时针。默认 0。 */
  rotation: number
  /** 缩放倍数，1 = 自适应尺寸。默认 1。 */
  scale: number
  /**
   * 填充方式，与卡面底图的 `frontFit` 同名同义。默认 `contain`。
   *
   * 缺省是 `contain` 而非卡面的 `cover`：加该字段之前图片按「完整可见」铺，默认值必须
   * 复现旧画面（additive default 的意义），否则存量图层图片会被裁掉一圈。
   */
  fit: FrontFit
  /**
   * 跟随卡面：编辑器在卡面变换改变时把填充方式 / 位移 / 缩放 / 旋转抄进本条目。
   * 默认 `false`。渲染器不认这个标志——落盘参数始终是具体数值。
   */
  followFront: boolean
  /**
   * 法线强度（0–10）。由图片自身的亮度差生成伪法线，扰动光泽 / 摩尔纹的走势；
   * 选了法线贴图时缩放贴图的坡向（1 = 原样）。
   *
   * 默认 `0` = 本条目不开法线，图层改用卡面底图的法线（继承规则见渲染器 `bump.ts`）。
   * 其余各项只在强度 > 0 时起作用。
   */
  bumpStrength: number
  /** 法线取样步长（卡高单位，0.001–0.05）：越大越粗、细节越少。默认 `0.01`。 */
  bumpDetail: number
  /**
   * 法线对图案走势的推动比例（0–1）。0 = 只扰动光照，1 = 光泽 / 摩尔纹被推得最狠。
   * 默认 `0.5`。
   */
  bumpFlow: number
  /**
   * 高度场上的斜光明暗强度（0–1）。0 = 不出明暗、只影响图案走势（与加此字段前一致）。
   * 默认 `1`。没有光泽 / 摩尔纹可扰动时，凹凸只由这一项显形。
   */
  bumpLight: number
  /**
   * 斜光方向（度，-180–180，卡面 UV 内 +x 为 0、逆时针计：0 = 右，90 = 上）。
   * 默认 `127`，与摩尔纹浮雕的固定斜光同向；改了方向后法线明暗与摩尔纹浮雕会错开。
   */
  bumpLightAngle: number
  /** 斜光颜色（hex）。只染明暗偏离量，白 = 中性。默认 `#ffffff`。 */
  bumpLightColor: string
  /** 反转法线明暗方向（凹 ↔ 凸）。默认 `false`。 */
  bumpInvert: boolean
  /**
   * 法线贴图相对路径（切线空间，RGB 编码 XYZ）；空串 = 不选（默认）。不校验扩展名 / 存在性。
   *
   * 非空且已选文件时**整体接替**亮度伪法线：不再从图片亮度差取斜率，改为采样这张贴图。
   */
  normalPath: string
  /** 翻转法线贴图的绿通道（DirectX ↔ OpenGL 约定相反时打开）。默认 `false`。 */
  normalFlipY: boolean
}

/**
 * 蒙版擦除参数：一张与卡面同比例的黑白图，黑 = 擦掉、白 = 保留。
 *
 * 与其它蒙版效果的关系是**相乘**而非二选一：它不看蒙版是图片、颜色还是程序化生成的，
 * 一律作用在最终的 alpha 上——「只留想要的部分」对每种蒙版都成立。因为作用在整张卡面
 * （含全部图层）的输出上，它只挂在卡面、不挂图层。
 */
export interface MaskEraseParams {
  /** 系列内相对路径（PNG）；空串 = 尚未绘制（不擦除任何东西）。 */
  path: string
}

/**
 * 调色板参数：驱动全息色带调色的色标表（原 `Layer.colors`）。
 *
 * `colors` 为空表示「本目标不出全息箔」（纯蒙版，见渲染器片元的 `uHasHolo` 门）——与加该效果
 * 之前的「空色板」语义一致，故删空所有色标即等于关掉箔，不必再删掉整条效果。颜色类效果不受
 * 此限制：它们照常作用在本层的图片 / 文字上，不需要调色板开路。
 */
export type PaletteComposite = "palette" | "tint"

export interface PaletteParams {
  /** 色标（最多 8 个），`at` 为相位域位置，驱动 `spectrum()` 调色板混色。默认 `[]`。 */
  colors: ColorStop[]
  /**
   * 合成方式：
   * - `palette`：现有色带合成，全息色来自 `colors`；
   * - `tint`：叠色合成，取内容自身的 HSL、加色相偏移与网纹，再按内容对比度做 delta lerp
   *   （不读 `colors`；亮度由 HSL 提亮 + 蓝偏得到，不会整卡发白）。
   * 默认 `palette`。
   */
  composite: PaletteComposite
  /** 叠色合成：色相随相位的偏移倍率（默认 0.036）。 */
  hue: number
  /** 叠色合成：饱和度倍数（默认 1.3）。 */
  sat: number
  /** 叠色合成：向白提亮的比例（0 = 不提亮，默认 0.4）。 */
  lift: number
  /** 叠色合成：蓝偏强度（0 = 不偏色，1 = 通道权重 0.9/0.8/1.2，默认 1）。 */
  tint: number
  /** 叠色合成：混入底色的基础 delta（默认 0.2）。 */
  deltaBase: number
  /** 叠色合成：内容对比度对 delta 的加成（默认 0.3）。 */
  deltaContrast: number
  /** 叠色合成：内容亮度对 delta 的加成（默认 0.1）。 */
  deltaBright: number
}

/** 独立网格效果（holoGrid）参数：交叉网纹的密度与色相加量强度。 */
export interface HoloGridParams {
  /** 线族数（1–8），等角分布在 180° 上。默认 3（继承自原刻纹）。 */
  count: number
  /** 整幅相对角（度，0–360）。默认 0。 */
  angle: number
  /** 线频率（1–100），越大越密。默认 30。 */
  density: number
  /** 线宽（0.02–0.6），默认 1/7（latticeField 的历史阈值）。 */
  width: number
  /** 色相加量强度 0–1。默认 0.5。 */
  strength: number
  /** 卡面 UV 水平偏移（-1..1）。默认 0。 */
  offsetX: number
  /** 卡面 UV 垂直偏移（-1..1）。默认 0。 */
  offsetY: number
}

/**
 * 一个效果条目：`kind` 决定 `params` 形状。
 *
 * 与旧「专属字段」的差别只有两点：`enabled` 从各 spec 上提到 {@link EffectBase}；
 * 条目带一个稳定 `id`。参数形状（字段名 / 取值域 / 默认值）一律沿用改造前。
 */
export type Effect =
  | (EffectBase & { kind: "gradient"; params: GradientParams })
  | (EffectBase & { kind: "moire"; params: MoireParams })
  | (EffectBase & { kind: "gloss"; params: GlossParams })
  | (EffectBase & { kind: "palette"; params: PaletteParams })
  | (EffectBase & { kind: "holoGrid"; params: HoloGridParams })
  | (EffectBase & { kind: "maskPreset"; params: MaskPresetParams })
  | (EffectBase & { kind: "imageMask"; params: MaskImageParams })
  | (EffectBase & { kind: "maskErase"; params: MaskEraseParams })
  | (EffectBase & { kind: "image"; params: ImageParams })

/** 任一效果的参数类型（联合）——store 的 `updateEffect` 补丁按此收窄。 */
export type EffectParams = Effect["params"]

/**
 * 一个渐变色标：颜色 + 在相位域上的位置。
 *
 * `at` 是**相位域**位置（0 为 `spectrum()` 的相位起点，1 为终点），不是卡面上的空间位置——
 * 全息色由视角相位采样，与卡面 UV 无关（见 `card-renderer` 的 `holoColor()`）。
 */
export interface ColorStop {
  /** hex 颜色，接受 `#rgb` 与 `#rrggbb`（见 `schema.ts` 的 `HEX_COLOR`）。 */
  color: string
  /** 位置，闭区间 [0, 1]。 */
  at: number
}

/** 图层形态（见 {@link Layer.kind}）。 */
export type LayerKind = "normal" | "text"

/** 多行文本在文字块内的对齐方式。 */
export type TextAlign = "left" | "center" | "right"

/** 文字描边参数。 */
export interface TextStrokeParams {
  /** 描边颜色（hex）。 */
  color: string
  /** 描边宽度：占卡高的比例。 */
  width: number
}

/**
 * 文字投影参数。
 *
 * 「投影距离」与「投影位移」是同一件事：水平 / 垂直偏移的模长即距离，符号决定方向。
 * 羽化对应 canvas 的 shadowBlur。
 */
export interface TextShadowParams {
  /** 投影颜色（hex）。 */
  color: string
  /** 投影不透明度，0–1。 */
  opacity: number
  /** 水平偏移：占卡高的比例，正 = 右。 */
  offsetX: number
  /** 垂直偏移：占卡高的比例，正 = 上。 */
  offsetY: number
  /** 羽化半径：占卡高的比例，0 = 硬边。 */
  blur: number
}

/**
 * 文字层内容与排版参数。
 *
 * 坐标单位统一为「卡高 = 1」，x 向右、y 向上（与 {@link ImageParams} 同口径）。
 */
export interface TextParams {
  /** 文本内容；"\n" 分行。空串 = 暂无文字（不出图，也不作为蒙版裁切）。 */
  content: string
  /** 字体族名（CSS font-family 语义），如 "Microsoft YaHei"；默认 "sans-serif"。 */
  fontFamily: string
  /** 字号：占卡高的比例。 */
  fontSize: number
  /** 字重，100–900。 */
  fontWeight: number
  /** 斜体。 */
  italic: boolean
  /** 字色（hex，接受 #rgb / #rrggbb）。 */
  color: string
  /** 字间距：占卡高的比例。 */
  letterSpacing: number
  /** 行高倍数（相对字号）。 */
  lineHeight: number
  /** 多行文本在文字块内的对齐方式。 */
  align: TextAlign
  /** 文字块中心水平位置（卡高单位，正 = 右）。 */
  x: number
  /** 文字块中心垂直位置（卡高单位，正 = 上）。 */
  y: number
  /** 整块缩放倍数。 */
  scale: number
  /** 整块旋转角度（度，正 = 屏幕上顺时针）。 */
  rotation: number
  /** 描边；null = 不描边。 */
  stroke: TextStrokeParams | null
  /** 投影；null = 不投影。 */
  shadow: TextShadowParams | null
  /**
   * 作为蒙版：本层不出图，只按字形 alpha 裁切其所有下级图层。
   *
   * content 为空白时视觉上等同 false（没有字形可作蒙版）。
   */
  asMask: boolean
}

/**
 * 一个全息图层。多图层在卡片内按数组顺序叠加渲染（索引 0 位于最底层）。
 */
export interface Layer {
  /** 图层 ID（uuid v4，创建后不变，用于跨会话稳定引用）。 */
  id: string
  /**
   * 图层名；空串表示未命名，由 UI 用 i18n 生成展示名（如「图层 1」），
   * 不把展示文案写进数据，以免与语言耦合。默认 `""`。
   */
  name: string
  /** 是否启用该图层。默认 `true`。 */
  enabled: boolean
  /** 全息混合度，0–1，默认 0.9。越大全息越压过底图。 */
  holoMix: number
  /** 全息不透明度，0–1，默认 1。 */
  holoAlpha: number
  /** 与下层的混合模式（见 {@link BlendMode}）。默认 `"add"`。 */
  blend: BlendMode
  /** 图层整体不透明度，0–1，默认 1。 */
  opacity: number
  /** 图层形态。默认 "normal"（普通全息图层）。 */
  kind: LayerKind
  /** 文字参数；仅 kind === "text" 时参与渲染，普通图层恒为 null。默认 null。 */
  text: TextParams | null
  /**
   * 效果列表。渐变 / 网格 / 程序化蒙版等效果都以此挂载（见 {@link Effect}），
   * 取代改造前绑死在图层上的 gradient / holoGrid / maskPreset 三个专属字段。
   */
  effects: Effect[]
  /**
   * 子图层：挂在本层之下、被本层蒙版软裁切的图层。递归结构，默认 `[]`。
   *
   * 任意图层都能作父层。绘制时父在前、子随后（子层叠在父层之上）；子层的 alpha 再乘上其
   * **所有祖先**的蒙版权重之积，于是「父层蒙版」裁切整棵子树。深度上限见 `MAX_NEST_DEPTH`。
   */
  children: Layer[]
}

/**
 * 卡面：卡片的可渲染内容，正面卡片与系列级背面共用此结构。
 *
 * 卡面**不持有**宽高比：一个系列只有一种比例（见 {@link Pack.aspect}），否则系列级卡背
 * 无法定框——卡背是整系列共用的一张，正面各卡比例不同时它跟谁都不对齐。
 */
/** 卡面表面材质：标准（哑光）或玻璃（反射内置环境）。 */
export type CardFinish = "standard" | "glass"

export interface CardFace {
  /** 卡面图相对系列根的路径；空串表示未设置。默认 `""`。 */
  front: string
  /** 底图填充方式（见 {@link FrontFit}）。默认 `"cover"`。 */
  frontFit: FrontFit
  /**
   * 底图水平偏移，单位是卡高（正 = 图片向右移）。默认 0。
   *
   * 与 {@link ImageParams}.x 同口径、同方向；超出图片范围的部分显示卡面默认底色。
   */
  frontOffsetX: number
  /** 底图垂直偏移，单位是卡高（正 = 图片向上移）。语义见 {@link frontOffsetX}。默认 0。 */
  frontOffsetY: number
  /**
   * 底图缩放倍率（等比，1 = 不缩放）。默认 1。
   *
   * 叠在填充方式算出的图幅之上：> 1 放大图片（采样跨度变小），< 1 缩小（四周露出卡面
   * 默认底色）。
   */
  frontScale: number
  /**
   * 底图旋转角度（度，正 = 顺时针，绕图片中心）。默认 0，范围约定 ±180。
   *
   * 旋转在**卡面坐标**里做（宽按卡面宽高比换算），否则宽高比不是 1 时图片会被拉斜。
   */
  frontRotation: number
  /**
   * 卡面底图的法线强度（0–10）。由底图亮度差生成伪法线，扰动光泽 / 摩尔纹的走势，
   * 并向下继承给没有自带法线的图层。默认 0 = 关（存量画面不变）。
   */
  frontBumpStrength: number
  /** 卡面法线的取样步长（卡高单位，0.001–0.05）。默认 0.01。 */
  frontBumpDetail: number
  /** 卡面法线对图案走势的推动比例（0–1）。默认 0.5。 */
  frontBumpFlow: number
  /** 卡面法线的斜光明暗强度（0–1）。默认 1；0 = 只影响走势、不出明暗。 */
  frontBumpLight: number
  /** 卡面法线的斜光方向（度，-180–180）。默认 127（与摩尔纹浮雕同向）。 */
  frontBumpLightAngle: number
  /** 卡面法线的斜光颜色（hex）。默认 `#ffffff`（中性）。 */
  frontBumpLightColor: string
  /** 反转卡面法线的明暗方向。默认 false。 */
  frontBumpInvert: boolean
  /**
   * 卡面法线贴图相对路径（切线空间，RGB 编码 XYZ）；空串 = 不选（默认）。
   *
   * 非空时**整体接替**卡面底图的亮度伪法线，并作为继承源给没有自带法线的图层。
   */
  frontNormalPath: string
  /** 翻转卡面法线贴图的绿通道（DirectX ↔ OpenGL 约定相反时打开）。默认 false。 */
  frontNormalFlipY: boolean
  /** 卡面表面材质（见 {@link CardFinish}）。默认 `"standard"`。 */
  finish: CardFinish
  /** 玻璃强度（反射覆盖，0–1）。默认 0.6；仅 `finish = "glass"` 时生效。 */
  glassStrength: number
  /** 玻璃粗糙度（0–1，0 = 镜面，1 = 模糊反射）。默认 0.15。 */
  glassRoughness: number
  /** 玻璃染色（hex）。默认 `#ffffff`。 */
  glassTint: string
  /**
   * 圆角半径，单位是卡高（0–0.5）。默认 0.06；0.5 即完全圆头（再大与 0.5 无区别）。
   * 窄卡的可用上限还受卡宽一半限制，渲染器会按 min(值, 宽/2, 0.5) 夹取。
   */
  cornerRadius: number
  /** 效果列表。角色分组、组内顺序即作用序（见渲染层固定类型序）。默认 `[]`。 */
  effects: Effect[]
  /** 图层列表，顺序即渲染层级（索引 0 在最底）。默认 `[]`。 */
  layers: Layer[]
}

/**
 * 一张卡片：在 {@link CardFace} 的基础上补充身份与元数据。
 */
export interface Card extends CardFace {
  /** 卡片 ID（uuid v4）。 */
  id: string
  /** 条目序号（非负整数），用于展示 e1、e2… 编号。 */
  num: number
  /** 卡名。默认 `""`。 */
  name: string
  /** 备注。默认 `""`。 */
  notes: string
  /** 稀有度档位（见 {@link Rarity}），仅用于分类展示，不参与渲染。默认 `"common"`。 */
  rarity: Rarity
}

/**
 * 系列的卡册排版：固定每页 9 格（3×3），每个格子放一张卡的 id 或留空。
 *
 * 卡册是「展示」结构而非抽卡逻辑：卡片在卡册中的位置由系列作者在编辑器里摆好，
 * 小程序按此分页展示；未排版的卡片由展示层自动补到最后一页。
 */
export interface AlbumLayout {
  /** 分页列表；每页恰好 9 格，`null` 表示空格。空数组表示尚未排版。 */
  pages: (string | null)[][]
}

/**
 * 卡包图与袋面皮肤的混合方式，取值对齐 CSS `mix-blend-mode`（取小程序 WebView 支持的那几个）。
 *
 * 抽卡页的袋子由「卡包图垫底、皮肤图压在上面混合」组成：皮肤的高光、折边、锯齿封口
 * 决定袋子形状，底图只负责花色。默认 `screen`——黑底卡包图能透出底色，白线高光不丢。
 */
export type PackArtBlend =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "color-dodge"
  | "difference"
  | "lighten"

/**
 * 卡包图的填充方式，取值对齐 CSS `object-fit`（只收回小程序支持的三档）。
 *
 * - `cover` = 等比放大铺满整个袋子，超出裁掉（默认）；
 * - `fill` = 拉伸铺满（比例不合会变形）；
 * - `contain` = 整图可见，四周留空。
 */
export type PackArtFit = "cover" | "fill" | "contain"

/**
 * 抽卡页袋面的合成样式：卡包图垫底、原袋面皮肤压在上面混合。
 *
 * 编辑器里实时预览、发布时写进 `card_series`，小程序照此渲染。老系列缺该对象时
 * 解析为下列默认值，画面与加此字段前一致。
 */
export interface PackArtStyle {
  /** 上层袋面皮肤与底图的混合方式（见 {@link PackArtBlend}）。默认 `"screen"`。 */
  blend: PackArtBlend
  /** 上层袋面皮肤的不透明度，0–1。默认 `1`。 */
  opacity: number
  /** 上层袋面皮肤的亮度，1 = 原样。默认 `1`。 */
  packBrightness: number
  /** 上层袋面皮肤的对比度，1 = 原样。默认 `1`。 */
  packContrast: number
  /** 是否反相上层袋面皮肤。默认 `false`。 */
  packInvert: boolean
  /** 卡包图的填充方式（见 {@link PackArtFit}）。默认 `"cover"`。 */
  fit: PackArtFit
  /** 卡包图的横向位置（`object-position` 的 x），0–100。默认 `50`。 */
  x: number
  /** 卡包图的纵向位置（`object-position` 的 y），0–100。默认 `50`。 */
  y: number
  /** 卡包图的亮度，1 = 原样。默认 `1`。 */
  artBrightness: number
  /** 卡包图的饱和度，1 = 原样。默认 `1`。 */
  artSaturate: number
}

/**
 * 一个系列（系列），即 `pack.json` 的顶层结构，是持久化的根对象。
 */
export interface Pack {
  /** 数据格式版本，当前恒为字面量 `8`。 */
  schemaVersion: 8
  /**
   * 创建该系列时所用的编辑器版本（编辑器 + 渲染器成套，如 `"v1"`）。
   *
   * 与 {@link schemaVersion} 无关：后者管数据结构，前者管工具版本。旧系列缺此字段时
   * 解析为默认 `"v1"`，下次保存会补写进文件。
   */
  editorVersion: string
  /** 系列 ID（uuid v4）。 */
  id: string
  /** 系列名（非空）。 */
  name: string
  /** 备注。默认 `""`。 */
  notes: string
  /**
   * 系列统一的卡面宽高比（宽/高）。默认 5:7（2.5 / 3.5），范围 0.25–4。
   *
   * 整系列所有卡片与系列级卡背共用这一个值：卡背只有一张，正面各卡比例不同的话没法定框。
   * 改比例会按新比例重新摆放既有图片（contain / cover 重新取景），擦除图与蒙版图按 UV
   * 采样、也会随之拉伸——这是换比例的自然结果。
   */
  aspect: number
  /** 系列级背面卡面；`null` 表示尚未设置。默认 `null`。 */
  back: CardFace | null
  /** 普通卡片列表。默认 `[]`。 */
  cards: Card[]
  /** 隐藏款卡片列表。默认 `[]`。 */
  hiddenCards: Card[]
  /** 卡册排版（每页 3×3 的固定位置）。默认 `{ pages: [] }`，表示尚未排版。 */
  album: AlbumLayout
  /** 系列级渐变预设，以稀有度为键、hex 色标数组为值，作为图层调色板预设来源。默认 `{}`。 */
  rarityGradients: Partial<Record<Rarity, string[]>>
  /** 抽卡概率（保留字段，本阶段不参与渲染）。默认 `{}`。 */
  rarityProbabilities: Record<string, number>
  /** 合成比例，以稀有度为键、数值为值（保留字段，可缺省）。默认 `{}`。 */
  synthesisMergeRatios: Partial<Record<Rarity, number>>
  /** 大封面：系列内相对路径（`covers/<uuid>.<ext>`），5:2；空串表示没配。默认 `""`。 */
  coverLarge: string
  /** 小封面：系列内相对路径（`covers/<uuid>.<ext>`），1:1；空串表示没配。默认 `""`。 */
  coverSmall: string
  /**
   * 卡包图：抽卡页撕袋时垫在袋面皮肤下面的图，系列内相对路径（`pack-art/<uuid>.<ext>`）；
   * 空串表示没配，小程序回退用大封面。默认 `""`。
   */
  packArt: string
  /**
   * 集齐系列后解锁的头像框：系列内相对路径（`frames/<uuid>.<ext>`），1:1 静态图；
   * 空串表示这个系列没有头像框。默认 `""`。
   */
  avatarFrame: string
  /**
   * 系列成就图标：系列内相对路径（`achievement-icons/<uuid>.<ext>`），1:1 静态图；
   * 空串时成就页与解锁土司用系列封面兜底。默认 `""`。
   */
  achievementIcon: string
  /**
   * 集齐系列后解锁的系列头像：系列内相对路径（`series-avatars/<uuid>.<ext>`），1:1 静态图；
   * 空串表示这个系列没有专属头像。默认 `""`。
   */
  seriesAvatar: string
  /** 卡包图与袋面皮肤的合成样式（见 {@link PackArtStyle}）。缺省时按默认样式渲染。 */
  packArtStyle: PackArtStyle
  /** 创建时间（ISO 8601 字符串）。 */
  createdAt: string
  /** 最近更新时间（ISO 8601 字符串）。 */
  updatedAt: string
}
