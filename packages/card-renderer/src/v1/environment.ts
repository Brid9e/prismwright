/**
 * 内置天空盒（等距全景，台球厅）。
 *
 * 贴图以 RGB565 的 base64 形式随源码分发（见 `environment-photo.ts`）：桌面端与小程序都
 * 不需要图片解码、资源路径或网络请求，运行时直接展开成 DataTexture，两端的场景完全同源。
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
import { SKYBOX_HEIGHT, SKYBOX_RGB565_BASE64, SKYBOX_WIDTH } from "./environment-photo"

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1)
  for (let i = 0; i < B64_CHARS.length; i++) table[B64_CHARS.charCodeAt(i)] = i
  return table
})()

/**
 * 纯 TS 的 base64 解码。
 *
 * 不依赖 `atob`：小程序基础库不一定提供；这段只在建纹理时跑一次，长度也只有几十 KB。
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
  const packed = decodeBase64(SKYBOX_RGB565_BASE64)
  const data = new Uint8Array(SKYBOX_WIDTH * SKYBOX_HEIGHT * 4)
  for (let i = 0; i < SKYBOX_WIDTH * SKYBOX_HEIGHT; i++) {
    const v = packed[i * 2] | (packed[i * 2 + 1] << 8)
    const r5 = (v >> 11) & 31
    const g6 = (v >> 5) & 63
    const b5 = v & 31
    // 位复制展开到 8 位：比直接乘 255/31 少一点偏移。
    data[i * 4] = (r5 << 3) | (r5 >> 2)
    data[i * 4 + 1] = (g6 << 2) | (g6 >> 4)
    data[i * 4 + 2] = (b5 << 3) | (b5 >> 2)
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
