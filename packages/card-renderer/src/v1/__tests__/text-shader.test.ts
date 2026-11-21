/**
 * 文字通路的着色器契约：uniform 声明、祖先文字蒙版按字面量下标展开、over 合成、
 * 以及「作为蒙版」把本层内容 alpha 归零。
 *
 * GLSL 在 node 里跑不了，但名字对不上 / 下标非常量会让整段片元编译失败，症状是
 * 「图层全部不出图」——这类错配类型层面看不出来，只能在字符串上钉住。
 */
import { describe, it, expect } from "vitest"
import { MAX_NEST_DEPTH } from "@prismwright/schema"
import { LAYER_FRAGMENT } from "../shaders/layer"

describe("文字通路的 uniform", () => {
  it("声明了本层的文字纹理与两个开关", () => {
    expect(LAYER_FRAGMENT).toContain("uniform sampler2D uTextMap;")
    expect(LAYER_FRAGMENT).toContain("uniform float uHasText;")
    expect(LAYER_FRAGMENT).toContain("uniform float uTextAsMask;")
  })

  // 文字蒙版复用图蒙版的采样槽位、靠 maskKind 区分口径：片元纹理单元只有 16 个
  // （ANGLE/D3D11 的 MAX_TEXTURE_IMAGE_UNITS 下限），单开一组就会超限、整段片元编译失败。
  it("祖先文字蒙版复用 uAncestorMask 槽位，按字面量下标展开", () => {
    expect(LAYER_FRAGMENT).toContain("uniform float uAncestorMaskKind[MAX_NEST_DEPTH];")
    // 只查 main() 体内：声明本身必须写 `[MAX_NEST_DEPTH]`（宏），否则数组长度不固定。
    const body = LAYER_FRAGMENT.slice(LAYER_FRAGMENT.indexOf("void main()"))
    for (let i = 0; i < MAX_NEST_DEPTH; i++) {
      expect(body).toContain(`uAncestorMaskKind[${i}]`)
      expect(body).toContain(`texture2D(uAncestorMask[${i}], vUv).a`)
    }
    expect(body).not.toMatch(/uAncestorMaskKind\[\s*[a-zA-Z_]/)
    expect(LAYER_FRAGMENT).not.toContain("uAncestorTextMask")
  })
})

describe("文字合成", () => {
  it("文字盖在「图片 + 全息」之上，按 over 合成", () => {
    expect(LAYER_FRAGMENT).toContain("float textA = 0.0;")
    expect(LAYER_FRAGMENT).toContain("vec4 tx = texture2D(uTextMap, vUv);")
    expect(LAYER_FRAGMENT).toContain("float outA = textA + sceneA * (1.0 - textA);")
    expect(LAYER_FRAGMENT).toContain(
      "(textC * textA + sceneC * sceneA * (1.0 - textA)) / outA",
    )
  })

  it("作为蒙版：文字 / 图片 / 全息三路 alpha 一起归零", () => {
    const block = LAYER_FRAGMENT.slice(LAYER_FRAGMENT.indexOf("uTextAsMask > 0.5"))
    expect(block).toContain("textA = 0.0;")
    expect(block).toContain("imgA = 0.0;")
    expect(block).toContain("alpha = 0.0;")
  })
})
