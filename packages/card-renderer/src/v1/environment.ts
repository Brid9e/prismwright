/**
 * 内置摄影棚环境（等距全景）。
 *
 * 玻璃卡按反射向量采样它：不依赖任何资源文件，桌面端与小程序都能直接生成；尺寸固定为
 * 256×128（2 的幂），可生成 mipmap，粗糙度就用 mip 偏移来近似模糊反射。
 *
 * 画面是一间很简的摄影棚：上暗下亮的垂直渐变（地面 / 地平线 / 顶棚）+ 一块暖色主光、
 * 一块冷色补光、一条靠近地平线的窄轮廓光。冷暖对比让玻璃卡在转动时有可读的明暗走势。
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

const WIDTH = 256
const HEIGHT = 128

const clamp255 = (v: number): number => Math.min(255, Math.max(0, Math.round(v)))

/** 横向环绕距离（0..0.5）：等距图在经度 ±π 处接缝，光的中心越过接缝也能连续。 */
function wrapDist(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d)
}

/** 高斯光斑：d 是到中心的距离，sigma 是柔和半径。 */
function gauss(d: number, sigma: number): number {
  return Math.exp(-(d * d) / (2 * sigma * sigma))
}

/** 生成一份内置摄影棚等距环境纹理。每次调用返回新纹理，由消费方负责 dispose。 */
export function createStudioEnvironmentTexture(): DataTexture {
  const data = new Uint8Array(WIDTH * HEIGHT * 4)

  for (let y = 0; y < HEIGHT; y++) {
    const v = y / (HEIGHT - 1)
    // 垂直渐变：地面暗 → 地平线中间调 → 顶棚亮。
    let baseR: number
    let baseG: number
    let baseB: number
    if (v < 0.5) {
      const t = v / 0.5
      baseR = 20 + (72 - 20) * t
      baseG = 22 + (80 - 22) * t
      baseB = 27 + (94 - 27) * t
    } else {
      const t = (v - 0.5) / 0.5
      baseR = 72 + (176 - 72) * t
      baseG = 80 + (186 - 80) * t
      baseB = 94 + (202 - 94) * t
    }

    for (let x = 0; x < WIDTH; x++) {
      const u = x / (WIDTH - 1)
      // 暖色主光（左上方）+ 冷色补光（右下方）+ 地平线附近的窄轮廓光。
      const key = 0.9 * gauss(wrapDist(u, 0.3), 0.13) * gauss(v - 0.62, 0.18)
      const fill = 0.38 * gauss(wrapDist(u, 0.78), 0.16) * gauss(v - 0.55, 0.22)
      const rim = 0.5 * gauss(wrapDist(u, 0.68), 0.03) * gauss(v - 0.5, 0.08)
      // 环绕地平线的一圈亮带：平卡正对相机时反射到的就是这一圈，保证静看也有环境感。
      const horizon = 0.35 * gauss(v - 0.5, 0.10)

      const r = baseR + 255 * key + 150 * fill + 255 * rim + 120 * horizon
      const g = baseG + 238 * key + 180 * fill + 255 * rim + 120 * horizon
      const b = baseB + 214 * key + 230 * fill + 255 * rim + 120 * horizon

      const i = (y * WIDTH + x) * 4
      data[i] = clamp255(r)
      data[i + 1] = clamp255(g)
      data[i + 2] = clamp255(b)
      data[i + 3] = 255
    }
  }

  const texture = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
