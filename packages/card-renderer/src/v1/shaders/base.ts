/**
 * 卡面底色片元：纯色 + 圆角遮罩。
 *
 * 卡面已没有独立前景图 / 面级效果：图片、蒙版、光泽、摩尔纹都在图层上。基底只负责
 * 卡片画布底色，并被圆角遮罩裁成卡片形状；图层全部叠在它上面。
 */
import { GLSL_ROUNDED_RECT_MASK } from "./common"

export const BASE_FRAGMENT = /* glsl */ `
uniform vec3 uBaseColor;
uniform float uAspect;
uniform float uCornerRadius;

varying vec2 vUv;

${GLSL_ROUNDED_RECT_MASK}

void main() {
  float card = roundedRectMask(vUv, uAspect, uCornerRadius);
  if (card < 0.001) discard;
  gl_FragColor = vec4(uBaseColor, card);
  #include <colorspace_fragment>
}
`
