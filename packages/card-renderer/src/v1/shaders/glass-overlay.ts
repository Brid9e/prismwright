/**
 * 玻璃卡的反射覆盖层。
 *
 * 卡面是平的，但相机有透视：每个像素的视线方向不同，`reflect(-V, N)` 因此扫过环境贴图的
 * 不同区域——倾斜卡片时反射会跟着移动，这就是「映射场景」的来源。片元只加反射光
 * （材质用加法混合），不改变卡片本身的颜色；Fresnel 让正对时很淡、侧看时更强。
 */
export const GLASS_OVERLAY_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(normalMatrix * normal);
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
  vec3 N = normalize(vWorldNormal);
  vec3 R = reflect(-V, N);

  // 粗糙度 → mip 偏移：0 = 清晰的镜面反射，1 = 几乎只取平均色。
  vec3 env = texture2D(uEnvMap, equirectUv(R), uRoughness * 5.0).rgb;

  // 玻璃的 Fresnel：正对时约 4%，越斜越强；再给一点恒定底值，避免完全正对时消失。
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  float card = roundedRectMask(vUv, uAspect, uCornerRadius);
  float alpha = clamp((fres + 0.06) * uStrength, 0.0, 1.0) * card;
  if (alpha < 0.001) discard;

  gl_FragColor = vec4(env * uTint, alpha);
  #include <colorspace_fragment>
}
`
