/**
 * 玻璃卡反射覆盖层的材质。
 *
 * 与边缘倒角一样是覆盖在全部图层之上的透明平面：以正常混合叠一层天空盒反射，
 * 建筑与天空会直接「盖」在卡面上，而不是只加一点光。
 * `depthTest = false` + 很高的 renderOrder 让它排在图层之后、边缘倒角之下。
 */
import { Color, ShaderMaterial, Vector3, type Texture } from "three"
import { GLASS_OVERLAY_FRAGMENT, GLASS_OVERLAY_VERTEX } from "../shaders/glass-overlay"

/** 渲染序：高于所有图层，低于边缘倒角（100000）。 */
export const GLASS_OVERLAY_RENDER_ORDER = 99999

export interface GlassOverlayOptions {
  /** 等距环境贴图（见 environment.ts）。 */
  envMap: Texture
  /** 卡面宽高比（宽 / 高）。 */
  aspect: number
  /** 圆角半径（卡高单位）。 */
  cornerRadius: number
  /** 反射强度 0–1。 */
  strength: number
  /** 粗糙度 0–1，映射到环境图的 mip 偏移。 */
  roughness: number
  /** 反射染色（hex）。 */
  tint: string
}

/** 创建一份玻璃反射材质；相机位置由视图每帧写入。 */
export function createGlassOverlayMaterial(opts: GlassOverlayOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uEnvMap: { value: opts.envMap },
      uCameraPosition: { value: new Vector3() },
      uAspect: { value: opts.aspect },
      uCornerRadius: { value: opts.cornerRadius },
      uStrength: { value: opts.strength },
      uRoughness: { value: opts.roughness },
      uTint: { value: new Color(opts.tint) },
    },
    vertexShader: GLASS_OVERLAY_VERTEX,
    fragmentShader: GLASS_OVERLAY_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}
