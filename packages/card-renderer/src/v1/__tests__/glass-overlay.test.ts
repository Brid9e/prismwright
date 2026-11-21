/**
 * 玻璃卡：内置等距环境 + 顶层反射 overlay。
 *
 * 环境是内置的摄影棚等距图（运行时生成，不依赖资源文件）；overlay 按反射向量采样，
 * Fresnel 决定强度，粗糙度映射到 mip 偏移。它只加反射光，不改变卡片自身的颜色。
 */
import { describe, it, expect } from "vitest"
import { DataTexture, NormalBlending, RepeatWrapping, ShaderMaterial } from "three"
import { createEnvironmentTexture } from "../environment"
import { GLASS_OVERLAY_FRAGMENT } from "../shaders/glass-overlay"
import {
  GLASS_OVERLAY_RENDER_ORDER,
  createGlassOverlayMaterial,
} from "../materials/glass-overlay-material"

describe("玻璃卡环境", () => {
  it("内置环境是等距全景，可横向重复且有明暗变化", () => {
    const tex = createEnvironmentTexture()
    expect(tex).toBeInstanceOf(DataTexture)
    expect(tex.wrapS).toBe(RepeatWrapping)
    expect(tex.generateMipmaps).toBe(true)
    expect(tex.image.width).toBe(256)
    expect(tex.image.height).toBe(128)
    const data = tex.image.data as Uint8Array
    let min = 255
    let max = 0
    let bright = 0
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
      min = Math.min(min, lum)
      max = Math.max(max, lum)
      if (lum > 150) bright++
      if (lum < 60) dark++
    }
    // 真实照片解码后应同时有亮部（天空 / 高光）与暗部（建筑 / 地面）。
    expect(max - min).toBeGreaterThan(60)
    expect(bright).toBeGreaterThan(200)
    expect(dark).toBeGreaterThan(200)
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

  it("材质：正常混合、透明、不写深度、在倒角之下", () => {
    const env = createEnvironmentTexture()
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
    expect(m.blending).toBe(NormalBlending)
    expect(m.depthTest).toBe(false)
    expect(m.depthWrite).toBe(false)
    expect(m.uniforms.uEnvMap.value).toBe(env)
    expect(m.uniforms.uStrength.value).toBe(0.8)
    expect(m.uniforms.uRoughness.value).toBe(0.3)
    expect(GLASS_OVERLAY_RENDER_ORDER).toBeLessThan(100000)
  })
})
