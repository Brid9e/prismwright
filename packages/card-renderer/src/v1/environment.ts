/**
 * 内置天空盒（等距全景，台球厅）。
 *
 * 贴图以 64 色调色板 + 6 位索引的 base64 形式随源码分发（见 `environment-photo.ts`）：
 * 桌面端与小程序都不需要图片解码、资源路径或网络加载，运行时直接展开成 DataTexture，
 * 两端的场景完全同源。选调色板而不是 RGB565，是为了在 512×256 下把体积压进小程序主包限制。
 *
 * 玻璃卡按反射向量采样它；地平线在等距图 v = 0.5，平卡正对相机时反射正好落在墙面 /
 * 台球桌这一带，倾斜后反射会扫过天花板与地面。
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from "three"
import {
  SKYBOX_DATA_BASE64,
  SKYBOX_HEIGHT,
  SKYBOX_PALETTE_SIZE,
  SKYBOX_WIDTH,
} from "./environment-photo"

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1)
  for (let i = 0; i < B64_CHARS.length; i++) table[B64_CHARS.charCodeAt(i)] = i
  return table
})()

/**
 * 纯 TS 的 base64 解码。
 *
 * 不依赖 `atob`：小程序基础库不一定提供；这段只在建纹理时跑一次，长度也只有一百多 KB。
 */
function decodeBase64(input: string): Uint8Array {
  const pad = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0
  const out = new Uint8Array((input.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < input.length; i += 4) {
    const a = B64_LOOKUP[input.charCodeAt(i)]
    const b = B64_LOOKUP[input.charCodeAt(i + 1)]
    const c = B64_LOOKUP[input.charCodeAt(i + 2)]
    const d = B64_LOOKUP[input.charCodeAt(i + 3)]
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

/** 生成一份内置天空盒纹理。每次调用返回新纹理，由消费方负责 dispose。 */
export function createEnvironmentTexture(): DataTexture {
  const bytes = decodeBase64(SKYBOX_DATA_BASE64)
  const paletteOffset = SKYBOX_PALETTE_SIZE * 3
  const palette = bytes.subarray(0, paletteOffset)
  const packed = bytes.subarray(paletteOffset)
  const data = new Uint8Array(SKYBOX_WIDTH * SKYBOX_HEIGHT * 4)

  // 每 3 字节装 4 个 6 位索引（4 × 6 = 24 位）。
  let bitBuffer = 0
  let bitCount = 0
  let pos = 0
  for (let i = 0; i < SKYBOX_WIDTH * SKYBOX_HEIGHT; i++) {
    while (bitCount < 6) {
      bitBuffer |= packed[pos++] << bitCount
      bitCount += 8
    }
    const index = bitBuffer & 63
    bitBuffer >>>= 6
    bitCount -= 6
    const p = index * 3
    data[i * 4] = palette[p]
    data[i * 4 + 1] = palette[p + 1]
    data[i * 4 + 2] = palette[p + 2]
    data[i * 4 + 3] = 255
  }

  const texture = new DataTexture(data, SKYBOX_WIDTH, SKYBOX_HEIGHT, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
