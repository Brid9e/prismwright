/**
 * @prismwright/schema 的 zod 校验层：以运行时 schema 描述并校验 `pack.json` 的完整结构。
 *
 * 架构位置：本文件与 `types.ts` 的手写类型互为镜像——手写类型供编译期使用，
 * zod schema 供运行期解析与校验（同时负责缺省值填充）。二者由文件末尾的
 * **编译期双向可赋值断言**强制同步，任一侧漂移都会在 `tsc` 阶段报错。
 *
 * 「未知字段」策略：此处刻意保留 `z.object` 的默认**剥离（strip）**行为——
 * 解析时会丢弃 schema 未声明的额外字段。理由：数据演进统一交由 `schemaVersion`
 * 迁移（`migrate.ts`）负责，剥离未知字段可让已知结构保持稳定、避免陈旧字段随
 * 对象扩散；待确有兼容需求时，再通过迁移分支显式吸收新字段。
 *
 * 对外暴露：`HEX_COLOR` 正则、二十四个 schema（`RaritySchema` / `BlendModeSchema` /
 * `MaskModeSchema` / `MaskArrangementSchema` / `PatternModeSchema` / `ColorStopSchema` /
 * `LayerSchema` / `CardFaceSchema` / `CardSchema` / `PackSchema`，及效果栈的 `EffectSchema` 与
 * `GradientParamsSchema` / `MoireParamsSchema` / `GlossParamsSchema` /
 * `HoloGridParamsSchema` / `MaskPresetParamsSchema` / `MaskImageParamsSchema` / `ImageParamsSchema`，
 * 以及文字图层的 `LayerKindSchema` / `TextAlignSchema` / `TextStrokeParamsSchema` /
 * `TextShadowParamsSchema` / `TextParamsSchema`），以及 `evenlySpacedStops`、默认调色板
 * `DEFAULT_PALETTE` / `DEFAULT_STOPS` 与渐变相位默认 `DEFAULT_GRADIENT_PHASE`（渲染器侧共用这些定义）。
 */
import { z } from "zod"
import type {
  AlbumLayout,
  Card,
  CardFace,
  ColorStop,
  Effect,
  GlossParams,
  GradientParams,
  HoloGridParams,
  ImageParams,
  Layer,
  MaskEraseParams,
  MaskImageParams,
  MaskPresetParams,
  MoireParams,
  Pack,
  PackArtStyle,
  PatternMode,
  TextParams,
  TextShadowParams,
  TextStrokeParams,
} from "./types.js"

/**
 * 合法 hex 颜色正则：接受 `#rgb`（3 位）、`#rrggbb`（6 位）与 `#rrggbbaa`（8 位，带透明度）
 * 三种形式，大小写不限；不支持 4 位简写混用。
 *
 * 透明度是颜色本身的一部分（存进同一个 hex 字段），不另开字段——所有颜色字段的 schema、
 * 迁移、渲染器与编辑器控件因此不必区分「带透明度的颜色」与普通颜色。
 */
export const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * 颜色自身的透明度（0–1）：3 / 6 位视为完全不透明，8 位取末字节 / 255。
 *
 * 给渲染器与编辑器控件共用；不校验格式，调用方应先用 {@link HEX_COLOR} 判过。
 */
export function alphaOf(hex: string): number {
  const body = hex.replace("#", "")
  if (body.length !== 8) return 1
  return Number.parseInt(body.slice(6, 8), 16) / 255
}

/**
 * 把透明度写回颜色：`alpha = 1` 时回到 6 位 hex（不往数据里留没用的 `aa`），否则写 8 位。
 *
 * 3 位 hex 先展开成 6 位；输出统一小写。越界 alpha 钳制到 [0, 1]，保证结果总能被
 * {@link HEX_COLOR} 接受——否则编辑器滑到边界就可能存进打不开的数据。
 */
export function withAlpha(hex: string, alpha: number): string {
  const body = hex.replace("#", "")
  const rgb =
    body.length === 3 ? body.split("").map((c) => c + c).join("") : body.slice(0, 6)
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  const base = `#${rgb.toLowerCase()}`
  return a >= 255 ? base : `${base}${a.toString(16).padStart(2, "0")}`
}

/**
 * 卡面缺省宽高比（宽/高）：2.5 / 3.5，即 5:7。
 *
 * 与渲染器的 `CARD_ASPECT` 同值；比例现由系列持有（`Pack.aspect`），这里只是缺省值。
 */
export const DEFAULT_CARD_ASPECT = 2.5 / 3.5

/** 卡面缺省圆角半径（卡高单位）。0.5 = 完全圆头；渲染器还会按卡宽一半再夹一次。 */
export const DEFAULT_CORNER_RADIUS = 0.06

/**
 * 法线光照缺省方向（度，-180–180）：127° ≈ 摩尔纹浮雕那束固定斜光 (-0.6, 0.8) 的方向，
 * 两者的明暗因此默认同向。编辑器与渲染器共用这一个值。
 */
export const DEFAULT_CARD_BASE_COLOR = "#282830"

export const DEFAULT_BUMP_LIGHT_ANGLE = 127

/** 法线光照缺省颜色：白光 = 明暗不带色偏。schema 缺省与渲染器的「关」态共用。 */
export const DEFAULT_BUMP_LIGHT_COLOR = "#ffffff"

/** 稀有度档位枚举，取值与手写类型 `Rarity` 一致；数组顺序即由低到高的排序。 */
export const RaritySchema = z.enum(["common", "rare", "epic", "legendary"])

/**
 * 混合模式枚举，取值与手写类型 `BlendMode` 一致。
 *
 * `add` / `normal` / `screen` / `multiply` 对应 canvas 合成操作；`shadow`（暗部颜色）不是
 * 固定混合函数——图层片元按卡面底图亮度把图层色相铺到暗部、保留底图亮度，再由 normal 合成。
 */
export const BlendModeSchema = z.enum(["add", "normal", "screen", "multiply", "shadow"])

/** 蒙版语义枚举，取值与手写类型 `MaskMode` 一致。 */
export const MaskModeSchema = z.enum(["line", "fill"])

/** 底图填充方式枚举，取值与手写类型 `FrontFit` 一致。 */
export const FrontFitSchema = z.enum(["cover", "contain", "stretch"])

/** 卡包图混合方式枚举，取值与手写类型 `PackArtBlend` 一致（对应 CSS mix-blend-mode）。 */
export const PackArtBlendSchema = z.enum([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "color-dodge",
  "difference",
  "lighten",
])

/** 卡包图填充方式枚举，取值与手写类型 `PackArtFit` 一致（对应 CSS object-fit 的三档）。 */
export const PackArtFitSchema = z.enum(["cover", "fill", "contain"])

/** 卡包图合成样式的缺省值：与原皮肤直接铺满的画面一致。 */
export const DEFAULT_PACK_ART_STYLE = {
  blend: "screen",
  opacity: 1,
  packBrightness: 1,
  packContrast: 1,
  packInvert: false,
  fit: "cover",
  x: 50,
  y: 50,
  artBrightness: 1,
  artSaturate: 1,
} as const

/** 卡包图合成样式校验 schema：卡包图垫底、袋面皮肤压在混合。 */
export const PackArtStyleSchema = z.object({
  blend: PackArtBlendSchema.default("screen"),
  opacity: z.number().min(0).max(1).default(1),
  packBrightness: z.number().min(0.2).max(2).default(1),
  packContrast: z.number().min(0.2).max(2).default(1),
  packInvert: z.boolean().default(false),
  fit: PackArtFitSchema.default("cover"),
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(50),
  artBrightness: z.number().min(0.2).max(2).default(1),
  artSaturate: z.number().min(0).max(2).default(1),
})

/** 自定义蒙版的权重来源枚举，取值与手写类型 `MaskSource` 一致。 */
export const MaskSourceSchema = z.enum(["image", "color"])

/** 程序化蒙版排布枚举，取值与手写类型 `MaskArrangement` 一致。 */
export const MaskArrangementSchema = z.enum(["random", "regular"])

/**
 * 图样空间的方向模式枚举，取值与手写类型 `PatternMode` 一致。
 *
 * 枚举顺序即语义的坐标轴：`parallel`（方向投影）→ `radial`（半径）→ `rays`（极角），
 * 与着色器里的整型码 0/1/2 一一对应（见 `@prismwright/renderer` 的 `patternModeCode`）。
 */
export const PatternModeSchema = z.enum(["parallel", "radial", "rays"])

/**
 * 渐变相位全局项的默认值：既作 `GradientParamsSchema` 各字段的 `.default()`，又作渲染器
 * 「无渐变效果」时的回落值。**单一来源**——两处若各写一份数字，迟早分叉。
 */
export const DEFAULT_GRADIENT_PHASE: Pick<
  GradientParams,
  | "distortionStrength"
  | "phaseSpeed"
  | "tiltGain"
  | "noiseStrength"
  | "transition"
  | "offsetX"
  | "offsetY"
> = {
  distortionStrength: 5,
  phaseSpeed: 1,
  tiltGain: 1,
  noiseStrength: 0,
  transition: 1,
  offsetX: 0,
  offsetY: 0,
}

/**
 * 「扭转 / 扭曲」的随机种子（0 = 绕卡心匀速，即改版前的旧行为）。
 *
 * 渲染期参数：着色器据它派生扭转的中心与沿卡面的紧松，故换种子换的是扭转的「样子」（见
 * `GradientParams.twistSeed`）。上限取一百万个整数——与程序化蒙版的种子同一量级；着色器里
 * 再按 2048 取模落进哈希的安全区间（见 twistPhase）。
 */
const TwistSeedSchema = z.number().int().min(0).max(1000000).default(0)

/** 单个色标：颜色 + 相位域位置。 */
export const ColorStopSchema = z.object({
  color: z.string().regex(HEX_COLOR),
  at: z.number().min(0).max(1),
})

/**
 * 色标在 `total` 个色标里的等距位置。
 *
 * 与 CSS 渐变不给百分比时的默认一致：首尾落在 0 与 1，中间的均分 `[0, 1]`，即
 * `0, 1/(N-1), …, 1`。中间色标左右两侧的过渡带因此等长，这是「看上去最均匀」的排法。
 *
 * `total === 1` 时位置没有视觉意义（整条相位都是它），取中点让游标落在色带中央。
 */
function evenAt(index: number, total: number): number {
  return total <= 1 ? 0.5 : index / (total - 1)
}

/**
 * 色标数组的元素：既接受旧格式（裸 hex 字符串，0.1.0 及以前写出的 `pack.json` 里就是它），
 * 也接受新格式（带 `at` 的对象）。
 *
 * 用 union 而不是 `z.preprocess`：preprocess 会把该字段的**输入类型**放宽成 `unknown`，
 * 而 union 让输入保持 `(string | ColorStop)[]`，并天然接受「部分迁移」的混合数组。
 */
const ColorStopInputSchema = z.union([z.string().regex(HEX_COLOR), ColorStopSchema])

/**
 * 解析期归一化：旧格式的字符串按它在数组中的下标等距展开，然后按 `at` 升序**稳定**排序。
 *
 * 排序放在这里而不是渲染期，是因为位置的单调不减是着色器的前置条件（累积混合依赖它）——
 * 在数据边界上一次做掉，渲染器就不必每帧防御。`Array.prototype.sort` 在 V8 上稳定，
 * `at` 相同者保持原有顺序。
 */
function normalizeStops(raw: readonly (string | ColorStop)[]): ColorStop[] {
  const stops = raw.map((item, index): ColorStop =>
    typeof item === "string" ? { color: item, at: evenAt(index, raw.length) } : { ...item },
  )
  return stops.sort((a, b) => a.at - b.at)
}

/** 渐变参数 schema：色标 / 合成 + 全息色带的空间映射 + 图层全局的相位设置。 */
export const GradientParamsSchema = z.object({
  // 原 PaletteParams（schema v10 并入）：色标 / 合成方式 / 叠色参数。
  colors: z.array(ColorStopInputSchema).max(8).default([]).transform(normalizeStops),
  composite: z
    .enum(["palette", "tint", "balatro"])
    .default("palette")
    // 旧数据里的 balatro 落到 tint：数据里不再保留来源名。
    .transform((v) => (v === "balatro" ? "tint" : v)),
  hue: z.number().min(0).max(0.2).default(0.036),
  sat: z.number().min(0).max(2).default(1.3),
  lift: z.number().min(0).max(1).default(0.4),
  tint: z.number().min(0).max(1).default(1),
  deltaBase: z.number().min(0).max(1).default(0.2),
  deltaContrast: z.number().min(0).max(1).default(0.3),
  deltaBright: z.number().min(0).max(1).default(0.1),

  mode: PatternModeSchema.default("parallel"),
  count: z.number().int().min(1).max(64).default(31),
  angle: z.number().min(0).max(360).default(38.4),
  twist: z.number().min(-1).max(1).default(0),
  twistSeed: TwistSeedSchema,
  distortionStrength: z
    .number()
    .min(0)
    .max(1000)
    .default(DEFAULT_GRADIENT_PHASE.distortionStrength),
  phaseSpeed: z.number().min(0).max(5).default(DEFAULT_GRADIENT_PHASE.phaseSpeed),
  // 倾斜灵敏度：卡面法线相对「正对相机」的偏离按此倍数放大，于是转卡时花纹扫得更快 / 更慢。
  // 1 = 几何真实（默认，逐位等于改版前）；0 = 平卡的样子、倾斜完全不动；>1 = 夸张。
  // 只缩放法线——平卡时法线恒为 (0,0,1)，故任何增益都不改动静止画面（见 shaders/layer.ts）。
  tiltGain: z.number().min(0).max(3).default(DEFAULT_GRADIENT_PHASE.tiltGain),
  noiseStrength: z.number().min(0).max(1).default(DEFAULT_GRADIENT_PHASE.noiseStrength),
  // 过渡带宽度 = 段长 × transition。1 = 一整段线性过渡（旧观感）；0 = 在色标处硬跳；>1 时过渡带
  // 跨出本段、相邻色标浑融（代价：m 两端不再落到纯首 / 纯末色）。上限 3 是「再大只剩浑融」的经验值。
  transition: z.number().min(0).max(3).default(DEFAULT_GRADIENT_PHASE.transition),
  // 偏移 ±3（UV 域，整卡高 = 1）：图案是准周期的——色板以 cos 循环，两路取样（0.036 / 0.023）
  // 又互相打拍子，默认 density 31 下约 0.9 UV 就走完一圈色板。±1 只够一圈，搬不动「整幅图案」
  // 的构图（把光环 / 射线的中心推出卡外、把噪声带挪到另一边都要更远）；±3 到那儿为止，再大只剩重复。
  offsetX: z.number().min(-3).max(3).default(DEFAULT_GRADIENT_PHASE.offsetX),
  offsetY: z.number().min(-3).max(3).default(DEFAULT_GRADIENT_PHASE.offsetY),
  // 整齐：1 = 只留渐变斜坡本身，色带笔直等距；0 = 保留方向项 / 固定正弦 / 逐像素噪声位移
  // 这些扰动（改版前的观感）。schema v10 起默认 1：新建渐变默认整齐；旧数据里落盘的 0 不被改写。
  straight: z.number().min(0).max(1).default(1),
})



/** 摩尔纹参数 schema（无 enabled）。 */
export const MoireParamsSchema = z.object({
  mode: PatternModeSchema.default("parallel"),
  angle: z.number().min(0).max(360).default(26.6),
  // 上限 64 已确认：摩尔纹比光带密得多，上限放宽但仍有界。
  density: z.number().int().min(1).max(64).default(12),
  depth: z.number().min(0).max(1).default(0.25),
  twist: z.number().min(-1).max(1).default(0),
  twistSeed: TwistSeedSchema,
  // 内容浮雕强度：把摩尔纹当作图层内容的一层高度场渲染成明暗。默认 1 = 保持图层内容浮雕的
  // 现有行为；旧面级 moire 的 faceStrength 在 v9 迁移时映射到这里。
  contentRelief: z.number().min(0).max(1).default(1),
})

/** 光泽光带参数 schema（无 enabled）。 */
export const GlossParamsSchema = z.object({
  mode: PatternModeSchema.default("parallel"),
  // 上限 16 已确认：GLSL 里的定长循环上界即取这个数（见 base.ts）。
  count: z.number().int().min(1).max(16).default(1),
  spacing: z.number().min(0.02).max(2).default(0.5),
  // 上限 1 = 「整幅都亮着」的大光晕；再宽只会把卡片洗白，不再是光带。
  width: z.number().min(0.005).max(1).default(0.12),
  angle: z.number().min(0).max(360).default(26.6),
  twist: z.number().min(-1).max(1).default(0),
  twistSeed: TwistSeedSchema,
  intensity: z.number().min(0).max(1).default(0.5),
  // 光带颜色。**不设默认值**是刻意的：缺省时着色器退回老的暖白常量
  // `(1.15, 1.10, 1.05)`，存量系列逐像素不变；一旦补默认 hex，老卡的光带颜色就会变。
  color: z.string().regex(HEX_COLOR).optional(),
  // 作为蒙版：光带场不再上色，而是变成覆盖率向下裁切子图层（见 types.ts 的注释）。
  // 默认 false = 普通光泽，存量行为不变。
  asMask: z.boolean().default(false),
  // 光带整场平移（UV 域，正 = 图案往右 / 往上挪）。与网格的 offsetX 同口径、同量程；
  // 缺省 0 = 钉在原来位置，存量画面逐像素不变。新增字段带默认值，故不必升 schemaVersion。
  offsetX: z.number().min(-1).max(1).default(0),
  offsetY: z.number().min(-1).max(1).default(0),
  // 羽化：光带边缘从「宽度」往内渐隐的比例。1 = 从中心一路渐隐（改版前的画法，故取默认值，
  // 存量系列逐像素不变）；0 = 只剩 1e-4 的窄过渡，读作硬边。新增字段带默认值，不必升 schemaVersion。
  softness: z.number().min(0).max(1).default(1),
})

/** 程序化蒙版（内置蒙版）参数 schema：`id` 必填非空（条目存在即引用某档预设）。 */
export const MaskPresetParamsSchema = z.object({
  // id 只当字符串（非空），**不**加枚举约束：预设是前端注册表的概念，加枚举会让
  // 「注册表加一条就要改 schema」——与「预设可后期扩充」的目标冲突。
  // 但拒空串：条目存在即「启用程序化蒙版」，而 "" 不是任何真实预设，
  // 手改 pack.json 写进去会拿默认形状意外开启蒙版。
  id: z.string().min(1),
  // 边数上限 64：足够逼近圆点（大边数 + spike 1 ≈ 圆），且哈希输入仍是小整数（见 common.ts）。
  // **生成空间**：形状、格子、位移全在「卡面等比坐标」（卡高 = 1）里算，不直接拿 UV——卡片平面是
  // PlaneGeometry(aspect, 1)，uv 两轴都是 0–1，于是 u 跨 0.714、v 跨 1，拿 UV 当几何空间会把形状
  // 横向压扁 1.4 倍（等边三角变等腰）。故 size / density / 位移量都是卡高口径，
  // 且**存量系列的蒙版画面会因此改变**——修的是「空间用错」的缺陷，这里没有逐像素退回的余地。
  sides: z.number().int().min(3).max(64).default(4),
  // spike = 内外半径比。实现里会再乘 cos(π/sides)（见 common.ts 的 shardField），使
  //   spike=1      → 外顶点与内顶点重合到「正 n 边形」的边中点 → 规则多边形（直边）；
  //   spike≈0.38,5 → 五角星；
  //   大 sides + spike=1 → 近圆（圆点）。
  spike: z.number().min(0.1).max(1).default(1),
  // 不规则度：每个顶点的半径按 (格子, 顶点序号) 的散列缩放，规则多边形 → 随机多边形（碎片感）。
  // 默认 0 = 完全规则，存量系列解析后逐像素不变（着色器里该项只以「乘 1.0」入场）。
  irregular: z.number().min(0).max(1).default(0),
  // 等边：开 = 把形状锁成正多边形（等边三角 / 正方形 / 正六边形），不规则滑块随之失效
  // （着色器里把不规则项乘 0）。默认 false = 交给 irregular 决定，存量系列解析后逐像素不变。
  equilateral: z.boolean().default(false),
  // density = 网格分辨率：沿卡高切多少格（＝碎片数量口径，与 size 解耦）。
  density: z.number().int().min(1).max(64).default(14),
  // size = 单块直径占**卡高**的比例（卡面等比坐标口径，与密度解耦）。下界留出「小到近乎消失」的余量；上界 0.3 取在
  // 默认密度(14)下半径正好撑满 5×5 邻域处（0.5 × 0.3 × 14 ≈ 2 格），再大也已被邻块盖满。
  size: z.number().min(0.01).max(0.3).default(0.06),
  sizeJitter: z.number().min(0).max(1).default(0.5),
  // 默认 random：这正是加该参数之前的画面（中心抖动 ±0.3 格、逐块随机自转与尺寸），
  // 存量系列解析后逐像素不变。regular 见 types.ts 的 MaskArrangement。
  arrangement: MaskArrangementSchema.default("random"),
  // 位移取 ±1，与网格 / GradientParams 的 offsetX 同口径（UV 域），进网格前按 uAspect 换算成
  // 等比坐标（故 ±1 仍是「一整幅宽 / 高」）。默认 0 = 不位移。
  offsetX: z.number().min(-1).max(1).default(0),
  offsetY: z.number().min(-1).max(1).default(0),
  // 整场翻转：把整张蒙版当贴图镜像——格子排布与每块碎片一起翻，不是只翻单块。默认关 = 与加该
  // 参数之前的画面逐像素一致（着色器里以「乘 1 加 0」入场）。
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
  // 整场旋转（度）：与 GradientParams.angle / 网格.angle 同口径，换算弧度交给着色器。默认 0；
  // 着色器里写成 R*iso + (c - R*c)，故 0° 时采样点逐位不动（而非差 1 ulp）。在等比坐标里转
  // ⇒ 屏幕上就是真旋转（转 90° 后碎片与格子的朝向也真差 90°）。
  rotation: z.number().min(0).max(360).default(0),
  // 种子须为整数：它直接进哈希输入，非整数会让「重掷」相邻取值产出同一批布局。
  seed: z.number().int().min(0).max(1e6).default(1),
  softness: z.number().min(0).max(0.5).default(0.02),
  // 是否反转蒙版：与图蒙版的 invert 语义一致（反转作用于最终权重），但两类蒙版各持一份。
  // 默认 false = 存量系列逐像素不变（着色器里以「mix(s, 1-s, 0)」退化为不反转）。
  invert: z.boolean().default(false),
})

/**
 * 图蒙版（自定义蒙版）参数 schema。
 *
 * 与 {@link MaskPresetParamsSchema} 并列的另一种蒙版效果：引用一张用户上传的图，按亮度阈值算
 * 蒙版权重。`path` 为空串表示「已添加但未上传」，是合法中间态（权重恒为 1，不裁切）。
 */
export const MaskImageParamsSchema = z.object({
  path: z.string().default(""),
  // 颜色源（吸管拾色）新增字段：缺省仍按图片蒙版，旧系列解析后逐像素不变，故不必升 schemaVersion。
  source: MaskSourceSchema.default("image"),
  color: z.string().regex(HEX_COLOR).default("#808080"),
  mode: MaskModeSchema.default("line"),
  edge0: z.number().min(0).max(1).default(0),
  edge1: z.number().min(0).max(1).default(0.95),
  invert: z.boolean().default(false),
  // 蒙版图的变换：新增字段带默认值（additive default），故不必升 schemaVersion。缺省即恒等
  // （蒙版图铺满卡面），旧系列解析后与加字段之前逐像素一致。
  x: z.number().default(0),
  y: z.number().default(0),
  scale: z.number().default(1),
  rotation: z.number().default(0),
  // 跟随卡面：打开后编辑器在写卡面变换时同步填充方式 / 位移 / 缩放 / 旋转，
  // 落盘的仍是具体数值——渲染器不认这个标志，旧版本读到的也是对齐好的画面。
  // 新增字段带默认值（additive default），故不必升 schemaVersion。
  // 填充方式与底图同名同义、缺省也一致（覆盖）。注意：加该字段之前蒙版图是被拉伸到铺满
  // 卡面的，故对「蒙版图比例 ≠ 卡面比例」的存量卡，缺省值从拉伸变覆盖会改变孔洞画面。
  fit: FrontFitSchema.default("cover"),
})

/**
 * 蒙版擦除参数 schema。
 *
 * 只有一条路径：图由编辑器里的画笔生成（与卡面同比例、黑 = 擦掉），没有可调参数——
 * 要改就再画一次。`path` 为空串表示「已添加但还没画」，是合法中间态（不擦除）。
 */
export const MaskEraseParamsSchema = z.object({
  path: z.string().default(""),
})

/**
 * 图片效果参数 schema。
 *
 * 取值范围与渲染器注册表里四个滑块的 min / max / step 逐字一致（由 renderer 的注册表测试
 * 从两侧对照）。`path` 不校验扩展名 / 存在性——与 `MaskImageParamsSchema.path` 同口径。
 */
export const ImageParamsSchema = z.object({
  path: z.string().default(""),
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  rotation: z.number().min(-180).max(180).default(0),
  scale: z.number().min(0.1).max(4).default(1),
  // 填充方式：与卡面底图同名同义（见 FrontFitSchema）。缺省 `contain` 是刻意的——加该字段
  // 之前图片按 `fitImageSize` 铺，效果等价「完整可见」，缺省取 cover 会把存量图层的图裁掉一圈。
  // 新增字段带默认值（additive default），故不必升 schemaVersion。
  fit: FrontFitSchema.default("contain"),
  // 跟随卡面：打开后编辑器在写卡面变换时同步填充方式 / 位移 / 缩放 / 旋转，
  // 落盘的仍是具体数值——渲染器不认这个标志，旧版本读到的也是对齐好的画面。
  // 新增字段带默认值（additive default），故不必升 schemaVersion。
  // 法线（bump）：由图片自身的亮度差生成，扰动光泽 / 摩尔纹的走势。
  // 强度 0（默认）= 本条目不开，图层沿用卡面底图的法线（见渲染器 bump.ts 的继承规则）；
  // 上限 10：法线贴图的坡向量级比亮度差大，需要更大的强度才够「凸」。
  // 其余各项只在强度 > 0 时起作用。细节是取样步长（卡高单位），流向是图案被推着走的比例，
  // 光照是高度场上那束斜光的明暗强度（0 = 只影响走势、不出明暗）、方向与颜色。方向缺省 127°
  // = 与摩尔纹浮雕的固定斜光同向（(-0.6, 0.8)）；白光缺省 = 明暗不带色偏。
  // 新增字段带默认值（additive default），故不必升 schemaVersion。
  bumpStrength: z.number().min(0).max(10).default(0),
  bumpDetail: z.number().min(0.001).max(0.05).default(0.01),
  bumpFlow: z.number().min(0).max(1).default(0.5),
  bumpLight: z.number().min(0).max(1).default(1),
  bumpLightAngle: z.number().min(-180).max(180).default(DEFAULT_BUMP_LIGHT_ANGLE),
  bumpLightColor: z.string().regex(HEX_COLOR).default(DEFAULT_BUMP_LIGHT_COLOR),
  bumpInvert: z.boolean().default(false),
  // 法线贴图：与图片配套的切线空间法线图（RGB 编码 XYZ），非空时整体接替亮度伪法线。
  // 空串（默认）= 不选，沿用亮度伪法线或继承卡面的（见渲染器 bump.ts）。
  // 新增字段带默认值（additive default），故不必升 schemaVersion。
  normalPath: z.string().default(""),
  // 绿通道翻转（DirectX ↔ OpenGL 约定）：法线图的 Y 分量朝向反了时打开。
  normalFlipY: z.boolean().default(false),
})

/**
 * 图层嵌套的深度上限：单个图层**祖先链**的最大长度。
 *
 * 渲染器用固定长度（= 本值）的 sampler 数组承载「祖先蒙版」，而 GLSL 数组长度须在编译期
 * 确定，故深度封顶。编辑器与渲染器共用此常量，避免两处各写一个 4。
 */
export const MAX_NEST_DEPTH = 4

/**
 * 把颜色数组按下标等距展开为色标。
 *
 * {@link DEFAULT_STOPS} 由它展开得到——等距公式只有这一份。
 */
export function evenlySpacedStops(colors: readonly string[]): ColorStop[] {
  return colors.map((color, index) => ({ color, at: evenAt(index, colors.length) }))
}

/**
 * 默认调色板（金 → 蓝 → 紫，沿用早期全息 overlay 的配色）。
 *
 * 只在这一处定义，渲染器侧共用：`colors` 为空时拿 {@link DEFAULT_STOPS} 填满定长 uniform
 * （内容不会被采样，见 `@prismwright/renderer` 的 `palette.ts`——「空色板」现在表示该层不出全息，
 * 由 `uHasHolo` 门控）。
 */
export const DEFAULT_PALETTE: readonly string[] = ["#FFD700", "#0099FF", "#B266FF"]

/** 默认色标：{@link DEFAULT_PALETTE} 的等距展开。 */
export const DEFAULT_STOPS: readonly ColorStop[] = evenlySpacedStops(DEFAULT_PALETTE)

/** 独立网格效果（holoGrid）：交叉网纹的密度 + 色相加量强度。 */
export const HoloGridParamsSchema = z.object({
  count: z.number().int().min(1).max(8).default(3),
  angle: z.number().min(0).max(360).default(0),
  density: z.number().int().min(1).max(100).default(30),
  width: z.number().min(0.02).max(0.6).default(1 / 7),
  strength: z.number().min(0).max(1).default(0.5),
  offsetX: z.number().min(-1).max(1).default(0),
  offsetY: z.number().min(-1).max(1).default(0),
})

/**
 * 效果条目 schema：按 `kind` 判别的联合。
 *
 * 刻意逐个写全（而非用工厂泛型收敛）——`z.discriminatedUnion` 依赖每个分支的
 * discriminant 是字面量类型，逐项显式书写最不易被类型收窄悄悄改坏。
 */
/** 文字对齐枚举，取值与手写类型 `TextAlign` 一致。 */
export const TextAlignSchema = z.enum(["left", "center", "right"])

/** 图层形态枚举，取值与手写类型 `LayerKind` 一致。 */
export const LayerKindSchema = z.enum(["normal", "text", "adjustment"])

/** 文字描边 schema：颜色 + 宽度（卡高比例）。 */
export const TextStrokeParamsSchema = z.object({
  color: z.string().regex(HEX_COLOR).default("#000000"),
  width: z.number().min(0.001).max(0.05).default(0.004),
})

/** 文字投影 schema：颜色 / 不透明度 / 位移 / 羽化。 */
export const TextShadowParamsSchema = z.object({
  color: z.string().regex(HEX_COLOR).default("#000000"),
  opacity: z.number().min(0).max(1).default(0.6),
  offsetX: z.number().min(-0.2).max(0.2).default(0.02),
  offsetY: z.number().min(-0.2).max(0.2).default(-0.02),
  blur: z.number().min(0).max(0.3).default(0.02),
})

/**
 * 文字层参数 schema。
 *
 * 默认值只在这里写一份：默认值工厂、UI 的滑块复位目标都从它取，避免两处漂移。
 */
export const TextParamsSchema = z.object({
  content: z.string().default(""),
  fontFamily: z.string().default("sans-serif"),
  fontSize: z.number().min(0.02).max(0.6).default(0.12),
  fontWeight: z.number().int().min(100).max(900).default(400),
  italic: z.boolean().default(false),
  color: z.string().regex(HEX_COLOR).default("#ffffff"),
  letterSpacing: z.number().min(0).max(0.3).default(0),
  lineHeight: z.number().min(0.8).max(3).default(1.2),
  align: TextAlignSchema.default("center"),
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  scale: z.number().min(0.1).max(4).default(1),
  rotation: z.number().min(-180).max(180).default(0),
  stroke: TextStrokeParamsSchema.nullable().default(null),
  shadow: TextShadowParamsSchema.nullable().default(null),
  asMask: z.boolean().default(false),
})

export const EffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("gradient"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: GradientParamsSchema,
  }),
  z.object({
    kind: z.literal("moire"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: MoireParamsSchema,
  }),
  z.object({
    kind: z.literal("gloss"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: GlossParamsSchema,
  }),
  z.object({
    kind: z.literal("holoGrid"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: HoloGridParamsSchema,
  }),
  z.object({
    kind: z.literal("maskPreset"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: MaskPresetParamsSchema,
  }),
  z.object({
    kind: z.literal("imageMask"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: MaskImageParamsSchema,
  }),
  z.object({
    kind: z.literal("maskErase"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: MaskEraseParamsSchema,
  }),
  z.object({
    kind: z.literal("image"),
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    params: ImageParamsSchema,
  }),
])

/**
 * 图层校验 schema。所有可省略字段都会在解析结果里补齐。
 * 数值上下限与设计规格一致（见各字段 `max`）。
 *
 * 递归：`children` 用 `z.lazy` 自引用，任意图层都可作父层。显式标注
 * `z.ZodType<Layer, z.ZodTypeDef, unknown>` 有两个作用——(1) 解开 `z.lazy` 自引用导致的
 * 类型循环（否则 TS 报「隐式 any」）；(2) 把**输入**放宽为 `unknown`，从而保留「只喂入
 * `{ id, name }` 也能解析」的宽松种子（默认值工厂 `createLayer` 依赖它）。输出仍是精确的 `Layer`。
 */
/** 旧数据里的刻纹已并入网格：解析前丢弃，包照常打开。 */
const EffectsSchema: z.ZodType<Effect[], z.ZodTypeDef, unknown> = z
  .preprocess(
    (v) =>
      Array.isArray(v)
        ? v.filter(
            (e) =>
              !(e && typeof e === "object" && (e as { kind?: unknown }).kind === "lattice")
          )
        : v,
    z.array(EffectSchema),
  )
  .default([]) as z.ZodType<Effect[], z.ZodTypeDef, unknown>

export const LayerSchema: z.ZodType<Layer, z.ZodTypeDef, unknown> = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  enabled: z.boolean().default(true),
  holoMix: z.number().min(0).max(1).default(0.9),
  holoAlpha: z.number().min(0).max(1).default(1),
  blend: BlendModeSchema.default("add"),
  opacity: z.number().min(0).max(1).default(1),
  // 图层形态与文字参数：两个都是 additive default（旧数据解析为 normal / null），
  // 故不必升 schemaVersion。见 docs/superpowers/specs/2026-10-30-text-layer-design.md §3.5。
  kind: LayerKindSchema.default("normal"),
  text: TextParamsSchema.nullable().default(null),
  // 效果栈列表：渐变 / 调色板 / 网格 / 蒙版等效果都以此挂载。
  effects: EffectsSchema,
  // 子图层（递归）：任意图层都可作父层。默认 []。
  children: z.array(z.lazy(() => LayerSchema)).default([]),
})

/** 卡面校验 schema（正面与系列级背面共用）。 */
/** 卡面表面材质：标准 / 玻璃。 */
export const CardFinishSchema = z.enum(["standard", "glass"])

export const CardFaceSchema = z.object({
  // 卡片画布底色：没有图层覆盖时垫的颜色。默认深灰，旧系列解析后画面不变。
  baseColor: z.string().regex(HEX_COLOR).default(DEFAULT_CARD_BASE_COLOR),
  // 表面材质：玻璃会叠一层环境反射（见渲染器的玻璃 overlay）。默认标准，旧数据逐像素不变。
  finish: CardFinishSchema.default("standard"),
  glassStrength: z.number().min(0).max(1).default(0.6),
  glassRoughness: z.number().min(0).max(1).default(0.15),
  glassTint: z.string().regex(HEX_COLOR).default("#ffffff"),
  // 卡面形状：只剩圆角（卡高单位，0.5 = 完全圆头）。
  cornerRadius: z.number().min(0).max(0.5).default(DEFAULT_CORNER_RADIUS),
  // 唯一的内容与效果来源：图层树。旧的 front / 面级 effects 由 v9 迁移进图层。
  layers: z.array(LayerSchema).default([]),
})

/** 卡片校验 schema：在卡面基础上扩展身份与元数据字段。 */
export const CardSchema = CardFaceSchema.extend({
  id: z.string().min(1),
  num: z.number().int().nonnegative(),
  name: z.string(),
  notes: z.string().default(""),
  rarity: RaritySchema.default("common"),
})

/** 卡册每页的格数：固定 3×3。 */
export const ALBUM_PAGE_SIZE = 9

/** 卡册排版校验 schema：每页恰好 9 格，格子是卡片 id 或 `null`。 */
export const AlbumLayoutSchema = z.object({
  pages: z
    .array(z.array(z.string().min(1).nullable()).length(ALBUM_PAGE_SIZE))
    .default([]),
})

/** 系列校验 schema，即 `pack.json` 的顶层结构。 */
export const PackSchema = z.object({
  schemaVersion: z.literal(10),
  // 创建该系列时所用的编辑器版本（编辑器 + 渲染器成套，如 "v1"）。与 `schemaVersion`
  // 是两回事：后者是**数据结构**版本，前者是**工具**版本。旧系列缺此字段时按 "v1" 解析
  // （additive default，故不必升 schemaVersion）。
  editorVersion: z
    .string()
    .regex(/^v\d+$/, "编辑器版本应形如 v1、v2")
    .default("v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  notes: z.string().default(""),
  // 系列统一比例（宽/高）。v8 起从每张卡上收到这里：卡背是整系列共用的一张，
  // 正面各卡比例不同就没法定框。v7 及更早的数据由 `migrate` 上抬（取用得最多的比例）。
  aspect: z.number().min(0.25).max(4).default(DEFAULT_CARD_ASPECT),
  back: CardFaceSchema.nullable().default(null),
  cards: z.array(CardSchema).default([]),
  hiddenCards: z.array(CardSchema).default([]),
  // 卡册固定位置（每页 3×3）。新旧客户端都按 additive default 读取，不升 schemaVersion。
  album: AlbumLayoutSchema.default({ pages: [] }),
  // 以稀有度枚举为键（与 rarityGradients 写法一致），键可缺省，输出为 Partial Record。
  rarityGradients: z.record(RaritySchema, z.array(z.string().regex(HEX_COLOR))).default({}),
  rarityProbabilities: z.record(z.string(), z.number()).default({}),
  synthesisMergeRatios: z.record(RaritySchema, z.number()).default({}),
  // 系列封面：作者自己出的 5:2 / 1:1 图。additive default，老系列解析后为空串，
  // 故不必升 schemaVersion。
  coverLarge: z.string().default(""),
  coverSmall: z.string().default(""),
  // 卡包图：抽卡页撕袋时垫在袋面皮肤下面的图（任意比例，覆盖整个袋面）。
  // additive default，老系列解析后为空串；空串时小程序回退用大封面。
  packArt: z.string().default(""),
  // 集齐该系列后解锁的头像框图（1:1，静态图）。空串表示这个系列没有框。
  avatarFrame: z.string().default(""),
  // 系列成就图标（1:1 静态图）；空串时成就页与土司回退用系列封面。
  achievementIcon: z.string().default(""),
  // 集齐该系列后解锁的系列头像（1:1 静态图）。空串表示这个系列没有头像。
  seriesAvatar: z.string().default(""),
  // 卡包图与袋面皮肤的合成样式。additive default，老系列补默认值，故不必升 schemaVersion。
  packArtStyle: PackArtStyleSchema.default({ ...DEFAULT_PACK_ART_STYLE }),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// ---------------------------------------------------------------------------
// 编译期防漂移断言：手写类型（types.ts）与 zod 推导类型必须双向可赋值，
// 任何一侧漂移都会在此处编译报错。仅用于类型检查，运行时无副作用。
// 末尾用 `void [...]` 读取变量，避免 `noUnusedLocals` 误报（读取本身无副作用）。
// ---------------------------------------------------------------------------

// Layer
// 注意：因上方 `LayerSchema` 已显式标注 `z.ZodType<Layer, ...>`，
// `z.infer<typeof LayerSchema>` 恒等于 `Layer`，下面这组断言已退化为恒真。
// 「正向」仍由 schema 的标注与 `.transform(...): Layer` 的返回类型兜住；
// 「反向」则不再能拦住「`Layer` 多了 schema 不产出的字段」这类漂移。
const _assertLayerForward: Layer = {} as z.infer<typeof LayerSchema>
const _assertLayerBackward: z.infer<typeof LayerSchema> = {} as Layer

// CardFace
const _assertCardFaceForward: CardFace = {} as z.infer<typeof CardFaceSchema>
const _assertCardFaceBackward: z.infer<typeof CardFaceSchema> = {} as CardFace

// PatternMode / 九种效果参数（Gradient / HoloGrid / Moire / Gloss / Palette / MaskPreset / ImageMask / MaskErase / Image）
const _assertPatternMode: PatternMode = {} as z.infer<typeof PatternModeSchema>
const _assertPatternModeBack: z.infer<typeof PatternModeSchema> = {} as PatternMode
const _assertGradientParams: GradientParams = {} as z.infer<typeof GradientParamsSchema>
const _assertGradientParamsBack: z.infer<typeof GradientParamsSchema> = {} as GradientParams
const _assertMoireParams: MoireParams = {} as z.infer<typeof MoireParamsSchema>
const _assertMoireParamsBack: z.infer<typeof MoireParamsSchema> = {} as MoireParams
const _assertGlossParams: GlossParams = {} as z.infer<typeof GlossParamsSchema>
const _assertGlossParamsBack: z.infer<typeof GlossParamsSchema> = {} as GlossParams
const _assertHoloGridParams: HoloGridParams = {} as z.infer<typeof HoloGridParamsSchema>
const _assertHoloGridParamsBack: z.infer<typeof HoloGridParamsSchema> = {} as HoloGridParams
const _assertMaskPresetParams: MaskPresetParams = {} as z.infer<typeof MaskPresetParamsSchema>
const _assertMaskPresetParamsBack: z.infer<typeof MaskPresetParamsSchema> = {} as MaskPresetParams
const _assertMaskImageParams: MaskImageParams = {} as z.infer<typeof MaskImageParamsSchema>
const _assertMaskImageParamsBack: z.infer<typeof MaskImageParamsSchema> = {} as MaskImageParams
const _assertMaskEraseParams: MaskEraseParams = {} as z.infer<typeof MaskEraseParamsSchema>
const _assertMaskEraseParamsBack: z.infer<typeof MaskEraseParamsSchema> = {} as MaskEraseParams

// Text
const _assertTextStrokeParams: TextStrokeParams = {} as z.infer<typeof TextStrokeParamsSchema>
const _assertTextStrokeParamsBack: z.infer<typeof TextStrokeParamsSchema> = {} as TextStrokeParams
const _assertTextShadowParams: TextShadowParams = {} as z.infer<typeof TextShadowParamsSchema>
const _assertTextShadowParamsBack: z.infer<typeof TextShadowParamsSchema> = {} as TextShadowParams
const _assertTextParams: TextParams = {} as z.infer<typeof TextParamsSchema>
const _assertTextParamsBack: z.infer<typeof TextParamsSchema> = {} as TextParams

// Image
const _assertImageParams: ImageParams = {} as z.infer<typeof ImageParamsSchema>
const _assertImageParamsBack: z.infer<typeof ImageParamsSchema> = {} as ImageParams

// Effect
const _assertEffectForward: Effect = {} as z.infer<typeof EffectSchema>
const _assertEffectBackward: z.infer<typeof EffectSchema> = {} as Effect

// Card
const _assertCardForward: Card = {} as z.infer<typeof CardSchema>
const _assertCardBackward: z.infer<typeof CardSchema> = {} as Card

// AlbumLayout
const _assertAlbumLayoutForward: AlbumLayout = {} as z.infer<typeof AlbumLayoutSchema>
const _assertAlbumLayoutBackward: z.infer<typeof AlbumLayoutSchema> = {} as AlbumLayout

// PackArtStyle
const _assertPackArtStyleForward: PackArtStyle = {} as z.infer<typeof PackArtStyleSchema>
const _assertPackArtStyleBackward: z.infer<typeof PackArtStyleSchema> = {} as PackArtStyle

// Pack
const _assertPackForward: Pack = {} as z.infer<typeof PackSchema>
const _assertPackBackward: z.infer<typeof PackSchema> = {} as Pack

void [
  _assertLayerForward,
  _assertLayerBackward,
  _assertCardFaceForward,
  _assertCardFaceBackward,
  _assertPatternMode,
  _assertPatternModeBack,
  _assertGradientParams,
  _assertGradientParamsBack,
  _assertMoireParams,
  _assertMoireParamsBack,
  _assertGlossParams,
  _assertGlossParamsBack,
  _assertHoloGridParams,
  _assertHoloGridParamsBack,
  _assertMaskPresetParams,
  _assertMaskPresetParamsBack,
  _assertMaskImageParams,
  _assertMaskImageParamsBack,
  _assertMaskEraseParams,
  _assertMaskEraseParamsBack,
  _assertTextStrokeParams,
  _assertTextStrokeParamsBack,
  _assertTextShadowParams,
  _assertTextShadowParamsBack,
  _assertTextParams,
  _assertTextParamsBack,
  _assertImageParams,
  _assertImageParamsBack,
  _assertEffectForward,
  _assertEffectBackward,
  _assertCardForward,
  _assertCardBackward,
  _assertAlbumLayoutForward,
  _assertAlbumLayoutBackward,
  _assertPackForward,
  _assertPackBackward,
  _assertPackArtStyleForward,
  _assertPackArtStyleBackward,
]
