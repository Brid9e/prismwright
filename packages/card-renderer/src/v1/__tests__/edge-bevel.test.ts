/**
 * 卡面边缘的假倒角。
 *
 * 它在圆角矩形 SDF 的内侧画一条窄带，带内法线从侧面转到正面，再由一束固定方向光算出
 * 亮边 / 暗边。平视给一个淡底值，倾斜时增强；uTilt = 0 仅作兜底隐藏。
 */
import { describe, it, expect } from "vitest"
import { ShaderMaterial } from "three"
import { EDGE_BEVEL_FRAGMENT } from "../shaders/edge-bevel"
import {
  EDGE_BEVEL_RENDER_ORDER,
  createEdgeBevelMaterial,
} from "../materials/edge-bevel-material"

describe("边缘假倒角", () => {
  it("沿圆角矩形 SDF 的窄带画倒角，uTilt 为 0 时兜底隐藏", () => {
    expect(EDGE_BEVEL_FRAGMENT).toContain("roundedRectSdf(")
    expect(EDGE_BEVEL_FRAGMENT).toContain("uBandWidth")
    expect(EDGE_BEVEL_FRAGMENT).toContain("if (uTilt < 0.001) discard;")
    expect(EDGE_BEVEL_FRAGMENT).toContain("outward")
    expect(EDGE_BEVEL_FRAGMENT).toContain("sin(angle)")
    expect(EDGE_BEVEL_FRAGMENT).toContain("dot(n, L)")
  })

  it("材质：透明、不写深度、覆盖层渲染序", () => {
    const m = createEdgeBevelMaterial({ aspect: 2.5 / 3.5, cornerRadius: 0.06 })
    expect(m).toBeInstanceOf(ShaderMaterial)
    expect(m.transparent).toBe(true)
    expect(m.depthTest).toBe(false)
    expect(m.depthWrite).toBe(false)
    expect(m.uniforms.uAspect.value).toBeCloseTo(2.5 / 3.5)
    expect(m.uniforms.uCornerRadius.value).toBe(0.06)
    expect(m.uniforms.uTilt.value).toBe(0)
    expect(EDGE_BEVEL_RENDER_ORDER).toBeGreaterThan(1000)
  })
})
