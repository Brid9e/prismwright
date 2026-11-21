/**
 * 全息图层材质片元着色器：视角驱动镭射色 × 蒙版权重 × 不透明度。
 *
 * 移植自 `buling/utils/materials/holo-foil-overlay.js`，并按本编辑器模型扩充：
 * - 新增蒙版：`uMask` / `uMaskMode` / `uMaskInvert` / `uLineEdge0` / `uLineEdge1`；
 * - 保留 overlay 的相位与调色板公式，但叠加 `uOpacity` 作为图层整体不透明度；
 * - 逐像素噪声的幅度交由 `uNoiseStrength` 控制（原版恒为满档），见 `common.ts` 的 holoPhase；
 * - 与卡面共用圆角遮盖，保证图层不会画到卡片轮廓之外；
 * - 图案偏移 `uOffset`（UV）作用在两处：UV 域（色带/环/噪声一起平移）与视线域（那个尖跟着走）。
 * - 新增**祖先蒙版软裁切**：逐祖先相乘 `maskWeight`（见下），于是父层蒙版裁切整棵子树。
 * 无蒙版（`uHasMask=0`）时自身权重恒为 1，退化为 overlay 的「整卡出全息」。
 * - 新增 **`uHasHolo` 门**：本层 palette 的色标为空时置 0，把它自己的全息 alpha 归零——本层
 * 不出箔，但作为祖先仍以其蒙版裁切子树（故「删空色板 = 纯蒙版」）。颜色类效果不受这道门
 * 影响：它们作用在内容上（见下一条）。
 * - **内容也吃效果链**：图片 / 文字不是「盖住效果」的独立通路，刻纹 / 摩尔纹以浮雕明暗、光泽以
 *   光带作用在它们上面（与卡面同一批公共件），否则给图片层加效果等于什么都没发生。
 * - 相位可随时间推进（`uTime`）：在视角／几何驱动的图案上再叠一个时间项让它自己流动；仅离屏
 * 导出驱动，实时预览恒置 0，故默认观感逐像素不变（见 common.ts 的 holoColor）。
 * - **倾斜灵敏度**（`uTiltGain`）：把法线相对「正对相机」的偏离按倍数放大，控制转卡时花纹扫过
 * 的快慢；只缩放法线，平卡时法线与正对方向重合，故任何增益都不改动静止画面。
 * - 新增**程序化蒙版**：`uMaskPresetCount` 大于 0 时改用 `shardField` 取权重（见 common.ts）。
 * - 新增**光泽**：图层效果列表里的光泽条目往全息色上叠加光带（`GLSL_COMMON.glossBands`，与卡面
 *   同一段数学），使「把光泽挂到图层」与卡面同构；光带随全息色一起被蒙版权重相乘，故跟随图层蒙版。
 * - 新增**图片贴片**：图层效果里的 image 条目把该层铺成可平移 / 旋转 / 缩放的图片；采样与越界遮罩
 *   和全息一起在片元里做 over 合成，故图片自动继承蒙版 / 不透明度 / 圆角与祖先裁剪。
 * - 新增**蒙版擦除**：卡面的黑白擦除图（黑 = 擦掉）按原始 vUv 乘进全息与图片两路 alpha，
 *   与蒙版种类无关（见 common.ts 的 eraseWeight）。图层自己也能挂一张：本层 × 祖先 × 卡面
 *   三张相乘，故「擦掉父层」会连同其子树一起消失（与祖先蒙版同一个模型）。
 * - 新增**文字通路**：文字层多出一路与图片同构的 alpha（字形纹理），在图片与全息之上再做一次
 *   over 合成，故文字自动继承蒙版 / 不透明度 / 圆角 / 祖先裁剪与擦除。
 * - 新增**作为蒙版**：文字层勾上后本层不出图（文字 / 图片 / 全息三路 alpha 一起归零），但字形
 *   alpha 作为祖先文字蒙版裁切整棵子树——与图蒙版的继承模型一致，只是裁切源换成字形。
 */
import { MAX_NEST_DEPTH } from "@prismwright/schema"
import { GLOSS_MAX } from "../effects/registry"
import { GLSL_COMMON } from "./common"

/**
 * 生成「祖先擦除」的片元代码：每段用字面量下标，理由同 {@link ancestorClipGLSL}
 * （sampler 数组只能用常量整型表达式下标），且直接写在段内而不抽成带 sampler 参数的函数，
 * 与蒙版那几段保持同一种写法。
 */
function ancestorEraseGLSL(): string {
  const blocks: string[] = []
  for (let i = 0; i < MAX_NEST_DEPTH; i++) {
    blocks.push(`  if (uAncestorHasErase[${i}] > 0.5) {
    ancestorErase *= dot(texture2D(uAncestorEraseMap[${i}], vUv).rgb, vec3(0.299, 0.587, 0.114));
  }`)
  }
  return blocks.join("\n")
}

/**
 * 生成「祖先蒙版软裁切」的片元代码：占位 `MAX_NEST_DEPTH` 段，每段用**字面量下标**。
 *
 * 每个槽位按 `uAncestorMaskKind` 分两种口径：图蒙版走亮度 / 颜色 + 阈值（`maskWeight` /
 * `colorKeyWeight`），文字蒙版则把字形 alpha 直接相乘。二者共用同一个采样器槽位——片元的
 * 纹理单元上限只有 16（ANGLE/D3D11 的 `MAX_TEXTURE_IMAGE_UNITS` 下限），再单开一组祖先文字
 * 蒙版采样器就会超限、整段片元编译失败。
 *
 * 为什么展开而不用 `for` 循环：GLSL ES 1.00 规定 `sampler2D` 数组只能用**常量整型表达式**作
 * 下标，循环变量在不少实现（ANGLE / 各家驱动）里不算常量——实测直接报
 * `array index for samplers must be constant integral expressions`，整段片元编译失败，图层材质
 * 全部不出图，表现就是「全息渐变整个消失、只剩卡面底图」。所以采样一律写成 `uAncestorMask[0]`、
 * `[1]`… 这样的字面量下标。浮点数组（hasMask / maskMode / …）本可动态索引，此处一并展开只为
 * 让每段同构、便于比对。
 *
 * 展开量由常量驱动：改 `MAX_NEST_DEPTH` 时这里自动跟随，不会与 TS 侧的定长数组脱节。
 */
function ancestorClipGLSL(): string {
  const blocks: string[] = []
  for (let i = 0; i < MAX_NEST_DEPTH; i++) {
    // 同一祖先上最多 GLOSS_MAX 条「作为蒙版」的光泽：逐条展开、逐条相乘（槽位字面量下标，
    // 理由同上）。覆盖率与颜色通路同源：倾斜扫掠、宽度、摩尔纹切带全部一致。
    let gloss = ""
    for (let j = 0; j < GLOSS_MAX; j++) {
      const h = i * GLOSS_MAX + j
      gloss += `
    if (uAncestorGlossCount[${i}] > ${j}.5) {
      ancestorClip *= glossMaskWeight(vUv, uAncestorGlossMode[${h}], uAncestorGlossBands[${h}], uAncestorGlossSpacing[${h}], uAncestorGlossWidth[${h}], uAncestorGlossAngle[${h}], uAncestorGlossTwist[${h}], uAncestorGlossTwistSeed[${h}], uAncestorGlossOffsetX[${h}], uAncestorGlossOffsetY[${h}], R.x, moireSliceSum(vUv), uAncestorGlossSoftness[${h}]);
    }`
    }
    blocks.push(`  {
    if (uAncestorMaskKind[${i}] > 0.5 && uAncestorHasMask[${i}] > 0.5) {
      ancestorClip *= texture2D(uAncestorMask[${i}], vUv).a;
    } else {
      float aLum = 0.0;
      vec3 aArt = vec3(0.0);
      float aInside = 1.0;
      if (uAncestorHasMask[${i}] > 0.5) {
        vec3 aMs = maskSampleUv(vUv, uAspect, uAncestorCenter[${i}], uAncestorSize[${i}], uAncestorRotation[${i}]);
        if (uAncestorSource[${i}] > 0.5) {
          aArt = texture2D(uFrontMap, clamp(aMs.xy, 0.0, 1.0)).rgb;
        } else {
          aLum = dot(texture2D(uAncestorMask[${i}], clamp(aMs.xy, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
        }
        aInside = aMs.z;
      }
      ancestorClip *= mix(1.0, (uAncestorSource[${i}] > 0.5)
        ? colorKeyWeight(aArt, uAncestorHasMask[${i}], uAncestorColor[${i}], uAncestorInvert[${i}], uAncestorEdge0[${i}], uAncestorEdge1[${i}])
        : maskWeight(aLum, uAncestorHasMask[${i}], uAncestorMaskMode[${i}], uAncestorInvert[${i}], uAncestorEdge0[${i}], uAncestorEdge1[${i}]), aInside);
    }${gloss}
  }`)
  }
  return blocks.join("\n")
}

export const LAYER_FRAGMENT = /* glsl */ `
// 数组长度须在编译期固定，故深度上限以宏注入（与 TS 侧的 MAX_NEST_DEPTH 单一来源）。
#define MAX_NEST_DEPTH ${MAX_NEST_DEPTH}
// 祖先光泽蒙版的展平长度：每个祖先槽位最多 GLOSS_MAX 条「作为蒙版」的光泽（按槽位 × 条序展平）。
#define ANCESTOR_GLOSS_MAX ${MAX_NEST_DEPTH * GLOSS_MAX}

uniform sampler2D uMask;
uniform vec3 uCameraPosition;
uniform float uAspect;
uniform float uCornerRadius;
uniform float uHoloMix;
uniform float uHoloAlpha;
uniform float uOpacity;
// 1 = 本层出全息箔；0 = 纯蒙版（palette 色标为空）——本层不出箔，仅以蒙版裁切子树。
uniform float uHasHolo;
// 调色板合成：0 = 色带（palette），1 = 叠色式 delta lerp + HSL 蓝偏。
uniform float uPaletteComposite;
// 叠色合成的可调项（默认即 holo.fs 的常量）。
uniform float uPaletteHue;
uniform float uPaletteSat;
uniform float uPaletteLift;
uniform float uPaletteTint;
uniform float uPaletteDeltaBase;
uniform float uPaletteDeltaContrast;
uniform float uPaletteDeltaBright;
// 网格效果：最多一条，作为相位加项（线族数学沿用 latticeField）。
uniform float uHoloGridCount;
uniform float uHoloGridFamilies[1];
uniform float uHoloGridAngle[1];
uniform float uHoloGridDensity[1];
uniform float uHoloGridWidth[1];
uniform float uHoloGridStrength[1];
uniform float uHoloGridOffsetX[1];
uniform float uHoloGridOffsetY[1];
uniform float uPhaseSpeed;
uniform float uTiltGain;
// 时间（秒）：推进全息相位，用于导出的透明 WebM。实时预览恒置 0（见 card-view），
// 故不改变现有观感；离屏渲染按帧时间传入，图案便自己流动。
uniform float uTime;
uniform float uDistortionStrength;
uniform float uNoiseStrength;
uniform vec2 uOffset;    // 图案偏移（UV，0/0 = 不偏移）
uniform float uHasMask;
uniform float uMaskMode;   // 1 = line, 0 = fill
uniform float uMaskInvert; // 图蒙版（uMask）的反转；程序化蒙版的反转是逐条自带的 uMaskPresetInvert
uniform float uLineEdge0;
uniform float uLineEdge1;
uniform sampler2D uFrontMap; // 卡面原图：颜色蒙版按此采样（原始 uv，不含底图变换）
uniform float uMaskSource;   // 蒙版来源：1 = color，0 = image
uniform vec3 uMaskColor;     // 吸管拾取的颜色（线性工作空间）
// 图蒙版的位移 / 缩放 / 旋转（与卡面同构，见 common.ts 的 maskSampleUv）。
uniform vec2 uMaskCenter;    // 蒙版图中心（卡面等比坐标，卡高 = 1）
uniform vec2 uMaskSize;      // 蒙版图在卡面上的宽高（卡面等比坐标）
uniform float uMaskRotation; // 蒙版图旋转（弧度，正 = 屏幕顺时针）
// 图片效果（image）：把图层铺成一张可变换的贴片；采样与全息在片元里做 over 合成。
uniform sampler2D uImage;
uniform float uHasImage;
uniform vec2 uImageCenter;
uniform vec2 uImageSize;
uniform float uImageRotation;
// 本层文字：栅格化后的卡面同比例纹理（uHasText = 0 时整段跳过）。
uniform sampler2D uTextMap;
uniform float uHasText;
// 1 = 作为蒙版：本层所有内容 alpha 归零，只把字形 alpha 交给子层。
uniform float uTextAsMask;

// 祖先蒙版（定长；未使用的槽位 hasMask=0，等价于「无此祖先」）。见 materials/layer-material.ts。
// 文字蒙版复用同一个采样器槽位、用 maskKind 区分取值口径：纹理单元只有 16 个（ANGLE/D3D11 的
// MAX_TEXTURE_IMAGE_UNITS 下限），祖先文字蒙版再占一组 4 个就会超限、整段片元编译失败。
uniform sampler2D uAncestorMask[MAX_NEST_DEPTH];
uniform float uAncestorHasMask[MAX_NEST_DEPTH];
// 0 = 图蒙版（亮度 / 颜色 + 阈值）；1 = 文字蒙版（字形 alpha 直接相乘）。
uniform float uAncestorMaskKind[MAX_NEST_DEPTH];
uniform float uAncestorMaskMode[MAX_NEST_DEPTH];
uniform float uAncestorInvert[MAX_NEST_DEPTH];
uniform float uAncestorEdge0[MAX_NEST_DEPTH];
uniform float uAncestorEdge1[MAX_NEST_DEPTH];
// 祖先蒙版的位移 / 缩放 / 旋转（与自身蒙版同一套变换）。
uniform vec2 uAncestorCenter[MAX_NEST_DEPTH];
uniform vec2 uAncestorSize[MAX_NEST_DEPTH];
uniform float uAncestorRotation[MAX_NEST_DEPTH];
// 祖先蒙版的来源与拾取色（颜色源按卡面原图采样，与自身蒙版同一套变换）。
uniform float uAncestorSource[MAX_NEST_DEPTH];
uniform vec3 uAncestorColor[MAX_NEST_DEPTH];
// 祖先的「作为蒙版」光泽（光带场 → 覆盖率，向下裁切子树）。uAncestorGlossCount = 该槽位的
// 有效条数；其余数组按「槽位 × 条序」展平，未使用的槽位填 0。见 common.ts 的 glossMaskWeight。
uniform float uAncestorGlossCount[MAX_NEST_DEPTH];
uniform float uAncestorGlossMode[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossBands[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossSpacing[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossWidth[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossAngle[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossTwist[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossTwistSeed[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossOffsetX[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossOffsetY[ANCESTOR_GLOSS_MAX];
uniform float uAncestorGlossSoftness[ANCESTOR_GLOSS_MAX];

// 法线（bump）：0 = 关、1 = 本层图片、2 = 卡面底图（继承）。见 bump.ts 与 GLSL_COMMON 的法线数学。
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
// 卡面底图的采样变换（继承卡面法线时用）：与卡面片元的 uMapMatrix / uMapOffset 同构。
uniform vec4 uFaceMapMatrix;
uniform vec2 uFaceMapOffset;
// 暗部颜色（blend = shadow）：片元按卡面原图亮度把图层色相铺进暗部，保留底图亮度。
uniform float uShadowMode;
uniform float uHasFront;

// 本层自己的擦除图（maskErase 挂在**本层**效果列表里）；uHasLayerErase = 0 时整段跳过。
uniform sampler2D uLayerEraseMap;
uniform float uHasLayerErase;
// 祖先的擦除图（擦除向下继承：父层擦掉的地方，子树一并消失）。
uniform sampler2D uAncestorEraseMap[MAX_NEST_DEPTH];
uniform float uAncestorHasErase[MAX_NEST_DEPTH];
// 绘画辅助：1 = 把被本层画笔擦掉的区域铺一层半透明底色。只在交互视图的绘画会话里打开。
uniform float uErasePreview;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;
varying vec2 vUv;

${GLSL_COMMON}

// 本层图片的贴图坐标与「是否落在图片矩形内」：xy = 图片 UV，z = inside（1 / 0）。
// 亮度通路拿它采图，法线贴图通路拿它定位采样点——两路的几何必须一致。
vec3 imageSampleUv(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  vec2 q = p - uImageCenter;
  float c = cos(uImageRotation);
  float s = sin(uImageRotation);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vec2 imgUv = r / uImageSize + 0.5;
  float inside = step(0.0, imgUv.x) * step(imgUv.x, 1.0)
               * step(0.0, imgUv.y) * step(imgUv.y, 1.0);
  return vec3(imgUv, inside);
}

// 法线高度场①：本层图片在卡面 UV 处的亮度（透明处 / 图外按 0，与颜色取样同口径）。
float imageBumpHeightAt(vec2 uv) {
  vec3 s = imageSampleUv(uv);
  vec4 tex = texture2D(uImage, clamp(s.xy, 0.0, 1.0));
  return bumpLuma(tex.rgb) * tex.a * s.z;
}

// 法线高度场②：卡面底图（继承来的那份）在卡面 UV 处的亮度。图外视为平地。
float faceBumpHeightAt(vec2 uv) {
  vec2 m = mat2(uFaceMapMatrix.xy, uFaceMapMatrix.zw) * (uv - 0.5) + 0.5 + uFaceMapOffset;
  if (any(lessThan(m, vec2(0.0))) || any(greaterThan(m, vec2(1.0)))) return 0.0;
  return bumpLuma(texture2D(uFrontMap, m).rgb);
}

// 暗部颜色用：卡面原图（按底图变换采样）的亮度。图外按 1（亮）处理——宁可不显花纹，
// 也不要把「没有底图」的地方当成暗部铺满。
float baseFrontLum(vec2 uv) {
  vec2 m = mat2(uFaceMapMatrix.xy, uFaceMapMatrix.zw) * (uv - 0.5) + 0.5 + uFaceMapOffset;
  if (any(lessThan(m, vec2(0.0))) || any(greaterThan(m, vec2(1.0)))) return 1.0;
  return dot(texture2D(uFrontMap, m).rgb, vec3(0.299, 0.587, 0.114));
}

// 卡面原图按底图变换（fit / offset / scale / rotation）采样：与卡面片元看到的图同一套换算。
// 越界按「无内容」处理（alpha 0）：不能 clamp 拉边，否则 contain / 缩小 / 旋转时会把边缘像素
// 拉伸到整块留白区（卡面片元自己也不拉边，见 base.ts 的 uMapBackground）。
vec4 faceFrontSample(vec2 uv) {
  vec2 m = mat2(uFaceMapMatrix.xy, uFaceMapMatrix.zw) * (uv - 0.5) + 0.5 + uFaceMapOffset;
  if (any(lessThan(m, vec2(0.0))) || any(greaterThan(m, vec2(1.0)))) return vec4(0.0);
  return texture2D(uFrontMap, m);
}

// 叠色 holo.fs 的合成：内容自身 HSL 加相位，提饱和提亮，再按内容对比度做 delta lerp。
// 不读调色板；delta 乘 holoMix / holoAlpha，保留图层的强度滑块。
vec3 hslTint(vec3 tex, float phase) {
  vec4 hsl = rgbToHsl(vec4(0.5 * tex + 0.5 * vec3(0.0, 0.0, 1.0), 1.0));
  hsl.x = fract(hsl.x + fract(phase * uPaletteHue));
  hsl.y = clamp(hsl.y * uPaletteSat, 0.0, 1.0);
  hsl.z = mix(hsl.z, 1.0, uPaletteLift);
  float hi = max(tex.r, max(tex.g, tex.b));
  float lo = min(tex.r, min(tex.g, tex.b));
  float delta = uPaletteDeltaBase + uPaletteDeltaContrast * (hi - lo) + uPaletteDeltaBright * hi;
  delta = clamp(delta * uHoloMix * uHoloAlpha, 0.0, 1.0);
  vec3 tinted = hslToRgb(hsl).rgb * mix(vec3(1.0), vec3(0.9, 0.8, 1.2), uPaletteTint);
  return mix(tex, tinted, delta);
}

// 本层法线的高度场：来源 2 = 卡面底图，否则 = 本层图片（来源 0 不会进入这段）。
float bumpHeightAt(vec2 uv) {
  return uBumpSource > 1.5 ? faceBumpHeightAt(uv) : imageBumpHeightAt(uv);
}

// 法线贴图的采样点跟着「哪张图」走：来源 2 用卡面的底图变换（与卡面片元同一套数学），
// 否则用本层图片的变换。越界由 normalMapSlope 按平地处理。
vec2 normalMapUv(vec2 uv) {
  if (uBumpSource > 1.5) {
    return mat2(uFaceMapMatrix.xy, uFaceMapMatrix.zw) * (uv - 0.5) + 0.5 + uFaceMapOffset;
  }
  return imageSampleUv(uv).xy;
}

void main() {
  vec3 V = normalize(uCameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  // 倾斜灵敏度：把法线相对「正对相机」的偏离按 uTiltGain 放大再归一化，于是转卡时 grazing
  // 与反射 R 一起走得更远——明暗变化更明显或更迟钝（基场是纯 UV 的，不再随视线扫动）。
  // 只缩放法线：卡面是平面，平卡时 N 恒为 (0,0,1)，任何增益都退回原样，静止画面逐像素不变。
  // 视线 V 不能缩——卡边像素的 V.xy 在平卡时也不为零，缩它会把静止画面也改掉。
  // 默认 1 时整段跳过：多算一次 normalize 会在末位抖，存量系列的画面对不上。
  if (abs(uTiltGain - 1.0) > 1e-4) {
    N = normalize(vec3(N.xy * uTiltGain, N.z));
  }
  // 法线（bump）：由本层图片（或继承来的卡面底图）的亮度差当场生成。两处一起改——N 给全息
  // 相位与反射，bUv 给效果图案的走势。关闭时 bUv ≡ vUv、N 不变、bumpShade ≡ 1，画面逐像素
  // 退回之前。bumpShade 是高度场在那束斜光下的明暗：没有内容可渲染成浮雕时，凹凸只靠它显形。
  vec2 bUv = vUv;
  vec3 bumpShade = vec3(1.0);
  if (uBumpSource > 0.5) {
    vec2 slope;
    if (uBumpMode > 0.5) {
      // 法线贴图自带形状，采样点跟着来源图走。
      slope = normalMapSlope(normalMapUv(vUv), uBumpFlipY, uBumpInvert);
    } else {
      // 步长按卡宽换算，横竖细节尺度一致（uAspect = 宽 / 高）。
      vec2 dv = vec2(uBumpDetail / max(uAspect, 1e-4), uBumpDetail);
      slope = bumpSlope(
        bumpHeightAt(vUv - vec2(dv.x, 0.0)),
        bumpHeightAt(vUv + vec2(dv.x, 0.0)),
        bumpHeightAt(vUv - vec2(0.0, dv.y)),
        bumpHeightAt(vUv + vec2(0.0, dv.y)),
        uBumpInvert);
    }
    N = bumpNormal(N, normalize(vWorldTangent), normalize(vWorldBitangent), slope, uBumpStrength);
    bUv = vUv + bumpWarp(slope, uBumpStrength, uBumpFlow);
    bumpShade = bumpShadeAmount(slope, uBumpStrength, uBumpLight, uBumpLightAngle, mix(vec3(1.0), uBumpLightColor, uBumpLightAlpha));
  }

  vec3 R = reflect(-V, N);
  float grazing = 1.0 - clamp(dot(N, V), 0.0, 1.0);

  // 本层有效摩尔纹场之和（含继承来的那份）：光带切带与内容浮雕共用，只算一次。用扰动后的
  // UV：摩尔纹跟着法线起伏走。
  float moireSum = moireSliceSum(bUv);

  // 图案偏移在 holoPhase 的 uv0 里统一处理：小丑牌基场、色带、同心环、噪声一起挪。
  float phase = holoPhase(V, N, bUv, uOffset, uDistortionStrength, uNoiseStrength, uGradientStraight);
  // 网格（相位加项）：线族数学沿用 latticeField，系数与旧刻纹一致；默认参数即旧刻纹观感。
  float grid = uHoloGridCount > 0.5
    ? latticeField(bUv - vec2(uHoloGridOffsetX[0], uHoloGridOffsetY[0]),
        uHoloGridFamilies[0], uHoloGridAngle[0], uHoloGridDensity[0], uHoloGridWidth[0])
      * uHoloGridStrength[0]
    : 0.0;
  phase += grid * LATTICE_PHASE_SCALE;
  vec4 holo4 = holoColor(phase, grazing, uPhaseSpeed, uTime);
  vec3 holo = holo4.rgb;

  // 颜色组：光泽往图层全息色上叠加光带（与卡面共用 GLSL_COMMON.glossBands，主色换成 holo）。
  // 切带取本目标的有效摩尔纹——uMoire* 数组已由 host 侧按「自身，为空则继承卡面」填好（§6.4）。
  // 该步在蒙版权重之前：光带随 holo 一起被下面的 alpha（含 mw）相乘，故光泽自动跟随图层蒙版。
  holo = glossBands(holo, bUv, moireSum, R.x);

  // 内置蒙版启用时就不必采图：门控在前，省一次纹理取样。
  // 图蒙版按位移 / 缩放 / 旋转变换后采样；蒙版图没盖到的地方视为不裁切（maskInside = 0）。
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
  // 蒙版权重二选一：程序化蒙版走 shardField（invert 逐条自带，见 common.ts），否则走原有的图蒙版
  // 阈值公式（invert 是共用标量 uMaskInvert）。下游 holoMix / gradient / blend 一律照旧——
  // 本特性只换「蒙版权重从哪来」。
  float mw = (uMaskPresetCount > 0.5)
    ? presetMaskWeight(vUv)
    : (uMaskSource > 0.5
      ? mix(1.0, colorKeyWeight(art, uHasMask, uMaskColor, uMaskInvert, uLineEdge0, uLineEdge1), maskInside)
      : mix(1.0, maskWeight(lum, uHasMask, uMaskMode, uMaskInvert, uLineEdge0, uLineEdge1), maskInside));

  // 祖先蒙版软裁切：逐祖先相乘。未使用的槽位 hasMask=0，maskWeight 返回 1（不裁切）。
  // 逐段展开（而非 for 循环）的原因见 ancestorClipGLSL：sampler 数组下标必须是字面量常量。
  float ancestorClip = 1.0;
${ancestorClipGLSL()}

  float card = roundedRectMask(vUv, uAspect, uCornerRadius);
  // 蒙版擦除：卡面那一张（整卡）× 本层自己那张 × 祖先们的（向下继承）。未挂擦除图的一侧
  // 恒为 1，故没有图层擦除时与「只有整卡擦除」完全一致。
  float ownErase = 1.0;
  if (uHasLayerErase > 0.5) {
    ownErase = dot(texture2D(uLayerEraseMap, vUv).rgb, vec3(0.299, 0.587, 0.114));
  }
  float ancestorErase = 1.0;
${ancestorEraseGLSL()}
  float erase = eraseWeight(vUv) * ownErase * ancestorErase;
  // 全息通路：uHasHolo 为 0（调色板色标为空）时 alpha 归零 → 本层不出箔（纯蒙版）。
  // 颜色类效果不走这道门，它们作用在下面的内容（图片 / 文字）上。
  // 色标带的透明度（holo4.a）乘在最后：某个相位处的色标越透明，箔在那里越淡。
  float alpha = mw * uHoloMix * uHoloAlpha * uOpacity * uHasHolo * card * ancestorClip * erase * holo4.a;
  // 叠色合成但没有任何内容 / 卡面原图：不落回色带（色标在 UI 里是隐藏的），直接不出图。
  if (uPaletteComposite > 0.5 && uHasImage < 0.5 && uHasText < 0.5 && uHasFront < 0.5) {
    alpha = 0.0;
  }

  // 图片 / 文字是「本层的内容」：效果作用在内容上，而不是被内容原地盖住。浮雕（刻纹 / 摩尔纹）
  // 与光泽光带都走与卡面同一批公共件，故图层和一张小卡面的表现一致。没有自有相位效果时
  // relief ≡ 1（逐像素不变）；没有光泽条目时 glossBands 是恒等（uGlossCount = 0）。
  float relief = layerContentRelief(bUv);

  // 图片：把卡面点变换到图片局部 UV 后采样；越界部分 alpha 归零。
  float imgA = 0.0;
  vec3 imgC = vec3(0.0);
  if (uHasImage > 0.5) {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec2 q = p - uImageCenter;
    float c = cos(uImageRotation);
    float s = sin(uImageRotation);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    vec2 imgUv = r / uImageSize + 0.5;
    vec4 tex = texture2D(uImage, clamp(imgUv, 0.0, 1.0));
    float inside = step(0.0, imgUv.x) * step(imgUv.x, 1.0)
                 * step(0.0, imgUv.y) * step(imgUv.y, 1.0);
    // 跟随图层：蒙版权重、不透明度、圆角与祖先裁剪都作用在图片 alpha 上。
    imgA = tex.a * inside * mw * uOpacity * card * ancestorClip * erase;
    imgC = tex.rgb;
    imgC *= relief * bumpShade;
    imgC = glossBands(imgC, bUv, moireSum, R.x);
  }

  // 文字：与图片同构的一路 alpha。跟随图层：蒙版权重、不透明度、圆角、祖先裁剪与擦除都乘进去。
  float textA = 0.0;
  vec3 textC = vec3(0.0);
  if (uHasText > 0.5) {
    vec4 tx = texture2D(uTextMap, vUv);
    textA = tx.a * mw * uOpacity * card * ancestorClip * erase;
    textC = tx.rgb;
    textC *= relief * bumpShade;
    textC = glossBands(textC, bUv, moireSum, R.x);
  }
  // 作为蒙版：本层不出图（文字 / 图片 / 全息一起归零），但仍以字形 alpha 裁切子树。
  if (uTextAsMask > 0.5) {
    textA = 0.0;
    imgA = 0.0;
    alpha = 0.0;
  }

  // 标准 over 合成：先图片盖全息，再文字盖上去。
  float sceneA = imgA + alpha * (1.0 - imgA);
  vec3 sceneC = sceneA > 1e-4
    ? (imgC * imgA + holo * alpha * (1.0 - imgA)) / sceneA
    : vec3(0.0);
  float outA = textA + sceneA * (1.0 - textA);
  vec3 outC = outA > 1e-4
    ? (textC * textA + sceneC * sceneA * (1.0 - textA)) / outA
    : vec3(0.0);
  // 调色板合成 = 叠色：拿内容（图片 / 文字 / 卡面原图）自身颜色做 delta lerp + HSL 蓝偏；
  // 整段替换 palette 的 holo 合成，覆盖仍由本层的蒙版 / 不透明度决定。
  if (uPaletteComposite > 0.5 && uHasHolo > 0.5
      && (uHasImage > 0.5 || uHasText > 0.5 || uHasFront > 0.5)) {
    vec4 front = faceFrontSample(vUv);
    vec3 content = uHasImage > 0.5 ? imgC : (uHasText > 0.5 ? textC : front.rgb);
    float contentA = uHasImage > 0.5
      ? imgA
      : (uHasText > 0.5 ? textA : mw * uOpacity * card * ancestorClip * erase * front.a);
    outC = hslTint(content, phase);
    outA = contentA;
  }
  // 暗部颜色：只取图层的色相 / 饱和度，把它的亮度换成卡面底图的亮度，再按「暗度」给 alpha。
  // 于是暗处显花纹、亮处淡出；over 合成后像素亮度仍是底图亮度，卡牌明暗不变。
  if (uShadowMode > 0.5 && uHasFront > 0.5) {
    float baseLum = baseFrontLum(vUv);
    float dark = 1.0 - clamp(baseLum, 0.0, 1.0);
    float styleLum = dot(outC, vec3(0.299, 0.587, 0.114));
    outC = styleLum > 1e-3 ? outC * (baseLum / styleLum) : vec3(baseLum);
    outA *= dark;
  }
  // 绘画辅助（只在交互视图的绘画会话里打开）：被本层画笔擦掉的位置铺半透明底色，否则擦完
  // 只剩下层透出来，看不出这一层自己擦到哪了。只算本层那张图——整卡擦除的底色由卡面材质
  // 负责，这里再叠一次只会更深。用数值而非色值字面量：写 #hex 会被 lint 的硬编码色值规则命中。
  if (uErasePreview > 0.5) {
    float cut = 1.0 - ownErase;
    outC = mix(outC, vec3(1.0, 0.35, 0.35), cut);
    outA = max(outA, cut * card * 0.5);
  }
  if (outA < 0.001) discard;
  gl_FragColor = vec4(outC, outA);
  #include <colorspace_fragment>
}
`
