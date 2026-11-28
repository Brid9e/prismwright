/**
 * 卡面底色材质：纯色 + 圆角遮罩。
 *
 * 卡面已没有独立前景图 / 面级效果；图片与效果都在图层上。这里只钉住底色的 uniform 接线。
 */
import { describe, it, expect } from "vitest"
import type { Color } from "three"
import { createBaseMaterial } from "../materials/base-material"
import { BASE_FRAGMENT } from "../shaders/base"

describe("createBaseMaterial", () => {
  it("把底色 / 比例 / 圆角接线到 uniform", () => {
    const m = createBaseMaterial({ aspect: 2.5 / 3.5, cornerRadius: 0.06, baseColor: "#123456" })
    expect((m.uniforms.uBaseColor.value as Color).getHex()).toBe(0x123456)
    expect(m.uniforms.uAspect.value).toBeCloseTo(2.5 / 3.5)
    expect(m.uniforms.uCornerRadius.value).toBe(0.06)
    expect(m.transparent).toBe(true)
  })

  it("片元只画底色并用圆角遮罩裁形", () => {
    expect(BASE_FRAGMENT).toContain("uniform vec3 uBaseColor;")
    expect(BASE_FRAGMENT).toContain("roundedRectMask(vUv, uAspect, uCornerRadius)")
    expect(BASE_FRAGMENT).toContain("gl_FragColor = vec4(uBaseColor, card)")
    expect(BASE_FRAGMENT).not.toContain("uFrontMap")
  })
})
