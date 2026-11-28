/**
 * 玻璃卡的反射覆盖层。
 *
 * 卡面是平的，相机有透视：每个像素的视线方向不同，`reflect(-V, N)` 因此扫过环境贴图的
 * 不同区域——倾斜卡片时反射会跟着移动，这就是「映射场景」的来源。材质用正常混合，
 * 天空盒里的建筑 / 天空直接叠在卡面上；Fresnel 让正对时淡、侧看时更强。
 *
 * 法线保持几何法线，不再叠程序化波纹：波纹会让反射在 UV 上周期重复，看起来像万花筒。
 * 代价是平面镜只反射环境的一个窄切片，这是平面玻璃的物理结果。
 */
export const GLASS_OVERLAY_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // 反射与视线都在世界空间；这里也必须给世界法线（mat3(modelMatrix)），
  // 不能拿 normalMatrix（那是视图空间）去混算。
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const GLASS_OVERLAY_FRAGMENT = /* glsl */ `
uniform sampler2D uEnvMap;
uniform vec3 uCameraPosition;
uniform float uAspect;
uniform float uCornerRadius;
uniform float uStrength;
uniform float uRoughness;
uniform vec3 uTint;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

// 与 common.ts 的 roundedRectMask 同一套圆角遮罩：玻璃反射也必须被卡面轮廓裁掉。
float roundedRectMask(vec2 uv, float aspect, float radius) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 b = vec2(aspect, 1.0) * 0.5;
  vec2 q = abs(p) - b + radius;
  float sdf = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
  float aa = fwidth(sdf) + 1e-5;
  return 1.0 - smoothstep(0.0, aa, sdf);
}

// 等距全景：经度绕 Y，纬度沿 Y。与内置环境图（environment.ts）同一口径。
vec2 equirectUv(vec3 d) {
  return vec2(
    atan(d.z, d.x) / 6.2831853 + 0.5,
    asin(clamp(d.y, -1.0, 1.0)) / 3.1415926 + 0.5
  );
}

void main() {
  vec3 V = normalize(uCameraPosition - vWorldPos);
  // 纯几何法线：平面镜反射，不再叠周期波纹。
  vec3 N = normalize(vWorldNormal);
  vec3 R = reflect(-V, N);

  // 粗糙度 → mip 偏移：0 = 清晰的镜面反射，1 = 几乎只取平均色。
  vec3 env = texture2D(uEnvMap, equirectUv(R), uRoughness * 5.0).rgb;

  // 玻璃的 Fresnel：正对时约 10%，越斜越强；再给一点恒定底值，避免完全正对时消失。
  float fres = 0.10 + 0.90 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  float card = roundedRectMask(vUv, uAspect, uCornerRadius);
  float alpha = clamp((fres + 0.30) * uStrength, 0.0, 1.0) * card;
  if (alpha < 0.001) discard;

  // 一道随反射方向移动的高光：环境图偏暗时也能读出「玻璃在反光」，倾斜时扫过卡面。
  const vec3 LIGHT = normalize(vec3(cos(radians(127.0)), sin(radians(127.0)), 0.58));
  float spec = pow(max(dot(R, LIGHT), 0.0), 32.0);
  vec3 col = env * uTint + vec3(1.0, 0.98, 0.94) * spec * 0.6;

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`
