/**
 * 卡面底色材质：纯色 + 圆角遮罩。
 *
 * 卡面没有独立前景图与面级效果；图片、蒙版、光泽、摩尔纹都由图层材质负责。这里只把
 * `CardFace.baseColor` 铺成卡片形状，作为所有图层下面的画布。
 */
import { Color, DoubleSide, ShaderMaterial } from "three"
import { GLSL_VERTEX } from "../shaders/common"
import { BASE_FRAGMENT } from "../shaders/base"

export interface BaseMaterialParams {
  /** 卡片宽高比（宽/高）。 */
  aspect: number
  /** 圆角半径（卡高单位）。 */
  cornerRadius: number
  /** 卡片画布底色（hex）。 */
  baseColor: string
}

/** 创建卡面底色材质；调用方负责在销毁时 `dispose()`。 */
export function createBaseMaterial(p: BaseMaterialParams): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new Color(p.baseColor) },
      uAspect: { value: p.aspect },
      uCornerRadius: { value: p.cornerRadius },
    },
    vertexShader: GLSL_VERTEX,
    fragmentShader: BASE_FRAGMENT,
    transparent: true,
    side: DoubleSide,
  })
}
