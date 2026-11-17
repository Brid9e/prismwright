/**
 * 跨材质复用的 GLSL 片段（以字符串常量集中存放，禁止散落拼接）。
 *
 * - {@link GLSL_VERTEX}：世界坐标/法线 + UV 的通用顶点着色器。
 * - {@link GLSL_COMMON}：片元公共函数——spectrum/hash/noise/roundedRectMask/holoPhase/holoColor/
 *   maskWeight/moireSliceSum/glossBands。
 *
 * 移植基准：`buling/utils/materials/holo-foil-overlay.js`。相位与调色板公式按原版保留；
 * 差异有三：alpha 由「蒙版权重」驱动（对齐 card-material 的线稿混合）；注入相位的逐像素噪声
 * 幅度改由 `uNoiseStrength` 控制（原版恒为满档）；图案可以整幅平移（`uOffset`，原版只能眼睁睁
 * 看它钉在卡心）。后两条的原因见 {@link holoPhase}。
 */

/** 通用顶点着色器：输出世界坐标、世界法线与 UV（供视线/反射计算）。 */
export const GLSL_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
// 卡面切线与副切线（世界空间）：法线（bump）扰动需要它们把 UV 空间的斜率折算成法线的偏移方向。
// 卡面是平面，局部 x / y 轴就是切线 / 副切线，直接用模型矩阵的列向量。
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(normalMatrix * normal);
  vWorldTangent = normalize((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vWorldBitangent = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * 片元公共函数块。`uColors` / `uStops` 已在本块声明，使用方只需注入/赋值，
 * 切勿重复声明（会导致 GLSL 重定义错误）；其余 uniform 按各片元需要自行声明。
 */
/**
 * 全息相位的「极点软化」半径，单位是卡高（UV 的 y 方向）。
 *
 * `holoPhase` 里四个归一化方向分量（`R.xy / |R.xy|`、`V.xy / |V.xy|`）在「相机正对着的
 * 卡点」没有定义：方向绕它转一整圈，色带就收成一个尖。这个尖与渐变模式无关（平行模式同样
 * 有），倾斜也不会挪走它（`V` 的奇点恒在卡心），只能在极点附近把方向项平滑压掉。
 *
 * 半径取卡高的 5%：2% 会留一个小结，10% 会明显吃掉卡心的细节。着色器里按方向长度取门控，
 * `layer.ts` 用相机距离把它换算成方向单位（见 `poleSoft`）。
 */
export const HOLO_POLE_SOFTEN_UV = 0.05

/**
 * 圆角矩形遮盖的单独片段。
 *
 * 从 {@link GLSL_COMMON} 拆出来，是为了让**不参与全息**的片元（未揭晓底纹，见
 * `mystery-face.ts`）也能用同一份数学，而不必把整套 uniform 数组一并声明、绑定。
 * 卡面的圆角与侧壁几何必须严丝合缝（圆角处白边就是这么来的，见 `card-scene.ts`），
 * 所以这里只允许有一份实现。
 */
export const GLSL_ROUNDED_RECT_MASK = /* glsl */ `
// 圆角矩形遮盖：1=卡内、0=卡外，边沿约 1px 软过渡（WebGL2 下 fwidth 可用）。
float roundedRectMask(vec2 uv, float aspect, float radius) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 b = vec2(aspect, 1.0) * 0.5;
  vec2 q = abs(p) - b + radius;
  float sdf = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
  float aa = fwidth(sdf) + 1e-5;
  return 1.0 - smoothstep(0.0, aa, sdf);
}
`

export const GLSL_COMMON = /* glsl */ `
uniform vec3 uColors[8];
// 色标的透明度（0–1），与 uColors 同槽位。色标半透明 = 全息箔在该相位处变淡，
// 进的是 holoColor 返回的 coverage，而不是颜色本身（颜色仍是 vec3）。
uniform float uColorAlphas[8];
// 色标在相位域的位置，升序，长度 8（末项重复补齐）。补齐项构成 span 为 0 的段，
// 被下面的 1e-5 兜住，等价于「不再混色」——所以色标数量不需要再单独传进来。
uniform float uStops[8];
// 相邻色标之间过渡带的宽度，单位是「段长」：1 = 整段线性过渡（旧观感），0 = 在色标处硬跳，
// >1 = 带子跨出本段、相邻色标浑融。属相位全局设置，由 gradient 效果承载（见 mapping.ts 的
// toUniforms），故与上面两个数组分开声明——它进的是散装标量 uniform，不是定长数组。
uniform float uTransition;

// ── 效果栈：按类型定长数组 + 计数（长度与 TS 侧 registry 的 *_MAX 一一对应）──
//
// 为何是「定长数组 + 计数」而非变长：GLSL ES 1.00 的循环上界必须是常量、uniform 数组也要定长，
// 故长度取各类型的编译期上界，运行时只有前 uXxxCount 条有效（循环体以 float(i) < count 守卫）。
const int MOIRE_MAX = 2;
const int GRADIENT_MAX = 1;
const int LATTICE_MAX = 4;
const int GLOSS_MAX = 2;
const int MASK_PRESET_MAX = 2;

// 相位① 摩尔纹（扰动取样坐标）。uMoireCount = 实际条数。
uniform float uMoireCount;
uniform float uMoireMode[MOIRE_MAX];
uniform float uMoireAngle[MOIRE_MAX];
uniform float uMoireDensity[MOIRE_MAX];
uniform float uMoireDepth[MOIRE_MAX];
uniform float uMoireTwist[MOIRE_MAX];
uniform float uMoireTwistSeed[MOIRE_MAX];
uniform float uMoireFaceStrength[MOIRE_MAX];
// 本层**自有**的摩尔纹条数（不含从卡面继承来的那份）：内容浮雕只认它，见 layerContentHeight。
// 卡面片元不绑定此 uniform（恒为 0，也不会调用图层专用函数）。
uniform float uOwnMoireCount;

// 相位② 渐变（主斜坡）。uGradientDensity = 跨卡色带密度（原 count）。
uniform float uGradientCount;
uniform float uGradientMode[GRADIENT_MAX];
uniform float uGradientDensity[GRADIENT_MAX];
uniform float uGradientAngle[GRADIENT_MAX];
uniform float uGradientTwist[GRADIENT_MAX];
uniform float uGradientTwistSeed[GRADIENT_MAX];
// 整齐度（0–1）：0 = 保留骑在斜坡上的方向项 / 固定正弦 / 像素位移，1 = 只留斜坡本身。
// 它是相位全局项（散装标量），取首条渐变的值；无渐变时恒为 0。
uniform float uGradientStraight;

// 相位③ 几何刻纹（相位加项）。uLatticeFamilies = 条纹族数（原 count）。
uniform float uLatticeCount;
uniform float uLatticeFamilies[LATTICE_MAX];
uniform float uLatticeAngle[LATTICE_MAX];
uniform float uLatticeDensity[LATTICE_MAX];
uniform float uLatticeWidth[LATTICE_MAX];
uniform float uLatticeStrength[LATTICE_MAX];
uniform float uLatticeOffsetX[LATTICE_MAX];
uniform float uLatticeOffsetY[LATTICE_MAX];

// 颜色 光泽（往 RGB 加光带）。uGlossBands = 光带数（原 count）。见各片元。
uniform float uGlossCount;
uniform float uGlossMode[GLOSS_MAX];
uniform float uGlossBands[GLOSS_MAX];
uniform float uGlossSpacing[GLOSS_MAX];
uniform float uGlossWidth[GLOSS_MAX];
uniform float uGlossAngle[GLOSS_MAX];
uniform float uGlossTwist[GLOSS_MAX];
uniform float uGlossTwistSeed[GLOSS_MAX];
uniform float uGlossIntensity[GLOSS_MAX];
// 光带颜色（线性工作空间）：缺省槽位由 host 侧填老的暖白常量 (1.15, 1.10, 1.05)。
uniform vec3 uGlossColor[GLOSS_MAX];
// 光带颜色的透明度：只缩放这一条光带的贡献（加光与压暗），0 = 该条完全不生效。
uniform float uGlossAlpha[GLOSS_MAX];
// 1 = 该条作为蒙版：颜色通路跳过它，光带场改走 glossMaskWeight 向下裁切子树。
uniform float uGlossAsMask[GLOSS_MAX];
// 整场平移（UV 域）：把光带 / 蒙版窗口挪到想要的落点，缺省 0 = 钉在原位。
uniform float uGlossOffsetX[GLOSS_MAX];
uniform float uGlossOffsetY[GLOSS_MAX];
// 羽化（0–1）：光带边缘往内渐隐的比例。1 = 从中心一路渐隐（旧画法），0 = 硬边。
uniform float uGlossSoftness[GLOSS_MAX];

// alpha 程序化蒙版（乘权重）。
uniform float uMaskPresetCount;
uniform float uMaskPresetSides[MASK_PRESET_MAX];
uniform float uMaskPresetSpike[MASK_PRESET_MAX];
uniform float uMaskPresetIrregular[MASK_PRESET_MAX];
uniform float uMaskPresetEquilateral[MASK_PRESET_MAX];
uniform float uMaskPresetDensity[MASK_PRESET_MAX];
uniform float uMaskPresetSize[MASK_PRESET_MAX];
uniform float uMaskPresetSizeJitter[MASK_PRESET_MAX];
uniform float uMaskPresetArrangement[MASK_PRESET_MAX];
uniform float uMaskPresetSoftness[MASK_PRESET_MAX];
uniform float uMaskPresetSeed[MASK_PRESET_MAX];
uniform vec2 uMaskPresetOffset[MASK_PRESET_MAX];
uniform float uMaskPresetFlipX[MASK_PRESET_MAX];
uniform float uMaskPresetFlipY[MASK_PRESET_MAX];
uniform float uMaskPresetRotation[MASK_PRESET_MAX];
// 反转为**逐条自带参数**（非图蒙版那个共用标量）：同一层叠加多条程序化蒙版时，每条可各自反转，
// 反转作用于该条自身的权重，再与其余条相乘——故与图蒙版「反转作用于最终权重」语义一致，
// 但作用域是「这一条」而非「整层」。
uniform float uMaskPresetInvert[MASK_PRESET_MAX];

// 调色板取样：按色标位置在若干颜色间累积混合。
//
// 等距位置（uStops[i] = i / (n - 1)）下与改造前的等距特化公式逐项等价：
//   clamp((m - i/seg) / (1/seg), 0, 1) = clamp(m * seg - i, 0, 1)，与旧式的 clamp(pos - i) 相同。
// 两端：m 小于首色标位置时权重恒 0（取首色），大于末色标位置时权重恒 1（取末色）——钳制而非环绕。
//
// 分母取 max(过渡带宽度, 1e-5)：两个色标位置重合时 span 为 0，否则会得到 Infinity → NaN 颜色；
// 1e-5 在 m 的取值域上远小于一个像素，因此视觉上就是硬边——uTransition 为 0 时走的正是这条路。
// 过渡带宽度 = uTransition × span：为 1 时与旧式逐值等价，为 0 时在每个色标处硬跳，中间值按比例
// 收窄「混色区」，带外维持该段纯色（左沿对齐，色标即过渡起点）。
vec3 spectrum(float t) {
  float m = 0.5 + 0.5 * cos(6.2831853 * t);
  vec3 col = uColors[0];
  for (int i = 0; i < 7; i++) {
    float span = max(uStops[i + 1] - uStops[i], 1e-5);
    float band = max(uTransition * span, 1e-5);
    col = mix(col, uColors[i + 1], clamp((m - uStops[i]) / band, 0.0, 1.0));
  }
  return col;
}

// 与 spectrum 逐项同权重地混色标透明度（同一 m、同一 1e-5 下限、同一过渡带）。
// 两条斜坡必须保持一致，否则颜色与透明度会在过渡带里错位。
float spectrumAlpha(float t) {
  float m = 0.5 + 0.5 * cos(6.2831853 * t);
  float a = uColorAlphas[0];
  for (int i = 0; i < 7; i++) {
    float span = max(uStops[i + 1] - uStops[i], 1e-5);
    float band = max(uTransition * span, 1e-5);
    a = mix(a, uColorAlphas[i + 1], clamp((m - uStops[i]) / band, 0.0, 1.0));
  }
  return a;
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 扭转的「转法」：种子决定扭转**绕哪个点、沿卡面绞得多紧**，而不只是绞多狠。
//
// 种子 0 = 旧行为（绕卡心、扭转率恒定），逐位等于原来的 twist * length(uv - 0.5) * 6.2831853，
// 存量卡片的画面因此一格不变。种子 > 0 时由它派出两样东西：
//   ① 扭转中心从卡心挪到卡面上一处由种子定下的点——螺旋不再「绕着卡片正中那几个点」；
//   ② 扭转率沿卡面被低频噪声调制（0.25×..1.75×）——同一条螺旋上有的地方绞紧、有的地方松开。
// 于是换种子就是换一副扭转的样子，而不是同一个形状只改强度。
//
// 种子先按 mod 2048 折进安全区间：hash21 / noise 把实参送进 sin，1e6 量级会让画面塌回规整图案
// （理由与 shardCell 里那段相同）。2048 套扭转样式对「重掷」绰绰有余。
const float TWIST_CENTER_SPREAD = 0.6;   // 扭转中心相对卡心最多偏移 ±0.3（UV）
const float TWIST_RATE_VARIATION = 0.75; // 扭转率的空间起伏幅度（±75%）
const float TWIST_NOISE_FREQ = 3.0;      // 起伏尺度：横跨卡面约 3 个噪声格

// uv 为卡片 UV（0..1），twist 为强度（±1），seed 为扭转种子。
// 返回这一步的扭转相位（已含 2π 换算），调用方直接加进自己的图样坐标。
float twistPhase(vec2 uv, float twist, float seed) {
  if (seed < 0.5) return twist * length(uv - 0.5) * 6.2831853;
  float s = mod(seed, 2048.0);
  vec2 center = vec2(0.5)
    + (vec2(hash21(vec2(s, 7.3)), hash21(vec2(s, 19.1))) - 0.5) * TWIST_CENTER_SPREAD;
  float wave = noise(uv * TWIST_NOISE_FREQ + vec2(s * 0.137, s * 0.219));
  float rate = 1.0 + TWIST_RATE_VARIATION * (wave - 0.5) * 2.0;
  return twist * rate * length(uv - center) * 6.2831853;
}

${GLSL_ROUNDED_RECT_MASK}

// 摩尔纹场：返回 [-1,1] 的刻蚀扰动（乘 depth 后使用）。
//
// 平行 = 沿 dir 等距的排线；光环 = 同心圆；射线 = 绕心放射的刻线。光环以 r² 作坐标，使环序号
// ∝ r²——相邻环的径向间距随半径递减，即「从中心往外密集」。
//
// 射线用「圈数」口径（极角 / 2π）而非弧度：使 coord 落在与平行 / 光环同量级（约 ±0.5），
// 于是同一个 density 刻度感一致（直接用弧度会密约 6 倍）。angle 转成圈数后叠加，用来旋转刻线。
float moireField(vec2 uv, float mode, float angle, float density, float twist, float twistSeed) {
  vec2 c = uv - 0.5;
  vec2 dir = vec2(cos(radians(angle)), sin(radians(angle)));
  float coord = (mode < 0.5) ? dot(c, dir)
              : (mode < 1.5) ? dot(c, c)
              : (atan(c.y, c.x) / 6.2831853 - angle / 360.0);
  coord += twistPhase(uv, twist, twistSeed);
  return sin(coord * density * 18.0);
}

// 渐变空间的主斜坡坐标（供 holoPhase 的主空间项使用）。
//
// 参数化：mode / angle / twist 由效果栈里对应的那一条带进来（holoPhase 逐条循环求值），
// 本函数不再读任何全局 uniform，故纯粹是一个可独立复用的数学件。
//
// 平行沿用原式「以 uv 原点起算、不带中心偏移」的口径——默认角度/频率下即复现原 (24,19) 斜坡；
// 光环取到卡心的半径；射线取绕卡心的极角（同为圈数口径）——一张卡绕一圈色板循环 density 次，
// 即从中心放射的彩色射线。twist 让斜坡随半径旋一个角度（射线模式下便成了螺旋），转的「中心」与
// 沿卡面的紧松由 twistSeed 决定——种子 0 即绕卡心匀速，见 twistPhase。
//
// 注意：射线在卡心的 −x 半轴上有一条接缝（极角从 +π 跳回 −π）——这是角向映射的本质边界，
// 与「色轮」一样无法避免，属预期行为。
float gradientRamp(vec2 uvw, float mode, float angle, float twist, float twistSeed) {
  vec2 dir = vec2(cos(radians(angle)), sin(radians(angle)));
  vec2 c = uvw - vec2(0.5);
  float around = length(c);
  float ramp = (mode < 0.5) ? dot(uvw, dir)
             : (mode < 1.5) ? around
             : (atan(c.y, c.x) / 6.2831853 - angle / 360.0);
  return ramp + twistPhase(uvw, twist, twistSeed);
}

// 几何刻纹 → 相位偏移的换算系数。
//
// holoColor 里 t1 = phase * 0.036，故 strength=1 时点阵把色板取样位置推开约
// 7 * 0.036 ≈ 0.25（色板的四分之一圈）。这是唯一不可自动化验证的系数，取值靠人工对照。
const float LATTICE_PHASE_SCALE = 7.0;

// 几何刻纹场：N 族等角余弦条纹各取峰后求和，clamp 到 [0,1]。
//
// 参数化：族数 / 角 / 频率 / 线宽 / 偏移全为入参（holoPhase 逐条循环求值），strength 仍在调用处乘。
//
// 每条族是「法向为 dir_i、彼此平行的一组线」——即 dot(uv - 0.5, dir) 的等值线（只有取值为 0
// 的那条过卡心）。取 |cos| 的波峰：只有 |cos| 高于 1 - width 的那一段被照亮，平滑波因此锐化
// 成细亮线（width 越小越细锐），峰值归一化到 1。
// width = 1/7 时阈值正好是 1 - 1/7 = 6/7，即加本参数之前写死的那个阈值，画面逐像素不变。
// 族角为 angle + i*180/families：families=2 得正交方格、families=3 得正三角格。
// 整幅点阵可由 offsetX / offsetY 平移（UV 域，且在旋转之前），默认 0 即钉在卡面原位。
// 常量上界 8 + if (float(i) < families) 守卫，符合 GLSL ES 1.00 的 constant-index-expression
// 约定（与 base.ts 的光带循环同构）。
float latticeField(vec2 uv, float families, float angle, float density, float width, float offsetX, float offsetY) {
  float acc = 0.0;
  // n 兜住 families=0（关闭态）时的除零；关闭时循环体本就不执行，故 n 取什么数都无副作用。
  float n = max(families, 1.0);
  // 线宽既是阈值（1 - w）又是归一化的除数：max(0, (|cos| - (1 - w)) / w)。
  // 再兜一层除数下限：schema 下限是 0.02，但 uniform 是外部可写的，别让 0 除进去。
  float w = max(width, 0.01);
  // 偏移在旋转之前减掉：整幅点阵刚性平移，X 永远指卡面水平方向（与 angle 无关）。
  // 默认 0 时这一行与「uv - 0.5」逐字等价。
  vec2 p = uv - vec2(offsetX, offsetY) - 0.5;
  for (int i = 0; i < 8; i++) {
    if (float(i) < families) {
      float a = radians(angle + float(i) * 180.0 / n);
      vec2 dir = vec2(cos(a), sin(a));
      acc += max(0.0, (abs(cos(dot(p, dir) * density)) - (1.0 - w)) / w);
    }
  }
  return min(acc, 1.0);
}

// 程序化蒙版 → 碎片场。
//
// 把 UV 切成 density×density 的网格，每格用**确定性哈希**抽一个随机碎片（中心抖动、自转、
// 尺寸抖动），落在碎片内返回 1、缝里 0，边缘按 softness 过渡。同一 (格子, 种子) 永远同一结果：
// 布局看着是散的，却既不逐帧闪烁，也能靠 seed 整批换掉——**不用** iTime 之类的时变量。
//
// **生成空间 = 卡面等比坐标（卡高 = 1），不是 UV**：卡片平面是 PlaneGeometry(aspect, 1)，uv 两轴
// 都是 0–1 ⇒ u 跨 aspect(≈0.714)、v 跨 1，同一「1 单位」横向只有纵向的 0.714 倍。直接拿 UV 当
// 几何空间，形状就被横向压扁 1.4 倍：等边三角 → 等腰（边长 1.732 / 1.623 / 1.623），45° 摆位的
// 正方形 → 四边等长的菱形（只量边长看不出来），旋转也不是屏幕上的真旋转。故进网格前先
// vec2(p.x * uAspect, p.y) 换算，与 roundedRectMask / uOffset 同一口径。
//
// 抖动幅度由 arrangement 入参统一门控：1 = 随机（默认，上面那套），0 = 规则（碎片落在
// 格子正中、朝向一致、大小一致——整片是排好的阵列）。门控乘在三个随机项上，故中间值也有意义
// （半散半齐），UI 眼下只暴露两端。
//
// 形状是「参数化的 n 边形 + 尖角」：外顶点在半径 1、内顶点在半径 s = spike * cos(π/sides)，
// 相邻顶点用**直线**相连。于是
//   spike = 1      → 内顶点正好落在正 n 边形边中点 → 规则多边形（直边碎片）；
//   spike ≈ 0.38,5 → 尖角五角星；
//   大 sides + 1   → 内/外半径都趋近 1 → 圆点。
// 另有一档 irregular 把每个顶点的半径随机缩放：规则多边形 → 随机多边形（碎片感）；
// 等边开关 equilateral 再把这一档整体门控掉（开 = 锁回正多边形）。
//
// 整场还有镜像 / 旋转（见 shardField）：翻转与旋转是把整张蒙版当贴图动，格子排布一起动。
// 换算到等比坐标有一个可见的代价：整场（格子排布 + 每块碎片）横向被撑开 1.4 倍，存量系列的
// 蒙版画面因此与本条修复前不同——修的是「空间用错」的缺陷，没有「默认值逐位退回」的余地。
// 取 5×5 邻域最大值：单块半径最大 2 格（尺寸是绝对量，密度一高，一块就横跨多格），只看当前格会把跨格的碎片切平。

/** 某一格 [c] 里的候选碎片对点 [g]（网格坐标）的覆盖度：内 1、外 0。 */
float shardCell(vec2 g, vec2 c, float seed, float sides, float spike, float irregular,
                float equilateral, float density, float size, float sizeJitter, float arrangement,
                float softness) {
  // seed 由用户重掷，schema 允许到 1e6。但 hash21 会把实参乘到 sin，实参一到 1e8 量级，逐格约
  // 127 的坐标差就落进该量级的浮点粒度（ulp≈32）之下、散列退化成同一值——碎片于是从「随机散开」
  // 塌回「规整网格」。故先把 seed 折进安全区间再入场：2048 × 438.8 ≈ 9e5，比该量级低三个数量级，
  // hash 仍良态；2048 套布局对「重掷」绰绰有余，且相邻 seed 依旧互不相关（hash21 是高频散列）。
  // 注意这里是**赋值**而非再声明：seed 已是入参，GLSL 不允许同名局部再声明（redeclaration error）。
  seed = mod(seed, 2048.0);
  // 四个独立随机量：中心抖动 x/y、自转角、尺寸抖动。盐值不同 → 同格四值互不相关。
  float r0 = hash21(c + vec2(0.0, 0.0) + seed);
  float r1 = hash21(c + vec2(1.7, 3.1) + seed);
  float r2 = hash21(c + vec2(5.3, 7.9) + seed);
  float r3 = hash21(c + vec2(9.1, 2.3) + seed);

  // 排布开关：1 = 随机（默认，等价于加该参数之前的画面），0 = 规则。位置、朝向、尺寸三者
  // 一起被它门控——只归零位置，碎片仍各自乱转；只归零朝向，碎片仍散落在格子各处。
  // 因子只以乘 / 加形式入场：1 侧是「乘 1.0」逐位无损，另一侧乘 0 再加 0 也逐位无损，
  // 存量系列的画面才不会被这一个参数改花。**不要**换成 mix()——它在端点上差 1 ulp。
  float jitter = arrangement;
  float n = max(sides, 3.0);
  // 形状的角步长：相邻顶点（也是相邻边中点）相隔 2π/n。名字不取 step——那是 GLSL 内建
  // 函数名，同名变量会去遮它（部分实现直接编译不过）。
  float angStep = 6.2831853 / n;
  // 规则排布下所有碎片的共同朝向，取「摆正」的那个角：
  //   奇数边取「顶点朝上」——90° 对步长取余，落在最接近正上方的顶点位上（三角尖朝上、
  //   五角星不歪）；偶数边取「一条边朝上下」——90° 退半步再取余，正四边形于是边贴轴
  //   （不再成菱形）、六边形平顶。取余保证落在步长的哪一侧都给出同一套顶点方向。
  float base = mod(n, 2.0) > 0.5
    ? mod(1.5707963, angStep)
    : mod(1.5707963 - angStep * 0.5, angStep);

  // 中心在格子正中附近抖动（±0.3 格），于是碎片不排成规整网格；规则排布下落回格子正中。
  vec2 center = c + 0.5 + (vec2(r0, r1) - 0.5) * 0.6 * jitter;
  // 自转角：随机排布取散列值打散朝向，规则排布取基准角（整片朝向一致）。
  float ang = r2 * 6.2831853 * jitter + base * (1.0 - jitter);
  // 半径（网格单位）。尺寸与密度解耦：size 是「占卡面的绝对直径」，而 g 缩放过了
  // density，故须乘回 density 才落进网格域——于是 density 只管「有多少块」，改它不会缩放每块。
  // 代价（有意为之）：尺寸固定而块数变多时，块与块必然相互重叠，高密度会糊成一片。
  // 上限 2.0 与 shardField 的 5×5 邻域配套：再大也已把邻域盖满，钳住不再增大。
  float radiusBase = 0.5 * size * density;
  // 尺寸抖动同样乘上因子：规则排布下每块大小一致（= radiusBase）。
  float radius = clamp(radiusBase * (1.0 - sizeJitter * r3 * jitter), 1e-3, 2.0);

  // 平移到形状本地坐标：先减中心，再逆旋转，最后按半径归一化（归一化后外顶点半径恒为 1）。
  vec2 d = g - center;
  vec2 u = vec2(cos(ang) * d.x + sin(ang) * d.y, -sin(ang) * d.x + cos(ang) * d.y) / radius;
  float dd = length(u);

  // n 边形 / 星形的极坐标半径：外顶点半径 1、内顶点半径 s，相邻顶点用直线相连。
  // 由「过 (1,0) 与 (s·cosφ, s·sinφ) 的直线」解出 r(θ)（φ = π/n，θ 为到最近外顶点的角）。
  // 形状关于顶点方向对称，故取 |θ|：直线公式只在 θ∈[0,φ] 成立，负半侧是它的镜像。
  // n 与 angStep 在上方算过（规则排布的基准角要用），这里只补 φ。
  float phi = 3.14159265 / n;
  float s = spike * cos(phi);
  float da = s * sin(phi);
  float db = s * cos(phi) - 1.0;
  float a = atan(u.y, u.x);
  float th = mod(a + phi, 2.0 * phi) - phi;
  float rshape = da / max(da * cos(th) - db * sin(abs(th)), 1e-4);

  // 不规则：把每个顶点的半径按「(格子, 顶点序号) 散列」缩放，规则多边形于是变成随机多边形
  // ——等边三角变随机三角、正四边形 / 五边形同理，拉高即得到参考图那种碎片感。
  // 缩放是关于角度的**分段线性、连续**函数：整数顶点处取该顶点的散列值，边中间线性插值，
  // 于是顶点被推远拉近、边仍是直的（不会半径跳变把形状撕开）。顶点序号对 n 取模，让 a = ±π
  // 落到同一顶点上（否则正 -x 轴会有一道接缝）。因子以「乘 (1 + 0)」入场：不规则为 0 时是
  // 「乘 1.0」，逐位无损，存量系列画面不变。**不要**换成 mix()——它在端点差 1 ulp。
  float kf = a / angStep;
  float k0 = floor(kf);
  float fr = kf - k0;
  float v0 = hash21(c + vec2(mod(k0, n), 13.7) + seed);
  float v1 = hash21(c + vec2(mod(k0 + 1.0, n), 13.7) + seed);
  float vscale = mix(v0, v1, fr);
  // 「等边」开关把上面这一档整体门控掉：关（0）时是「乘 1.0」，逐位无损；开（1）时乘 0，因子
  // 恰好归零 → 形状锁成正多边形（等边三角 / 正方形 / 正六边形），不规则滑块拖到哪都不影响。
  float irr = irregular * (1.0 - equilateral);
  rshape *= 1.0 + irr * (vscale - 0.5);

  // softness 以形状半径为量纲（0 = 硬边）。下限 1e-4 兜住 smoothstep 的 e0==e1 未定义行为。
  float soft = max(softness, 1e-4);
  return 1.0 - smoothstep(rshape - soft, rshape + soft, dd);
}

/** 碎片场：整场先换算到卡面等比坐标，再镜像 / 旋转 / 平移，最后取 5×5 邻域里覆盖度最大的一格。 */
float shardField(vec2 uv, float seed, float sides, float spike, float irregular, float equilateral,
                 float density, float size, float sizeJitter, float arrangement, float softness,
                 float offsetX, float offsetY, float flipX, float flipY, float rotation) {
  // 整场变换：把蒙版当一张贴图翻 / 转——格子排布与每块碎片一起动，不是只转单块。顺序是
  // 先镜像再旋转（换过来结果不同），都绕卡面中心（等比坐标里的卡面中心，见下）。
  //
  // 两个写法都是为了「不翻不转时逐位退回本步输入」（按 uAspect 的等比换算是有意的例外，见下）：
  //   镜像写成 uv * (1 - 2m) + m（m = 0 时是「乘 1.0 加 0」）；直译的 1.0 - uv 在默认那侧就动手了。
  //   旋转写成 R*iso + (c - R*c) 而非 R*(iso - c) + c——后者的 (x - 0.5) + 0.5 在浮点下差 1 ulp。
  // 不转时（radians(0) = 0）cos / sin 取到精确的 1 / 0——GLSL 规范只承诺 1 ulp，但各家实现
  // （ANGLE / Mesa / Apple）在实参恰为 0 时都给出精确值，故这两步也是逐位无损。
  vec2 m = vec2(flipX, flipY);
  vec2 p = uv * (1.0 - 2.0 * m) + m;
  // 要害一行：UV → 卡面等比坐标（卡高 = 1）。uAspect 由宿主片元（layer / base）声明，且必须
  // 拼在 GLSL_COMMON 之前——这里不重复声明，否则整个着色器编译不过。
  vec2 iso = vec2(p.x * uAspect, p.y);
  vec2 ctr = vec2(uAspect * 0.5, 0.5);
  float ca = cos(radians(rotation));
  float sa = sin(radians(rotation));
  vec2 rotCtr = vec2(ca * ctr.x - sa * ctr.y, sa * ctr.x + ca * ctr.y);
  vec2 uvT = vec2(ca * iso.x - sa * iso.y, sa * iso.x + ca * iso.y) + (ctr - rotCtr);
  // 位移仍按 UV 口径（±1 = 一整幅宽 / 高）从 schema 传入，故在此换算成等比坐标。
  vec2 g = (uvT - vec2(offsetX * uAspect, offsetY)) * density;
  vec2 cell = floor(g);
  float best = 0.0;
  // 单块半径最大 2 格（见 shardCell），±2 邻域即覆盖任意落点附近的碎片。这是「尺寸与密度解耦」
  // 换来的固定代价：25 次求值（原 3×3 为 9 次），换了「改密度不改变每块大小」。
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      best = max(best, shardCell(g, cell + vec2(float(dx), float(dy)), seed, sides, spike, irregular,
                                 equilateral, density, size, sizeJitter, arrangement, softness));
    }
  }
  return best;
}

// 程序化蒙版权重：逐条（最多 MASK_PRESET_MAX）相乘，反转为**逐条自带参数**（uMaskPresetInvert[i]）。
// 与图蒙版的 invert 语义一致（反转作用于最终权重），但**不受** maskMode 影响——line/fill 是对
// 「采样图亮度」的分档，对几何碎片没有意义。
float presetMaskWeight(vec2 uv) {
  float w = 1.0;
  for (int i = 0; i < MASK_PRESET_MAX; i++) {
    if (float(i) < uMaskPresetCount) {
      float s = shardField(uv, uMaskPresetSeed[i], uMaskPresetSides[i], uMaskPresetSpike[i],
                           uMaskPresetIrregular[i], uMaskPresetEquilateral[i], uMaskPresetDensity[i],
                           uMaskPresetSize[i], uMaskPresetSizeJitter[i], uMaskPresetArrangement[i],
                           uMaskPresetSoftness[i], uMaskPresetOffset[i].x, uMaskPresetOffset[i].y,
                           uMaskPresetFlipX[i], uMaskPresetFlipY[i], uMaskPresetRotation[i]);
      w *= mix(s, 1.0 - s, uMaskPresetInvert[i]);
    }
  }
  return w;
}

// 视角相关的全息相位（移植自 buling holo-foil-overlay.js 的 main 主体）。
//
// 与原版的唯一差异：注入相位的那三处逐像素噪声（rndA / rndB，分别以 (rndA + rndB) * 3.4、
// sin(... + rndA * 2.1)、sin(... + rndB * 3.3) 进入）整体乘上 noiseStrength。
//
// 为什么把幅度做成参数：hash21 是无限高频散列，相邻像素互不相关——是白噪声不是纹理。
// 程序化着色器没有纹理过滤那一层，它与像素一一对应；再经 holoColor 的 t1 = phase * 0.036，
// 单像素在色环上随机跳约 ±0.12 圈，观感是「沙」不是「颗粒」。这个抖动的可见度还正比于
// 色板斜率（m = 0.5 + 0.5 * cos(2πt) 的导数在色板中段最大、两端为零），所以颗粒集中在
// 颜色过渡处，色标拖得越近越重。与渲染精度无关：片元着色器是 highp，全库无 precision 覆盖。
//
// 参数两端都是**已验证过的画面**：0 = 不注入（干净的色带），1 = 原版 buling 的幅度，中间
// 只是线性过渡，不引入未经验证的观感——本地看不到渲染结果、只能靠人工验收时这点尤其重要。
// 想要「颗粒」而不是「沙」，正确做法是先把噪声量化到可见网格（约 2px）再取 hash，而不是
// 动这里的幅度。
//
// 相位里有两处「点」——2026-10-11 用离线复刻（按 card-view 的真实相机/卡面几何把本函数原样
// 搬到 JS 里逐项渲染）验过，结论如下：
//
// 1) 肉眼看到的那个尖，来自视线方向这一项：snR/csR/snV/csV 是归一化后的方向，方向在 V.xy/R.xy
//    归零处没有定义，而相机正挂在卡前面，「相机正对着的那一点」就落在卡面正中。把同心环推到卡外、
//    或干脆删掉 sin(length(...)) 那一项，这个尖纹丝不动；关掉方向项，它立刻消失。
//    poleView 是搬它的偏移（换算见 layer.ts）：偏移到半个卡面，尖就下卡。
//
//    **2026-10-31 起尖还多了一层就地压制**：四个方向分量各自乘上按方向长度取的平滑门控
//    （见下面 gateR / gateV）。极点还在，但相位场在它附近线性化了，色带不再收口。
//    poleView 保留原职责（把整幅图案连同极点一起平移），不再指望靠它「消尖」。
// 2) 同心环的圆心只是 sin(length(uvw - vec2(0.5)) * 21.0) 自己的圆心，即 uvw = 卡面中心那一处。
//    它是一层 0.62 幅度的涟漪叠在主导斜坡上（色带周期约 28 相位单位），那一点并不比别处更尖——
//    它是圆心，不是 1) 里的尖。uvw 取长度之前已经吃过 distortion 的逐像素噪声，所以环心是
//    **平均**位置：拉高扭曲强度，圆心自己会抖。
//
// 参数 offset（UV 域）把整幅图案平移：uv0 减掉它，色带、同心环、逐像素噪声一起挪。同一时刻调用
// 方用 poleView 把 1) 的奇点搬到同一个落点（0.5 + offset）——两处必须同步，否则尖会钉在卡面
// 正中、与挪走的图案分家。唯一不参与平移的是 rndA/rndB 散列**种子**里的真实方向：那是白噪声，
// 挪不挪只是换一片噪声，不移动任何可见结构。
//
// 主空间项（原为一条钉死的平行斜坡）改由 gradientRamp 提供：逐条循环 uGradientMode[i] /
// uGradientAngle[i] / uGradientDensity[i] / uGradientTwist[i] / uGradientTwistSeed[i]（条数由
// uGradientCount 门控），
// 每条在平行斜坡、光环、射线间切换，默认参数（平行）下与原来那条斜坡逐项等价（角度/频率由
// mapping 换算，见 layer.ts）。三条相位加项（摩尔纹折射 / 渐变斜坡 / 几何刻纹）各自按「类型序」
// 循环：这是一份固定顺序——同一效果列表下多条叠加的结果与顺序无关（同一批乘法/加法），
// 但跨类型的相对次序会影响画面（摩尔纹改的是 uvw，渐变吃它，刻纹用真实 uv）。
float holoPhase(vec3 V, vec3 N, vec2 uv, vec2 offset, float distortionStrength, float noiseStrength, vec2 poleView, float poleSoft, float straight) {
  // 整齐：把骑在渐变斜坡上的扰动按比例淡出，straight = 1 时只剩斜坡本身（色带笔直等距）。
  // 只影响这两类「额外相位」——斜坡本身、摩尔纹折射、几何刻纹都不归它管。
  float keep = clamp(1.0 - straight, 0.0, 1.0);
  float nd = clamp(dot(N, V), 0.0, 1.0);
  float grazing = 1.0 - nd;
  vec3 R = reflect(-V, N);
  // 先减去 poleView 再归一化：方向在它归零处没有定义，那个奇点于是从「相机正前方」挪到
  // 0.5 + offset（换算见 layer.ts）。V.xy 与 R.xy 在平卡时互为相反数，所以两侧偏移符号相反，
  // 奇点才落在同一个卡点上。
  vec2 Rxy = R.xy - poleView;
  vec2 Vxy = V.xy + poleView;
  float rLen = length(Rxy) + 1e-4;
  float snR = Rxy.y / rLen;
  float csR = Rxy.x / rLen;
  float vLen = length(Vxy) + 1e-4;
  float snV = Vxy.y / vLen;
  float csV = Vxy.x / vLen;

  // 极点软化：四个方向分量在极点处没有定义（见 HOLO_POLE_SOFTEN_UV 的说明）。门控按方向
  // 向量自身的长度取，跟着极点走——偏移 / 倾斜后极点会沿卡边漂移，按 UV 圆取会盖不住。
  // smoothstep 在 0 处的斜率为 0，相位场在极点附近二次型地平滑，色带收口随之消失。
  float gateR = smoothstep(0.0, max(poleSoft, 1e-5), length(Rxy));
  float gateV = smoothstep(0.0, max(poleSoft, 1e-5), length(Vxy));
  snR *= gateR;
  csR *= gateR;
  snV *= gateV;
  csV *= gateV;
  float elev = R.z * 1.15 + rLen * 0.85;

  // 平移在这里发生：uv0 一挪，色带（uvw）、同心环、四路 noise 与 rndA/rndB 全都跟着走。
  // 只有卡片轮廓相关的取样（蒙版、圆角）留在真实 uv 上，图案挪到卡外不会把卡片本身挪走。
  vec2 uv0 = uv - offset;
  vec2 uvw = uv0;
  float angWarp = snR * 4.2 + csR * 3.1;
  // 幅度在这里乘进去，三处用法就都不必再写一遍——noiseStrength 是 uniform，乘在哪一层等价。
  float rndA = (hash21(uv0 * 7.3 + V.xy * 2.1) - 0.5) * noiseStrength;
  float rndB = (hash21(uv0.yx * 5.9 + R.xy * 1.7) - 0.5) * noiseStrength;

  float nW = noise(uv0 * 5.0 + V.xy * 1.2);
  float nX = noise(uv0 * 5.0 + V.xy * 1.2 + vec2(33.0, 57.0));
  float nY = noise(uv0 * 11.0 + V.xy * 2.4);
  float nZ = noise(uv0 * 11.0 + V.xy * 2.4 + vec2(71.0, 43.0));

  uvw += keep * 0.15 * distortionStrength * vec2(nW - 0.5, nX - 0.5);
  uvw += keep * 0.07 * distortionStrength * vec2(nY - 0.5, nZ - 0.5);

  // ① 摩尔纹折射：多条把取样坐标整体偏折（gradient 会吃这个 uvw）。固定序第一档。
  // 刻纹把取样坐标整体偏折一个微小量，颜色于是沿刻纹跳变。
  float moireSum = 0.0;
  for (int i = 0; i < MOIRE_MAX; i++) {
    if (float(i) < uMoireCount) {
      moireSum += moireField(uv0, uMoireMode[i], uMoireAngle[i], uMoireDensity[i], uMoireTwist[i], uMoireTwistSeed[i]) * uMoireDepth[i];
    }
  }
  uvw += moireSum * 0.02;

  float phase = keep * (
    snR * 5.5 + csR * 4.2 + snV * 4.6 + csV * 3.5 + elev * 1.05
    // 用平移过的 Vxy：这是一条横跨卡面的平滑相位斜坡，它的中心就是图案的中心，不跟着挪的话
    // 「整幅平移」就不成立（偏移为 0 时 Vxy 恒等于 V.xy，观感不变）。
    + dot(Vxy, vec2(10.0, 6.8)) + (rndA + rndB) * 3.4);

  // ② 渐变主斜坡：多条相加，用被折射过的 uvw；整组再乘视线因子。
  float grad = 0.0;
  for (int i = 0; i < GRADIENT_MAX; i++) {
    if (float(i) < uGradientCount) {
      grad += gradientRamp(uvw, uGradientMode[i], uGradientAngle[i], uGradientTwist[i], uGradientTwistSeed[i]) * uGradientDensity[i];
    }
  }
  phase += grad * (0.22 + 0.78 * nd);

  phase += keep * sin(uvw.x * 7.2 + uvw.y * 5.9 + angWarp * 0.55 + rndA * 2.1) * 0.88;
  phase += keep * sin(length(uvw - vec2(0.5)) * 21.0 - grazing * 5.0 + rndB * 3.3) * 0.62;
  phase += keep * sin(dot(uvw, vec2(11.7, 8.3)) + snR * 6.2) * 0.42;

  // ③ 几何刻纹：加在相位上 → 色相偏移。用**真实 uv**（不是 uv0），故不随**图层** offset 平移、
  // 也不受 distortion/noise 影响（那些作用在 uv0/uvw 上）；点阵因此钉在卡面上，只有它自己
  // 的 uLatticeOffsetX/Y 能挪动它（在 latticeField 里减）。固定序最后一档。
  float lat = 0.0;
  for (int i = 0; i < LATTICE_MAX; i++) {
    if (float(i) < uLatticeCount) {
      lat += latticeField(uv, uLatticeFamilies[i], uLatticeAngle[i], uLatticeDensity[i],
                          uLatticeWidth[i], uLatticeOffsetX[i], uLatticeOffsetY[i]) * uLatticeStrength[i];
    }
  }
  phase += lat * LATTICE_PHASE_SCALE;

  return phase;
}

// 由相位与视角得到全息颜色（与 buling 一致的调色板混色 + 边缘/正面增强）。
//
// time（秒）推进相位，让图案随时间自己流动——用于导出的透明 WebM（静卡·全息流动，见
// card-view 的离屏渲染）。**time=0 时逐项与之前一致**（相位不变），故实时预览把 uTime 恒置 0
// 即维持原观感。速率上 phaseSpeed 兼作「流动速度」：乘在时间项里，于是 0 = 冻结、越大越快；
// 常数 6.0 是相位单位/秒的人工调值——色带一个颜色周期约 28 相位单位，默认（phaseSpeed=1）
// 约 4.7 秒走完一轮，缓流而不闪。
// 返回 vec4：rgb 是全息色，a 是色标透明度混出来的覆盖率（乘进全息箔的 alpha）。
// 亮度增强只乘 rgb，不乘 a——色标变淡不该让箔变亮。
vec4 holoColor(float phase, float grazing, float phaseSpeed, float time) {
  phase += time * phaseSpeed * 6.0;
  float nd = 1.0 - grazing;
  float t1 = phase * 0.036 * phaseSpeed;
  float t2 = phase * 0.023 * phaseSpeed + grazing * 4.6;
  vec3 cA = spectrum(t1);
  vec3 cB = spectrum(t2 + 0.37);
  float w = pow(grazing, 1.05);
  vec3 col = mix(cA, cB, w);
  col *= 1.05 + 0.55 * pow(grazing, 1.25) + 0.15 * pow(nd, 0.5);
  return vec4(col, mix(spectrumAlpha(t1), spectrumAlpha(t2 + 0.37), w));
}

// 与 TS 侧 mapping 的 smoothstep 同构：e0==e1 时退化为硬边，避免 smoothstep 除零得 NaN。
float safeSmoothstep(float e0, float e1, float x) {
  if (abs(e1 - e0) < 1e-5) return step(e0, x);
  return smoothstep(e0, e1, x);
}

// 图蒙版的采样坐标：把卡面点按「位移 / 缩放 / 旋转」变换到蒙版图 uv，并给出是否落在图内。
//
// 与图层图片效果同一套变换（见 layer.ts 的 imgUv）：卡面等比坐标（x 乘 aspect）、中心是平移项、
// 采样点逆着图片朝向转（正角于是看起来是屏幕顺时针）。差别只在尺寸来源——图片按自身比例自适应，
// 蒙版的尺寸先按填充方式（缺省覆盖）换算、再乘 scale，由调用方填好（见 mask-uv.ts 的 maskUvParams）。
//
// 返回 vec3(muv, inside)：muv 可越界，调用方应先 clamp 再采样（CLAMP_TO_EDGE 会把边缘像素拉出去，
// 故越界处的亮度无意义）；inside 为 0/1，用来把越界处视为「没有蒙版数据」→ 权重 1（不裁切）。
vec3 maskSampleUv(vec2 uv, float aspect, vec2 center, vec2 size, float rotation) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 q = p - center;
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  // 分母兜底：schema 下限虽然大于 0，但 uniform 是外部可写的，别让 0 除进去。
  vec2 muv = r / max(size, vec2(1e-4)) + 0.5;
  float inside = step(0.0, muv.x) * step(muv.x, 1.0)
               * step(0.0, muv.y) * step(muv.y, 1.0);
  return vec3(muv, inside);
}

// 蒙版擦除：一张与卡面同比例的黑白图（黑 = 擦掉、白 = 保留），按卡面原始 vUv 取样后
// 直接乘进最终 alpha。它不看蒙版是图片、颜色还是程序化生成的——「只留想要的部分」
// 对每种蒙版都成立，故作用点是「最终 alpha」而不是某条蒙版通路。
uniform sampler2D uEraseMap;
uniform float uHasErase;

float eraseWeight(vec2 uv) {
  if (uHasErase < 0.5) return 1.0;
  // 取亮度而非单通道：图片编辑器里导出的图即便带轻微色彩偏移，也按肉眼亮度理解。
  return dot(texture2D(uEraseMap, uv).rgb, vec3(0.299, 0.587, 0.114));
}

// 蒙版权重：与 TS 侧 mapping.maskWeight() 同构。hasMask=0 时整卡出全息。
float maskWeight(float lum, float hasMask, float maskMode, float invert, float e0, float e1) {
  if (hasMask < 0.5) return 1.0;
  float l = mix(lum, 1.0 - lum, invert);
  float lineW = 1.0 - safeSmoothstep(e0, e1, l);
  float fillW = smoothstep(0.5, 1.0, l);
  return mix(fillW, lineW, maskMode); // maskMode: 1=line, 0=fill
}

// 颜色蒙版权重：与 TS 侧 mapping.colorKeyWeight() 同构。hasMask=0 时整卡出全息。
//
// 距离取 RGB 三分量的均方根差（除以 √3 归一化到 0–1），与 TS 侧同一公式；上下限写反时按
// min/max 兜底，与 TS 侧一致。阈值带内用 safeSmoothstep，e0 == e1 时退化为硬边。
float colorKeyWeight(vec3 rgb, float hasMask, vec3 key, float invert, float e0, float e1) {
  if (hasMask < 0.5) return 1.0;
  float d = distance(rgb, key) * 0.5773502692;
  float lo = min(e0, e1);
  float hi = max(e0, e1);
  float w = 1.0 - safeSmoothstep(lo, hi, d);
  return mix(w, 1.0 - w, invert);
}

// ── 光泽（颜色组）——卡面 / 图层共用 ──
//
// 光泽是「往目标颜色里加光带」。卡面加在底图 rgb 上、图层加在全息色 holo 上，光带几何与
// 切带完全一致，故两处片元共用这两个函数（主色作入参）。相位（摩尔纹 / 渐变 / 刻纹）不在此——
// 那是 holoPhase 的事，只作用于图层。

// 有效摩尔纹场之和：供光泽「切带」用（见下）。取本目标 uMoire* 数组各条的场之和——该数组由
// host 侧按「自身 moire，为空则继承卡面」的规则填好，故此处读到的就是**有效**摩尔纹。
// 与 holoPhase 内的同名求和不共用：那里吃的是偏移 / 折射后的 uv0，而光带几何建在真实 uv 上，
// 切带必须与光带同处一个坐标域，故这里吃真实 uv。
float moireSliceSum(vec2 uv) {
  float s = 0.0;
  for (int m = 0; m < MOIRE_MAX; m++) {
    if (float(m) < uMoireCount) {
      s += moireField(uv, uMoireMode[m], uMoireAngle[m], uMoireDensity[m], uMoireTwist[m], uMoireTwistSeed[m]) * uMoireDepth[m];
    }
  }
  return s;
}

// 卡面浮雕用的摩尔纹场之和（高度场）：与 moireSliceSum 同源（都是本目标 uMoire* 数组各条的场之
// 和），但每条再乘该条的 faceStrength——faceStrength = 0（默认）的条目对浮雕零贡献，于是存量系列
// 卡面逐像素不变。base.ts 把本和当作卡面的一层「高度场」，见下方 moireRelief；光带切带仍走
// moireSliceSum。
float moireFaceSum(vec2 uv) {
  float s = 0.0;
  for (int m = 0; m < MOIRE_MAX; m++) {
    if (float(m) < uMoireCount) {
      s += moireField(uv, uMoireMode[m], uMoireAngle[m], uMoireDensity[m], uMoireTwist[m], uMoireTwistSeed[m])
           * uMoireDepth[m] * uMoireFaceStrength[m];
    }
  }
  return s;
}

// ── 法线（bump）──
//
// 法线贴图不是上传的资源，而是由图片亮度差当场生成的伪法线：相邻采样的亮度差即高度场的斜率，
// 斜率一路分给两处——扰动法线（光照 / 反射），以及推动效果 UV（光泽 / 摩尔纹 / 刻纹的走势）。
// 「从哪里取图」（卡面底图 / 图层图片）在各自片元里做，这里只放与来源无关的数学。

// 亮度：与蒙版口径一致（Rec. 601）。
float bumpLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// 高度场斜率：左右 / 上下两组中心差分，各乘 0.5 还原成单位距离的差。
// invert > 0.5 时整体取反（凹变凸）；符号乘在斜率上，不翻光照方向。
vec2 bumpSlope(float hl, float hr, float hd, float hu, float invert) {
  vec2 s = 0.5 * vec2(hr - hl, hu - hd);
  return invert > 0.5 ? -s : s;
}

// 扰动法线：把斜率投到切线 / 副切线上，从几何法线里减掉。强度上乘 4 是因为正常图片的
// 相邻亮度差只有 0.1 量级，不放大几乎看不出；归一化后 N 仍是单位向量。
vec3 bumpNormal(vec3 N, vec3 T, vec3 B, vec2 slope, float strength) {
  return normalize(N - (T * slope.x + B * slope.y) * (strength * 4.0));
}

// UV 流向（0.06 是手感系数）：把效果图案顺着坡向推一点，光泽 / 摩尔纹 / 刻纹于是像被这道
// 起伏带偏。flow = 0 时恒为 0，效果只受法线（光照 / 反射）影响。
vec2 bumpWarp(vec2 slope, float strength, float flow) {
  return slope * (strength * flow * 0.06);
}

// ── 法线贴图 ──
//
// 用户自带的切线空间法线图：RGB 编码 XYZ（[0,1]，故解码要 ×2−1）。取 xy 当作高度场的斜率，
// 下游（扰动法线 / UV 流向 / 明暗）与亮度伪法线完全共用——两种来源于是只有一个强度滑块。
// 选了贴图就**整段接替**亮度差（见 bump.ts）：一张图里已写死形状，再掺亮度差只会搅乱它。
uniform sampler2D uNormalMap;
uniform float uBumpMode;  // 1 = 采法线贴图；0 = 亮度伪法线（默认）
uniform float uBumpFlipY; // 1 = 翻转绿通道（DirectX ↔ OpenGL 约定相反时）
// 法线贴图的坡向量级比亮度差大（前者是单位法线的 xy，后者是相邻像素的亮度差），
// 乘 0.35 让同一强度滑块在两种来源下「凸度」相当。与 MOIRE_RELIEF_* 同类：人工对照的视觉系数。
const float NORMAL_MAP_SLOPE_SCALE = 0.35;

// 法线贴图 → 高度场斜率。越界（适配留白 / 缩小露出的角）按平地处理——与亮度通路图外取
// 0 高度同口径，否则图边会拉出一圈假斜坡。取负号：贴图 x 向右凸起时高度沿 x 的斜率是负的，
// 与 bumpSlope 的 (hr - hl) 同符号；invert 再把整条斜率取反（凹变凸），与亮度通路一致。
vec2 normalMapSlope(vec2 uv, float flipY, float invert) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(0.0);
  vec3 tn = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0;
  if (flipY > 0.5) tn.y = -tn.y;
  vec2 s = -tn.xy * NORMAL_MAP_SLOPE_SCALE;
  return invert > 0.5 ? -s : s;
}

// ── 卡面浮雕（摩尔纹）──
//
// 把摩尔纹场当作卡面的一层「高度场」，沿一束**固定斜向**光照取它的方向导数（沿光向走一小步再作
// 差），得到明暗——刻纹于是以凸起 / 凹陷的浮雕显在卡面上。要点有三：
//  - 为什么必须用**斜**光而不能用视线 V：V 近似垂直于卡面、正落在高度曲线顶部，扰动后 N·V 的
//    一阶项相互抵消、只剩二阶的微弱变化——这与被替换掉的「折射」一样肉眼看不见。换成一束斜向的
//    L，一阶项（∝ 沿 L 的方向导数）不再抵消，刻纹立刻显出明暗。
//  - 步长 STEP 定义在 **UV 空间**、与画布像素无关：浮雕深度因此不随缩放 / 导出分辨率变化（若改用
//    屏幕空间导数 dFdx/dFdy，同一张卡放大导出会变浅）。
//  - 三个常量皆与 LATTICE_PHASE_SCALE 同类——不可自动化验证、靠人工对照的视觉系数。
const vec2 MOIRE_RELIEF_LIGHT = vec2(-0.6, 0.8); // 固定斜向光（UV 平面内的单位向量）
const float MOIRE_RELIEF_STEP = 0.004;           // 沿光向的取样步长（UV 单位）
const float MOIRE_RELIEF_GAIN = 1.5;             // 高度差 → 明暗幅度的换算系数

// 法线高度场的明暗因子：slope 是图片亮度差的斜率（见 bumpSlope），与一束斜光做点积。这是场景里
// 唯一的光——材质用的是裸 ShaderMaterial，不参与 three 的光照，故明暗只能这样内嵌。
//  - angle 是光的方向（度，UV 平面内、+x 为 0 逆时针）。缺省 127° 与刻纹浮雕的固定斜光
//    MOIRE_RELIEF_LIGHT（≈126.87°）同向，两者凸起处的亮暗不打架；用户改了方向后视觉上分道扬镳，
//    这是刻意的取舍：浮雕的系数是人工对照定的，不随滑块变。
//  - tint 只染亮侧（白 = 中性），暗侧按灰度压暗：彩色光因此不会把影子染成补色块。
//  - light = 0 时恒为 1.0：加此项之前的存量画面逐像素不变（强度 0 / 无图文时根本走不到这里）。
vec3 bumpShadeAmount(vec2 slope, float strength, float light, float angle, vec3 tint) {
  float a = radians(angle);
  vec2 L = vec2(cos(a), sin(a));
  float d = dot(slope, L) * strength * light * MOIRE_RELIEF_GAIN * 4.0;
  return clamp(vec3(1.0) + min(d, 0.0) + max(d, 0.0) * tint, 0.25, 1.75);
}

// 卡面浮雕的明暗因子：h0 与沿光向偏移一步处的 hL 之差（≈ 沿光向的方向导数）。无刻纹时 h≡0
// ⇒ 恒返回 1.0，保证 faceStrength = 0（默认）的卡面逐像素不变。末端 clamp 防高密度下过冲。
float moireRelief(vec2 uv) {
  float h0 = moireFaceSum(uv);
  float hL = moireFaceSum(uv + MOIRE_RELIEF_LIGHT * MOIRE_RELIEF_STEP);
  return clamp(1.0 + (hL - h0) * MOIRE_RELIEF_GAIN, 0.25, 1.75);
}

// ── 图层内容浮雕（刻纹 / 摩尔纹）──
//
// 图层和卡面一样有「内容」：卡面是底图，图层是图片 / 文字。颜色 / 相位类效果必须作用在这层
// 内容上，否则给图片层加刻纹、加摩尔纹就等于什么都没发生——它们全被不透明的图片盖住了。
// 表现方式与卡面浮雕同源（高度场取方向导数），差别有二：
//  - 高度场吃本层**全部**相位效果：刻纹按 strength、摩尔纹按 depth。图层没有再分「全息 / 卡面」
//    两套强度，加进来就应该看得见，故不像卡面那样另开 faceStrength 开关。
//  - 摩尔纹只取自有条数 uOwnMoireCount：uMoire* 里可能是从卡面继承来的（toEffectUniforms 的
//    inheritedMoire），那份是给全息相位与光带切带用的，不该把卡面花纹压到本层图片上。
float layerContentHeight(vec2 uv) {
  float s = 0.0;
  for (int m = 0; m < MOIRE_MAX; m++) {
    if (float(m) < uOwnMoireCount) {
      s += moireField(uv, uMoireMode[m], uMoireAngle[m], uMoireDensity[m], uMoireTwist[m], uMoireTwistSeed[m])
           * uMoireDepth[m];
    }
  }
  for (int i = 0; i < LATTICE_MAX; i++) {
    if (float(i) < uLatticeCount) {
      s += latticeField(uv, uLatticeFamilies[i], uLatticeAngle[i], uLatticeDensity[i],
                        uLatticeWidth[i], uLatticeOffsetX[i], uLatticeOffsetY[i]) * uLatticeStrength[i];
    }
  }
  return s;
}

// 内容浮雕的明暗因子：与 moireRelief 同构，只是高度场换成 layerContentHeight。
// 没有自有相位效果时直接返回 1：图片 / 文字层不为此多付两次高度场计算，逐像素不变。
float layerContentRelief(vec2 uv) {
  if (uOwnMoireCount < 0.5 && uLatticeCount < 0.5) return 1.0;
  float h0 = layerContentHeight(uv);
  float hL = layerContentHeight(uv + MOIRE_RELIEF_LIGHT * MOIRE_RELIEF_STEP);
  return clamp(1.0 + (hL - h0) * MOIRE_RELIEF_GAIN, 0.25, 1.75);
}

// 光泽的公共数学：先求「到最近一条光带的距离 d」，再分别用于加光（glossBands）与蒙版覆盖率
// （glossMaskWeight）。参数全为标量是有原因的：GLSL ES 1.00 的数组下标必须是
// constant-index-expression，把槽位号当函数入参会让函数内的 uGloss*[slot] 变成非法下标——
// 数组取值只能留在调用方的定长循环里。
//
// [offsetX] / [offsetY] 让整场图案平移（UV 域，正 = 图案往右 / 往上挪）：所有模式共用
// gu = uv - offset 这一份坐标，缺省 0 时 gu ≡ uv，逐位退回原式。
// [viewX] 是反射向量 R 的 x 分量，用于三种模式各自的视线驱动扫掠（平行 / 光环 = 平移图样坐标，
// 射线 = 转动整扇极角）——缺了它光带就会钉在 UV 上、转卡不动。
float glossDistance(vec2 uv, float mode, float bands, float spacing, float angle, float twist, float twistSeed, float offsetX, float offsetY, float viewX) {
  vec2 gu = uv - vec2(offsetX, offsetY);
  vec2 gc = gu - 0.5;
  vec2 gdir = vec2(cos(radians(angle)), sin(radians(angle)));
  // 三种模式坐标不同，分两支求 d：
  //   平行 / 光环 = 有边界的坐标 → 定长循环取最近中心（见下方 return 前的循环）；
  //   射线       = 极角、在整圆上环绕 → 取整环绕求最近射线（无首尾边界）。
  if (mode > 1.5) {
    // 射线：以卡心（平移后）为极点的极角坐标，bands 条等角射线（含方向角旋转与螺旋扭曲）。
    // width 在此按**弧度**理解为射线的角半宽——极角本就是弧度，无需另换量纲。
    // 取到最近整数扇区的距离即为到最近射线的角距（floor(x+0.5) 是四舍五入，天然含环绕）。
    // viewX * 0.35：视线驱动扫掠，与平行 / 光环同源（那里的 0.35 是 UV 量纲的平移，
    // 这里极角是弧度，故直接加到角上——表现为整扇射线随视角转动）。缺此项射线就钉死在
    // UV 上、转卡不动。
    float a = atan(gc.y, gc.x) - radians(angle) + viewX * 0.35 + twistPhase(gu, twist, twistSeed);
    float sector = 6.2831853 / max(bands, 1.0);
    return abs(a / sector - floor(a / sector + 0.5)) * sector;
  }
  // 图样坐标：平行 = 沿 dir 的投影（乘 1.1180 还原原式未归一化方向 (1,0.5) 的投影 U + 0.5V）；
  // 光环 = 到（平移后）卡心的半径。参考点：平行取 0.5（与原式 abs(coord-0.5) 逐项同构），光环取 0。
  float refCoord = (mode < 0.5) ? 0.5 : 0.0;
  float coord = (mode < 0.5) ? 1.1180 * dot(gu, gdir) : length(gc);
  coord += viewX * 0.35;                              // 视线驱动的扫掠（既有固定行为，不开放参数）
  coord += twistPhase(gu, twist, twistSeed);          // 随半径增长的旋转，中心与紧松由种子定

  // 到最近条纹中心的距离。定长循环上界 16 是 GLSL ES 1.00 的 constant-index-expression 要求，
  // 与 schema 的 bands 上限一一对应；bands=1 时中心即 ref，退化为 abs(coord-ref)。
  float d = 1e9;
  for (int i = 0; i < 16; i++) {
    if (float(i) < bands) {
      float center = refCoord + (float(i) - (bands - 1.0) * 0.5) * spacing;
      d = min(d, abs(coord - center));
    }
  }
  return d;
}

// 光带边缘剖面（0–1）：到条纹中心距离 d 处的亮度，radius 之外为 0。
//
// softness = 1 时羽化铺满整个半径（feather = r），于是 smoothstep(0, r, d)——与引入本参数前
// 的 1 - smoothstep(0.0, radius, d) 逐像素一致；softness = 0 时过渡带只剩 1e-4 宽，读作硬边。
// 下限 1e-4 是给 smoothstep 的两个边界留缝隙：相等时 smoothstep 在 GLSL 里未定义。
float glossProfile(float d, float radius, float softness) {
  float r = max(radius, 1e-4);
  float feather = max(r * clamp(softness, 0.0, 1.0), 1e-4);
  return 1.0 - smoothstep(r - feather, r, d);
}

// 蒙版覆盖率（0–1）：核心带的权重，radius 即蒙版窗口大小、softness 即边缘软硬。与加光带不同，
// 它必须是完整的 0–1 覆盖率（加光带是 0.08 / 0.25 的弱权重量级，拿来当 alpha 会几乎全透明）。
// 光带随倾斜扫动，故这是一扇会滑过卡面的「窗口」——子图层只在窗口里露出来。
float glossMaskWeight(vec2 uv, float mode, float bands, float spacing, float width, float angle, float twist, float twistSeed, float offsetX, float offsetY, float viewX, float moireSum, float softness) {
  float d = glossDistance(uv, mode, bands, spacing, angle, twist, twistSeed, offsetX, offsetY, viewX) + moireSum * 0.08;
  return glossProfile(d, width, softness);
}

// 光泽光带：把最多 GLOSS_MAX 条光带叠加到 [baseColor] 上并返回（多条相加 ⇒ 顺序无关，按数组
// 序直加即可）。[moireSum] 由调用方按有效摩尔纹算好传入，用来把光带切成明暗切片。
// asMask 的条目整体跳过：它不出光，只作为子树蒙版（见 glossMaskWeight）。
//
// 循环索引 g / i 都是本函数的局部循环变量（上界为常量），属 GLSL ES 1.00 的合法
// constant-index-expression——**不能**改成入参下标，否则数组下标不再是常量表达式，编译不过。
vec3 glossBands(vec3 baseColor, vec2 uv, float moireSum, float viewX) {
  vec3 rgb = baseColor;
  for (int g = 0; g < GLOSS_MAX; g++) {
    if (float(g) < uGlossCount && uGlossAsMask[g] < 0.5) {
      float d = glossDistance(uv, uGlossMode[g], uGlossBands[g], uGlossSpacing[g], uGlossAngle[g], uGlossTwist[g], uGlossTwistSeed[g], uGlossOffsetX[g], uGlossOffsetY[g], viewX);
      d += moireSum * 0.08;

      // 边界与原式一致：soft 取 width*4.1667（默认 width=0.12 → 0.5），bright 取 width。
      // 羽化按各自半径取比例：softness = 1 时两条带都退回原来的整段渐隐。
      float soft = uGlossSoftness[g];
      float bandSoft = glossProfile(d, uGlossWidth[g] * 4.1667, soft);
      float bandBright = glossProfile(d, uGlossWidth[g], soft);
      float band = bandSoft * 0.08 + bandBright * 0.25;
      float ga = uGlossAlpha[g];
      vec3 bandColor = uGlossColor[g] * band * uGlossIntensity[g] * ga;
      float darken = 1.0 - 0.2 * uGlossIntensity[g] * ga;
      rgb = rgb * darken + bandColor;
    }
  }
  return rgb;
}
`
