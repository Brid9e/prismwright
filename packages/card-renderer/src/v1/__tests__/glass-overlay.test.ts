/**
 * 玻璃卡：内置等距环境 + 顶层反射 overlay。
 *
 * 环境是内置的摄影棚等距图（运行时生成，不依赖资源文件）；overlay 按反射向量采样，
 * Fresnel 决定强度，粗糙度映射到 mip 偏移。它只加反射光，不改变卡片自身的颜色。
 */
import { describe, it, expect } from "vitest"
import { AdditiveBlending, DataTexture, RepeatWrapping, ShaderMaterial } from "three"
import { createStudioEnvironmentTexture } from "../environment"
import { GLASS_OVERLAY_FRAGMENT } from "../shaders/glass-overlay"
import {
  GLASS_OVERLAY_RENDER_ORDER,
  createGlassOverlayMaterial,
} from "../materials/glass-overlay-material"

describe("玻璃卡环境", () => {
  it("内置环境是等距全景，可横向重复且有明暗变化", () => {
    const tex = createStudioEnvironmentTexture()
    expect(tex).toBeInstanceOf(DataTexture)
    expect(tex.wrapS).toBe(RepeatWrapping)
    expect(tex.generateMipmaps).toBe(true)
    const data = tex.image.data as Uint8Array
    let min = 255
    let max = 0
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i])
      max = Math.max(max, data[i])
    }
    expect(max - min).toBeGreaterThan(20)
  })

  it("玻璃 shader 用反射向量采样环境并加 Fresnel", () => {
    expect(GLASS_OVERLAY_FRAGMENT).toContain("uEnvMap")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("reflect(-V, N)")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("atan(d.z, d.x)")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("equirectUv(R)")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("uRoughness")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("pow(1.0 - clamp(dot(N, V)")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("roundedRectMask(vUv, uAspect, uCornerRadius)")
    expect(GLASS_OVERLAY_FRAGMENT).toContain("vWorldTangent * ripple.x")
  })

  it("材质：加法混合、透明、不写深度、在倒角之下", () => {
    const env = createStudioEnvironmentTexture()
    const m = createGlassOverlayMaterial({
      envMap: env,
      aspect: 2.5 / 3.5,
      cornerRadius: 0.06,
      strength: 0.8,
      roughness: 0.3,
      tint: "#88ccff",
    })
    expect(m).toBeInstanceOf(ShaderMaterial)
    expect(m.transparent).toBe(true)
    expect(m.blending).toBe(AdditiveBlending)
    expect(m.depthTest).toBe(false)
    expect(m.depthWrite).toBe(false)
    expect(m.uniforms.uEnvMap.value).toBe(env)
    expect(m.uniforms.uStrength.value).toBe(0.8)
    expect(m.uniforms.uRoughness.value).toBe(0.3)
    expect(GLASS_OVERLAY_RENDER_ORDER).toBeLessThan(100000)
  })
})
