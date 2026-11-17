/**
 * 文字排版与像素行翻转：不依赖 canvas / WebGL 的纯函数，便于单测。
 *
 * 坐标口径（与 `ImageParams` 一致）：长度单位是「卡高」，x 向右、y 向上；进入画布前
 * 按纹理高度换算成像素。块内坐标以**文字块中心**为原点，`y` 向上为正——画布 y 向下，
 * 绘制时取 `-y`（见 text-texture.ts）。
 */
import type { TextAlign, TextParams } from "@cardbara/schema"

/** 一段绘制单元：一段文字 + 它左端相对「行起点」的 x 偏移（像素）。 */
export interface TextRun {
  text: string
  x: number
}

/** 一行的绘制单元与其总宽（像素）。 */
export interface LineRuns {
  /** 字距为 0 时是整行一段（保留 kerning / 连字）；否则逐字符一段。 */
  runs: TextRun[]
  width: number
}

/**
 * 把一行切成绘制单元。
 *
 * 字距为 0 时整行一段：中文不需要 kerning，但西文的连字与字偶距是整行测量才有的，
 * 默认参数下不该被拆散。字距非零时只能逐字符摆放——每段自带起点，绘制与测量共用
 * 这一份结果，行宽与落点就不会各算各的。
 *
 * @param text - 行内容（可空）。
 * @param startX - 行起点相对文字块中心的 x（像素）。
 * @param spacingPx - 字距（像素，已按卡高换算）。
 * @param measure - 文本宽度测量（通常是 `ctx.measureText(t).width`）。
 */
export function layoutRuns(
  text: string,
  startX: number,
  spacingPx: number,
  measure: (text: string) => number,
): LineRuns {
  if (spacingPx === 0) {
    const width = measure(text)
    return { runs: text === "" ? [] : [{ text, x: startX }], width }
  }
  // 按码位切分（Array.from）：直接下标会把代理对劈成两半，emoji 等字符就会画成乱码。
  const chars = Array.from(text)
  const runs: TextRun[] = []
  let cursor = 0
  for (const char of chars) {
    runs.push({ text: char, x: startX + cursor })
    cursor += measure(char) + spacingPx
  }
  return { runs, width: runs.length > 0 ? cursor - spacingPx : 0 }
}

/** 一行在文字块内的排布。 */
export interface TextLineLayout {
  /** 行内容。 */
  text: string
  /** 该行宽度（像素）。 */
  width: number
  /** 该行起点相对文字块中心的 x（像素）。 */
  x: number
  /** 该行中线相对文字块中心的 y（像素，向上为正）。 */
  y: number
  /** 绘制单元（x 相对**行起点**）。 */
  runs: TextRun[]
}

/** 整块文字的排布结果。 */
export interface TextBlockLayout {
  lines: TextLineLayout[]
  /** 字号（像素）。 */
  fontPx: number
  /** 行高（像素）。 */
  lineHeightPx: number
  /** 块宽 = 最宽一行（像素）。 */
  blockWidth: number
  /** 块高 = 行数 × 行高（像素）。 */
  blockHeight: number
}

/** 行起点：左对齐贴块左缘、右对齐贴块右缘、居中按本行宽度居中。 */
function lineStartX(align: TextAlign, lineWidth: number, blockWidth: number): number {
  if (align === "left") return -blockWidth / 2
  if (align === "right") return blockWidth / 2 - lineWidth
  return -lineWidth / 2
}

/**
 * 排版整段文字。
 *
 * @param params - 文字参数。
 * @param measure - 文本宽度测量（字体必须先设进 canvas 再量）。
 * @param height - 纹理高度（像素）；字号 / 字距 / 偏移都按它换算。
 */
export function layoutText(
  params: TextParams,
  measure: (text: string) => number,
  height: number,
): TextBlockLayout {
  const fontPx = params.fontSize * height
  const lineHeightPx = params.lineHeight * fontPx
  const spacingPx = params.letterSpacing * height
  // 保留空行：换行是排版的一部分，空行占一行行高。
  const texts = params.content.split("\n")
  const measured = texts.map((text) => layoutRuns(text, 0, spacingPx, measure))
  const blockWidth = measured.reduce((max, line) => Math.max(max, line.width), 0)
  const blockHeight = texts.length * lineHeightPx
  const lines = texts.map((text, i): TextLineLayout => {
    const width = measured[i].width
    return {
      text,
      width,
      x: lineStartX(params.align, width, blockWidth),
      // 块顶为 +blockHeight/2；第 i 行中线再下移 (i + 0.5) 个行高。
      y: blockHeight / 2 - lineHeightPx * (i + 0.5),
      runs: measured[i].runs,
    }
  })
  return { lines, fontPx, lineHeightPx, blockWidth, blockHeight }
}

/** CSS 通用族名：这些是关键字，不能在字体串里加引号。 */
const GENERIC_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
])

/** 给单个族名加引号：含空格的族名不加引号会被 canvas 判为非法字体串。 */
function quoteFamily(name: string): string {
  const trimmed = name.trim()
  if (trimmed === "") return "sans-serif"
  if (/^(['"]).*\1$/.test(trimmed)) return trimmed
  if (GENERIC_FAMILIES.has(trimmed.toLowerCase())) return trimmed
  return `"${trimmed.replace(/["']/g, "")}"`
}

/**
 * 组装 canvas 的 `font` 字符串：`[italic ]<weight> <px>px <family>`。
 *
 * `fontFamily` 按 CSS 语义可写逗号分隔的回退列表，逐段加引号；非法字体串会让
 * `ctx.font = …` 被静默忽略、沿用上一个字体，字形全错却不报错，所以这里必须拼对。
 */
export function fontCssString(params: TextParams, fontPx: number): string {
  const family = params.fontFamily
    .split(",")
    .map(quoteFamily)
    .join(", ")
  const style = params.italic ? "italic " : ""
  return `${style}${params.fontWeight} ${fontPx}px ${family}`
}

/**
 * 就地把像素行上下翻转。
 *
 * WebGL 纹理坐标的 v = 0 在**底部**，画布第 0 行在**顶部**；`DataTexture` 上传的是普通
 * 类型化数组（不经过 UNPACK_FLIP_Y），故必须在这里翻好，否则文字上下颠倒。
 *
 * @param data - RGBA 像素（每像素 4 字节，长度 = width × height × 4）。
 * @param width - 宽（像素）。
 * @param height - 高（像素）。
 */
export function flipRowsInPlace(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): void {
  const rowBytes = width * 4
  if (rowBytes <= 0 || height <= 1) return
  const scratch = new Uint8Array(rowBytes)
  for (let row = 0; row < Math.floor(height / 2); row++) {
    const top = row * rowBytes
    const bottom = (height - 1 - row) * rowBytes
    scratch.set(data.subarray(top, top + rowBytes))
    data.copyWithin(top, bottom, bottom + rowBytes)
    data.set(scratch, bottom)
  }
}
