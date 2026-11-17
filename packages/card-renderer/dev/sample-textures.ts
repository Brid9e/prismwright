/**
 * 用 canvas 在运行时生成样例纹理，避免向仓库提交二进制图片。
 * 生成：一张卡面（圆角矩 + 文字/色块）与两张蒙版（线稿风 / 亮区风）。
 */
import { CanvasTexture, NoColorSpace, SRGBColorSpace, type Texture } from "three"

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")
  if (!ctx) throw new Error("2d context 不可用")
  return [c, ctx]
}

/** 卡面样例：深色底 + 渐变圆 + 标题文字。 */
export function makeFrontTexture(): Texture {
  const [c, ctx] = makeCanvas(500, 700)
  const g = ctx.createLinearGradient(0, 0, 500, 700)
  g.addColorStop(0, "#1b2140")
  g.addColorStop(1, "#3a1f4d")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 500, 700)
  ctx.strokeStyle = "#cfe3ff"
  ctx.lineWidth = 10
  ctx.strokeRect(24, 24, 452, 652)
  ctx.fillStyle = "#eaf2ff"
  ctx.font = "bold 64px sans-serif"
  ctx.fillText("CARD", 150, 360)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** 线稿蒙版：黑底白线（`line` 模式下暗线出全息）。 */
export function makeLineMaskTexture(): Texture {
  const [c, ctx] = makeCanvas(500, 700)
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, 500, 700)
  ctx.strokeStyle = "#000"
  ctx.lineWidth = 8
  for (let i = 0; i < 10; i++) {
    ctx.beginPath()
    ctx.arc(250, 350, 40 + i * 26, 0, Math.PI * 2)
    ctx.stroke()
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = NoColorSpace
  return tex
}

/** 亮区蒙版：径向渐变（`fill` 模式下亮区出全息）。 */
export function makeFillMaskTexture(): Texture {
  const [c, ctx] = makeCanvas(500, 700)
  const g = ctx.createRadialGradient(250, 350, 20, 250, 350, 360)
  g.addColorStop(0, "#fff")
  g.addColorStop(1, "#000")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 500, 700)
  const tex = new CanvasTexture(c)
  tex.colorSpace = NoColorSpace
  return tex
}
