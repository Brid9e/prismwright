/**
 * 卡面边缘的假倒角着色器。
 *
 * 做法：用圆角矩形的 SDF 在边缘内侧切出一条窄带，带内的法线按四分之一圆从「侧面」转到
 * 「正面」，再由一束固定方向光算出亮边 / 暗边。高光因此自动沿着四角的圆弧走，直边与圆角
 * 连续——这是「卡纸厚度」的观感来源，不靠额外几何。
 *
 * uTilt 由视图写入：平视给一个很淡的底值（0.25），倾斜时升到 1；0 只作兜底整段 discard。
 * 绘制序在全部图层之上（见 materials/edge-bevel-material.ts），不会被内容层盖住。
 */
export const EDGE_BEVEL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const EDGE_BEVEL_FRAGMENT = /* glsl */ `
uniform float uAspect;
uniform float uCornerRadius;
// 光的方向（度，UV 平面内 +x = 0 逆时针），与 bump 光同口径。
uniform float uLightAngle;
// 倒角带宽度（卡高单位）。
uniform float uBandWidth;
uniform float uStrength;
// 平视底值 0.25，倾斜升到 1；0 = 兜底隐藏。由视图按倾角写入。
uniform float uTilt;

varying vec2 vUv;

// 与 common.ts 的 roundedRectMask 同一套 SDF，只是这里要的是有符号距离本身。
float roundedRectSdf(vec2 uv, float aspect, float radius) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 b = vec2(aspect, 1.0) * 0.5;
  vec2 q = abs(p) - b + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

void main() {
  if (uTilt < 0.001) discard;

  float sdf = roundedRectSdf(vUv, uAspect, uCornerRadius);
  float aa = fwidth(sdf) + 1e-5;
  float inside = 1.0 - smoothstep(0.0, aa, sdf);
  if (inside < 0.001) discard;

  float dist = -sdf;
  float t = clamp(dist / max(uBandWidth, 1e-4), 0.0, 1.0);
  // 外侧强、内侧渐隐：轮廓处最亮，向内到带宽处消失。
  float band = 1.0 - smoothstep(0.0, 1.0, t);
  if (band < 0.001) discard;

  // 圆角矩形的外法线（卡面空间，y 向上）。直边取最近的一条；四角取径向。
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 b = vec2(uAspect, 1.0) * 0.5;
  vec2 q = abs(p) - b + uCornerRadius;
  vec2 s = sign(p);
  vec2 outward;
  if (q.x > 0.0 && q.y > 0.0) outward = normalize(q) * s;
  else if (q.x > q.y) outward = vec2(s.x, 0.0);
  else outward = vec2(0.0, s.y);

  // 倒角截面：t = 0（轮廓）法线朝侧面，t = 1（内侧）回到正面。
  float angle = (1.0 - t) * 1.5707963;
  vec3 n = vec3(outward * sin(angle), cos(angle));

  float a = radians(uLightAngle);
  vec3 L = normalize(vec3(cos(a), sin(a), 0.55));
  float d = dot(n, L);
  float frontD = L.z;
  float lit = smoothstep(frontD, 1.0, d);
  float dark = 1.0 - smoothstep(0.0, frontD, d);

  // 亮侧加暖白，暗侧压黑；正对相机的中间调 alpha 为 0，不改变卡面本身。
  vec3 col = lit > 0.0 ? vec3(1.0, 0.96, 0.88) : vec3(0.0);
  float alpha = band * inside * (lit + dark * 0.6) * uStrength * uTilt;
  if (alpha < 0.001) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`
