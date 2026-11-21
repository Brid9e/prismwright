/**
 * 卡面边缘假倒角的材质。
 *
 * 它是覆盖在**全部图层之上**的一张透明平面：只在圆角边缘一条窄带里出像素，故不会被
 * holo / 图片 / 文字层盖住，也不会改变图层自己的 alpha。`depthTest = false` + 很高的
 * `renderOrder` 保证它排在透明队列最后；两面各自一份，背面组翻过去时由背面剔除。
 */
import { ShaderMaterial } from "three"
import { DEFAULT_BUMP_LIGHT_ANGLE } from "@prismwright/schema"
import { EDGE_BEVEL_FRAGMENT, EDGE_BEVEL_VERTEX } from "../shaders/edge-bevel"

/** 倒角带宽度（卡高单位）。0.012 ≈ 750px 卡高上 9px，够读出圆弧又不会啃掉画面。 */
export const EDGE_BEVEL_WIDTH = 0.012
/** 峰值 alpha：亮侧 / 暗侧都乘它，保持一条克制的切边。 */
export const EDGE_BEVEL_STRENGTH = 0.55
/** 覆盖层渲染序：必须高于所有图层（图层按 i+1 编号，量级是几十）。 */
export const EDGE_BEVEL_RENDER_ORDER = 100000

export interface EdgeBevelOptions {
  aspect: number
  cornerRadius: number
  /** 光的方向（度），缺省与 bump 光一致。 */
  lightAngle?: number
}

/** 创建一份边缘倒角材质；`uTilt` 初值 0（正视角完全隐藏）。 */
export function createEdgeBevelMaterial(opts: EdgeBevelOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAspect: { value: opts.aspect },
      uCornerRadius: { value: opts.cornerRadius },
      uLightAngle: { value: opts.lightAngle ?? DEFAULT_BUMP_LIGHT_ANGLE },
      uBandWidth: { value: EDGE_BEVEL_WIDTH },
      uStrength: { value: EDGE_BEVEL_STRENGTH },
      uTilt: { value: 0 },
    },
    vertexShader: EDGE_BEVEL_VERTEX,
    fragmentShader: EDGE_BEVEL_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}
