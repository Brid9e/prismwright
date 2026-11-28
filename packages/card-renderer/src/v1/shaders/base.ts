/**
 * 卡面材质片元着色器：卡面图 + 可选光泽光带 + 蒙版通路 + 圆角遮盖。
 *
 * 移植自 `buling/utils/materials/card-material.js` 的 glossy 段（本编辑器把 holo 拆到
 * 图层材质，故此处保留「底图 + 光泽 + 蒙版」）。`#include <colorspace_fragment>` 由 three
 * 注入，负责线性工作空间 → 输出色彩空间的转换（见 Task 11 的色彩管线说明）。
 *
 * 光泽光带由卡面效果列表驱动。光带几何与切带都交给 `GLSL_COMMON.glossBands`（与图层片元
 * 共用同一段数学，只是主色不同：卡面是底图 RGB、图层是全息色）。卡面末尾再乘一层蒙版权重——
 * 图蒙版或程序化蒙版二选一，与图层片元同构，用于卡面镂空 / 裁切。
 *
 * 摩尔纹在卡面上有两条通路：① 经 `moireSliceSum` **切光带**（刻纹把光带切成明暗切片，见
 * `glossBands`）；② 经 `moireRelief` **把刻纹渲染成浮雕**（以摩尔纹场为高度场、沿固定斜向光取
 * 方向导数得明暗，由 `MoireParams.faceStrength` 单独门控、默认关）。前者需有光泽条目才可见，
 * 后者不依赖光泽。
 *
 * 蒙版通路现与图层片元**逐字同构**：两者都用 `uMaskPresetCount` 计数门控（不再有卡面专用的
 * `uHasMaskPreset` 布尔），程序化蒙版的反转逐条自带（`uMaskPresetInvert[i]`），图蒙版的反转是
 * 共用标量 `uMaskInvert`——故同一套 uniform 名、同一段分支式在两片元里逐字一致。
 */
import { GLSL_COMMON } from "./common"

export const BASE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
// 底图采样变换（见 front-uv.ts）：2×2 矩阵按列主序存放（matrix.xy = 第一列、matrix.zw = 第二列），
// 与 uMapOffset 一起把卡面 uv 换算成底图 uv。旋转 / 缩放 / 偏移都折在这里。
uniform vec4 uMapMatrix;
uniform vec2 uMapOffset;
// 底图没覆盖到的位置（适应模式留白、缩小 / 旋转露出的角）垫的卡面默认底色。
uniform vec3 uMapBackground;
// 1 = 有真卡面图；0 = 只有 1×1 占位纹理（此时直接 uMapBackground，不采占位像素）。
uniform float uHasFront;
uniform sampler2D uMask;              // 卡面图蒙版（与图层同构）
uniform sampler2D uFrontMap;          // 卡面原图：颜色蒙版按此采样（原始 uv，不含底图变换）
uniform float uTime;                 // 秒；自流动时推进光泽/摩尔纹图案，静止时为 0
uniform float uMaskSource;            // 蒙版来源：1 = color，0 = image
uniform vec3 uMaskColor;              // 吸管拾取的颜色（线性工作空间）
uniform vec3 uCameraPosition;
uniform float uAspect;
uniform float uCornerRadius;
uniform float uHasMask;
// 绘画辅助：1 = 把被擦掉的区域铺一层半透明底色。擦除后该处本就是透明的（只剩棋盘底），
// 没有底色就分不清「擦到哪了」；只在交互视图的绘画会话里打开，离屏导出恒为 0。
uniform float uErasePreview;
uniform float uMaskMode;             // 1 = line, 0 = fill
uniform float uMaskInvert;           // 图蒙版（uMask）的反转；程序化蒙版的反转逐条自带（uMaskPresetInvert）
uniform float uLineEdge0;
uniform float uLineEdge1;
// 图蒙版的位移 / 缩放 / 旋转（与图层同构，见 common.ts 的 maskSampleUv）。
uniform vec2 uMaskCenter;    // 蒙版图中心（卡面等比坐标，卡高 = 1）
uniform vec2 uMaskSize;      // 蒙版图在卡面上的宽高（卡面等比坐标）
uniform float uMaskRotation; // 蒙版图旋转（弧度，正 = 屏幕顺时针）
// 法线（bump）：来源 0 = 关、1 = 卡面底图（卡面片元只会收到这两个值）。见 bump.ts 与
// GLSL_COMMON 的法线数学。
uniform float uBumpSource;
uniform float uBumpStrength;
uniform float uBumpDetail;
uniform float uBumpFlow;
uniform float uBumpLight;
uniform float uBumpLightAngle;
uniform vec3 uBumpLightColor;
// 光照颜色的透明度：0 = 白光（不着色），只影响亮侧的染色，暗侧不受影响。
uniform float uBumpLightAlpha;
uniform float uBumpInvert;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;
varying vec2 vUv;

${GLSL_COMMON}

// 法线高度场：卡面底图在卡面 UV 处的亮度。越界（适应模式留白 / 缩小露出的角）视为平地，
// 与颜色取样垫底色的口径一致——否则画外的 0 亮度会在图边拉出一圈假斜坡。
float faceBumpHeightAt(vec2 uv) {
  vec2 m = mat2(uMapMatrix.xy, uMapMatrix.zw) * (uv - 0.5) + 0.5 + uMapOffset;
  if (any(lessThan(m, vec2(0.0))) || any(greaterThan(m, vec2(1.0)))) return 0.0;
  return bumpLuma(texture2D(uMap, m).rgb);
}

void main() {
  vec3 V = normalize(uCameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);

  // 底图按填充方式 / 偏移 / 缩放 / 旋转换算出的 mapUv 取样。越界（适应模式的留白、缩小 / 旋转
  // 露出的角）垫卡面默认底色——不能直接丢弃，也不能让 CLAMP_TO_EDGE 去拉边缘像素；前者是透明
  // 洞，后者是一条拉伸的色带。蒙版、光泽、圆角仍用真实 vUv（卡面轮廓不跟着图走）。
  // 法线贴图也按 mapUv 采样，故它要先算出来（原本在法线段之后）。
  vec2 mapUv = mat2(uMapMatrix.xy, uMapMatrix.zw) * (vUv - 0.5) + 0.5 + uMapOffset;

  // 法线：由底图亮度差当场生成（选了法线贴图时改采贴图）。启用时两处一起改——N 给光照 /
  // 反射，bUv 给效果图案的走势。关闭时 bUv ≡ vUv、N 不变、bumpShade ≡ 1，画面逐像素退回
  // 加该特性之前。bumpShade 是高度场在那束斜光下的明暗：没有光泽 / 摩尔纹 / 刻纹可扰动时，
  // 凹凸只靠它显形。
  vec2 bUv = vUv;
  vec3 bumpShade = vec3(1.0);
  if (uBumpSource > 0.5) {
    vec2 slope;
    if (uBumpMode > 0.5) {
      // 法线贴图自带形状，取样点跟底图走（与颜色取样同一处变换）。
      slope = normalMapSlope(mapUv, uBumpFlipY, uBumpInvert);
    } else {
      // 步长按卡宽换算，横竖两个方向的细节尺度一致（uAspect = 宽 / 高）。
      vec2 dv = vec2(uBumpDetail / max(uAspect, 1e-4), uBumpDetail);
      slope = bumpSlope(
        faceBumpHeightAt(vUv - vec2(dv.x, 0.0)),
        faceBumpHeightAt(vUv + vec2(dv.x, 0.0)),
        faceBumpHeightAt(vUv - vec2(0.0, dv.y)),
        faceBumpHeightAt(vUv + vec2(0.0, dv.y)),
        uBumpInvert);
    }
    N = bumpNormal(N, normalize(vWorldTangent), normalize(vWorldBitangent), slope, uBumpStrength);
    bUv = vUv + bumpWarp(slope, uBumpStrength, uBumpFlow);
    bumpShade = bumpShadeAmount(slope, uBumpStrength, uBumpLight, uBumpLightAngle, mix(vec3(1.0), uBumpLightColor, uBumpLightAlpha));
  }

  vec3 R = reflect(-V, N);

  // 自流动：只推进光泽/摩尔纹用到的 UV，底图采样仍用真实 vUv（图片本身不跟着漂）。
  vec2 flowUv = bUv + vec2(0.0, uTime * 0.08);

  // 本目标有效摩尔纹场之和（见 GLSL_COMMON.moireSliceSum）：供光泽切带（下方 glossBands）。只
  // 依赖 bUv 与 uMoire* 数组、与具体光带 g 无关，故只算一次。用扰动后的 UV：摩尔纹跟着法线走。
  float moireSum = moireSliceSum(flowUv);

  // 卡面图仍按真实 vUv 采样（浮雕不挪采样点），随后乘上浮雕明暗因子——把刻纹作为高度场渲染成
  // 明暗，使卡面本身显出磨砂 / 蚀刻质感，而不必依赖光泽（光泽只在有条目、且恰有光带落到刻纹上时
  // 才把刻纹切成明暗）。faceStrength 默认 0 ⇒ 因子恒为 1 ⇒ 卡面逐像素不变。蒙版 / 圆角也照旧吃
  // 真实 vUv。
  // mapUv 已在法线段之前算好（法线贴图也要按它采样）。
  vec4 base;
  if (uHasFront < 0.5
      || any(lessThan(mapUv, vec2(0.0))) || any(greaterThan(mapUv, vec2(1.0)))) {
    base = vec4(uMapBackground, 1.0);
  } else {
    base = texture2D(uMap, mapUv);
  }
  vec3 rgb = base.rgb * moireRelief(bUv) * bumpShade;

  // 颜色组：光泽往底图 RGB 加光带（共用件见 GLSL_COMMON.glossBands）。光带用扰动后的 UV 与
  // 反射 R，于是随法线起伏扫动 / 变形。
  rgb = glossBands(rgb, flowUv, moireSum, R.x);

  // 卡面补蒙版通路：图蒙版 / 程序化蒙版二选一，与图层片元逐字同构（都用 uMaskPresetCount 计数门控）。
  // 内置蒙版启用时就不必采图：门控在前，省一次纹理取样。
  // 图蒙版按位移 / 缩放 / 旋转变换后采样（与图层同构）。蒙版图没盖到的地方 maskInside = 0，
  // 视为「没有蒙版数据」→ 权重 1（不裁切）；否则缩小 / 挪走的蒙版图会把整卡裁掉。
  float lum = 0.0;
  vec3 art = vec3(0.0);
  float maskInside = 1.0;
  if (uHasMask > 0.5 && uMaskPresetCount < 0.5) {
    vec3 ms = maskSampleUv(vUv, uAspect, uMaskCenter, uMaskSize, uMaskRotation);
    if (uMaskSource > 0.5) {
      art = texture2D(uFrontMap, clamp(ms.xy, 0.0, 1.0)).rgb;
    } else {
      lum = dot(texture2D(uMask, clamp(ms.xy, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
    }
    maskInside = ms.z;
  }
  // 程序化蒙版的 invert 逐条自带（见 common.ts 的 presetMaskWeight），故这里不再传 invert。
  float mw = (uMaskPresetCount > 0.5)
    ? presetMaskWeight(vUv)
    : (uMaskSource > 0.5
      ? mix(1.0, colorKeyWeight(art, uHasMask, uMaskColor, uMaskInvert, uLineEdge0, uLineEdge1), maskInside)
      : mix(1.0, maskWeight(lum, uHasMask, uMaskMode, uMaskInvert, uLineEdge0, uLineEdge1), maskInside));

  float card = roundedRectMask(vUv, uAspect, uCornerRadius);
  // 蒙版擦除是最后一道：整张卡（含全部图层）的输出都乘它，故与蒙版种类无关。
  float ew = eraseWeight(vUv);
  float alpha = base.a * card * mw * ew;
  // 绘画辅助（只在交互视图的绘画会话里打开）：擦掉的部分留一层半透明底色，否则它只是
  // 一片透明，用户看不出笔迹边界。图层在同一处同样被擦掉，故底色的可见范围就是擦除区域。
  // 用数值而非色值字面量：着色器字符串里写 #hex 会被 lint 的硬编码色值规则命中。
  if (uErasePreview > 0.5) {
    rgb = mix(rgb, vec3(1.0, 0.35, 0.35), 1.0 - ew);
    alpha = max(alpha, card * (1.0 - ew) * 0.5);
  }
  if (alpha < 0.001) discard;

  gl_FragColor = vec4(rgb, alpha);
  #include <colorspace_fragment>
}
`
