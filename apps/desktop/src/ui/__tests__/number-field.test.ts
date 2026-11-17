/**
 * `number-field.ts` 纯逻辑测试。
 *
 * 覆盖用例：
 * - `formatNumber`：按 `precision` 位数格式化并去掉尾随零；
 * - `resolveNumberInput`：空串 / 纯空白 / 非法输入 → 不提交且回退显示；
 * - **回归**：未编辑（文本仍等于当前值的显示形式）时绝不提交，即使显示经过了取整；
 * - 真正编辑过才提交；越界夹取；夹取后回到当前值不产生幽灵历史点。
 *
 * 环境：node（`vitest.config.ts`），被测对象无 DOM 依赖。
 */
import { describe, it, expect } from "vitest"
import { formatNumber, resolveNumberInput } from "../number-field"

describe("formatNumber", () => {
  it("保留 precision 位小数并去掉尾随零", () => {
    expect(formatNumber(1.5, 3)).toBe("1.5")
    expect(formatNumber(2, 3)).toBe("2")
    expect(formatNumber(0.5, 3)).toBe("0.5")
  })

  it("precision 为 0 时不带小数位", () => {
    expect(formatNumber(2.7, 0)).toBe("3")
    expect(formatNumber(1, 0)).toBe("1")
    expect(formatNumber(2.7, 0)).not.toContain(".")
  })

  it("按 precision 四舍五入显示（仅显示，不改变原值）", () => {
    expect(formatNumber(0.8567, 3)).toBe("0.857")
  })
})

describe("resolveNumberInput — 非法输入不提交", () => {
  it("空串与纯空白 → value 为 null，display 回退到当前值的显示形式", () => {
    const empty = resolveNumberInput("", 0.8567, { precision: 3 })
    expect(empty.value).toBeNull()
    expect(empty.display).toBe("0.857")

    const blank = resolveNumberInput("   ", 0.8567, { precision: 3 })
    expect(blank.value).toBeNull()
    expect(blank.display).toBe("0.857")
  })

  it("非数字文本（abc / -）→ value 为 null，NaN 绝不上抛", () => {
    expect(resolveNumberInput("abc", 0.5, { precision: 3 }).value).toBeNull()
    expect(resolveNumberInput("-", 0.5, { precision: 3 }).value).toBeNull()
    expect(resolveNumberInput(".", 0.5, { precision: 3 }).value).toBeNull()
  })
})

describe("resolveNumberInput — 未编辑不提交（回归）", () => {
  it("文本等于当前值的显示形式时不提交，即使显示经过了取整", () => {
    // 靶心用例：0.8567 显示为 "0.857"，点进再点出不得把 value 抹成 0.857。
    const result = resolveNumberInput(formatNumber(0.8567, 3), 0.8567, { precision: 3 })
    expect(result.value).toBeNull()
    expect(result.display).toBe("0.857")
  })

  it("precision=0 的同型用例：2.7 显示为 3，未编辑不提交", () => {
    const result = resolveNumberInput(formatNumber(2.7, 0), 2.7, { precision: 0 })
    expect(result.value).toBeNull()
    expect(result.display).toBe("3")
  })
})

describe("resolveNumberInput — 编辑后才提交", () => {
  it("文本变了就提交解析后的值", () => {
    const result = resolveNumberInput("0.5", 0.8567, { precision: 3 })
    expect(result.value).toBe(0.5)
    expect(result.display).toBe("0.5")
  })
})

describe("resolveNumberInput — 夹取", () => {
  it("高于 max 夹到 max，低于 min 夹到 min", () => {
    expect(resolveNumberInput("5", 0.5, { min: 0, max: 1, precision: 3 }).value).toBe(1)
    expect(resolveNumberInput("-3", 0.5, { min: 0, max: 1, precision: 3 }).value).toBe(0)
  })

  it("display 反映夹取后的值", () => {
    expect(resolveNumberInput("5", 0.5, { min: 0, max: 1, precision: 3 }).display).toBe("1")
    expect(resolveNumberInput("-3", 0.5, { min: 0, max: 1, precision: 3 }).display).toBe("0")
  })

  it("夹取后等于当前值 → value 为 null（无幽灵历史点）", () => {
    const result = resolveNumberInput("5", 1, { max: 1, precision: 3 })
    expect(result.value).toBeNull()
    expect(result.display).toBe("1")
  })
})
