/**
 * 样式刻度的守卫。
 *
 * 本轮 UI 重置的全部意义是「同类控件只有一个尺寸」。一旦有人写回 `h-[26px]` 或
 * `text-[13px]`，代码能跑、截图也「看着差不多」，但两套刻度已经重新开始分叉。
 * 故用测试扫源码，把任意值拦在提交之前。
 *
 * 只拦**控件相关**的任意值：容器尺寸（`w-[46rem]`、`max-h-[85vh]`、`max-w-[16ch]`）
 * 属于布局，不属于控件刻度，不在此列。例外必须显式写进 `ALLOWED` 并说明原因。
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["src/ui", "src/features"]

const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "圆角任意值", re: /rounded-\[/g },
  { name: "字号任意值", re: /text-\[\d/g },
  { name: "像素尺寸任意值", re: /[hw]-\[\d+px\]/g },
  { name: "间距任意值", re: /(?:gap|p[xytrbl]?)-\[\d/g },
  { name: "界面渐变", re: /bg-gradient/g },
]

/** 显式例外：文件 + 允许的片段 + 理由。 */
const ALLOWED: ReadonlyArray<{ file: string; fragment: RegExp; reason: string }> = [
  {
    file: "features/pack/CoverDialog.tsx",
    fragment: /w-\[600px\]/,
    reason: "封面裁剪对话框的固定画布宽度，属布局尺寸",
  },
]

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".tsx")) out.push(p)
  }
}

function violations(): string[] {
  const files: string[] = []
  for (const root of ROOTS) walk(root, files)

  const found: string[] = []
  for (const file of files) {
    const source = readFileSync(file, "utf8")
    for (const rule of RULES) {
      for (const match of source.matchAll(rule.re)) {
        const text = match[0]
        const allowed = ALLOWED.some(
          (a) => file.replace(/\\/g, "/").endsWith(a.file) && a.fragment.test(text),
        )
        if (!allowed) found.push(`${file}: ${rule.name} “${text}”`)
      }
    }
  }
  return found
}

describe("样式刻度", () => {
  it("控件不用任意值尺寸/圆角/字号，界面不写渐变", () => {
    expect(violations()).toEqual([])
  })
})
