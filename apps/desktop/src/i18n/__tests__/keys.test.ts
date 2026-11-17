/**
 * i18n 语言资源的一致性测试。
 *
 * 只做一件事：两种语言的 key 集合必须完全相同。漏译不会让程序崩溃，只会让
 * 界面在某一种语言下露出英文 key，很难在人工验收时被发现，因此用测试钉住。
 */
import { describe, it, expect } from "vitest"
import zhCommon from "../locales/zh-CN/common.json"
import zhEditor from "../locales/zh-CN/editor.json"
import zhCard from "../locales/zh-CN/card.json"
import zhLayer from "../locales/zh-CN/layer.json"
import zhErrors from "../locales/zh-CN/errors.json"
import zhSettings from "../locales/zh-CN/settings.json"
import zhEffect from "../locales/zh-CN/effect.json"
import zhExport from "../locales/zh-CN/export.json"
import zhBundle from "../locales/zh-CN/bundle.json"
import enCommon from "../locales/en/common.json"
import enEditor from "../locales/en/editor.json"
import enCard from "../locales/en/card.json"
import enLayer from "../locales/en/layer.json"
import enErrors from "../locales/en/errors.json"
import enSettings from "../locales/en/settings.json"
import enEffect from "../locales/en/effect.json"
import enExport from "../locales/en/export.json"
import enBundle from "../locales/en/bundle.json"

/** 把嵌套资源摊平成 `a.b.c` 形式的 key 列表并排序。 */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix]
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
    .sort()
}

const PAIRS: Array<[string, unknown, unknown]> = [
  ["common", zhCommon, enCommon],
  ["editor", zhEditor, enEditor],
  ["card", zhCard, enCard],
  ["layer", zhLayer, enLayer],
  ["errors", zhErrors, enErrors],
  ["settings", zhSettings, enSettings],
  ["effect", zhEffect, enEffect],
  ["export", zhExport, enExport],
  ["bundle", zhBundle, enBundle],
]

describe("i18n 资源一致性", () => {
  it.each(PAIRS)("%s 命名空间的中英 key 集合一致", (_ns, zh, en) => {
    expect(flatten(en)).toEqual(flatten(zh))
  })

  it("不存在空字符串文案", () => {
    const empties = PAIRS.flatMap(([ns, , en]) =>
      flatten(en)
        .filter((key) => {
          const value = key.split(".").reduce<unknown>((o, k) => (o as never)?.[k], en)
          return value === ""
        })
        .map((key) => `${ns}.${key}`),
    )
    expect(empties).toEqual([])
  })
})
