/**
 * 展示名回退的纯函数测试。
 *
 * 钉住 Review Focus 第 3 条：卡名/图层名为空串时列表不能显示成空白行——
 * 用户需要知道「这一行是什么」才能选中它去改名。
 *
 * 图层的回退**必须是与位置无关的常量**：默认名（「图层 1」）在创建时就写进了数据，
 * 若这里还按列表下标现算，拖拽重排就会让同一层的显示名跟着位置变——正是被报的那个 bug。
 */
import { describe, it, expect } from "vitest"
import { displayCardName, displayLayerName } from "../display"

/**
 * 极简的 t 替身：只处理插值，不依赖 i18next 运行时。
 *
 * 两个命名空间各自一个实例，因为真实调用点传的是**已绑定命名空间**的 `t`，
 * 键名不带前缀。若这里合成一个带前缀的表，就会掩盖「键写错前缀」这类问题。
 */
function makeT(table: Record<string, string>) {
  return ((key: string, opts?: Record<string, unknown>) =>
    (table[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      String(opts?.[k] ?? ""),
    )) as never
}

const tCard = makeT({ unnamed: "卡片 {{num}}" })
const tLayer = makeT({ unnamedLayer: "未命名图层" })

describe("展示名回退", () => {
  it("有名字时用名字", () => {
    expect(displayCardName({ num: 3, name: "星辰" }, tCard)).toBe("星辰")
    // 图层名是创建时写进数据的默认名，展示时只做透传。
    expect(displayLayerName({ name: "图层 1" }, tLayer)).toBe("图层 1")
  })

  it("空名字回退到带序号的卡片默认名", () => {
    expect(displayCardName({ num: 3, name: "" }, tCard)).toBe("卡片 3")
  })

  it("图层空名字回退到「未命名图层」，且与下标无关", () => {
    // 老系列补名之前的图层会走到这条分支；显示成常量，就不存在「换个位置换个名字」。
    expect(displayLayerName({ name: "" }, tLayer)).toBe("未命名图层")
  })

  it("全空白（空格）也视为未命名", () => {
    expect(displayCardName({ num: 1, name: "   " }, tCard)).toBe("卡片 1")
    expect(displayLayerName({ name: "   " }, tLayer)).toBe("未命名图层")
  })

  it("键名不带命名空间前缀，否则在已绑定的 t 上会解析失败", () => {
    // 传入一个「只认无前缀键」的替身：带前缀会原样返回键，从而在断言上暴露。
    expect(displayCardName({ num: 7, name: "" }, tCard)).not.toContain("unnamed")
    expect(displayLayerName({ name: "" }, tLayer)).not.toContain("unnamedLayer")
  })
})
