/**
 * 效果注册表 → i18n 的接缝。
 *
 * `keys.test.ts` 只管中英两边 key 是否一致，管不到「注册表里声明的 labelKey 有没有配文案」——
 * 漏配时界面不报错也不崩，只是把原始 key 原样画出来（如 `effect.gradient.count`），人工验收
 * 很容易看漏。这里补上这一条：注册表声明的每个键都必须能在对应命名空间里查到。
 */
import { describe, it, expect } from "vitest"
import { EFFECT_REGISTRY, EFFECT_KINDS, MASK_PRESETS } from "@cardbara/renderer/v1"
import zhEffect from "../../../i18n/locales/zh-CN/effect.json"
import enEffect from "../../../i18n/locales/en/effect.json"
import zhLayer from "../../../i18n/locales/zh-CN/layer.json"
import enLayer from "../../../i18n/locales/en/layer.json"

/** 一个命名空间的两种语言资源。 */
const EFFECT_LOCALES: Array<[string, unknown]> = [
  ["zh-CN", zhEffect],
  ["en", enEffect],
]
const LAYER_LOCALES: Array<[string, unknown]> = [
  ["zh-CN", zhLayer],
  ["en", enLayer],
]

/** 按 `a.b.c` 取嵌套文案；取不到返回 undefined。 */
function lookup(res: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc as never)?.[k], res)
}

/** 注册表里一处描述声明的全部 i18n 键：效果名 + 每个字段名 + 每个候选项名。 */
function effectKeys(): string[] {
  const keys: string[] = []
  for (const kind of EFFECT_KINDS) {
    const def = EFFECT_REGISTRY[kind]
    keys.push(def.labelKey)
    for (const field of def.fields) {
      keys.push(field.labelKey)
      // 只有 select / preset 字段带 `options`，`in` 收窄后取候选项文案。
      for (const option of "options" in field ? field.options : []) keys.push(option.labelKey)
    }
  }
  return keys
}

describe("效果注册表 → i18n", () => {
  it.each(EFFECT_LOCALES)("%s：注册表声明的每个键都在 effect 命名空间有文案", (_locale, res) => {
    for (const key of effectKeys()) {
      const label = lookup(res, key)
      expect(typeof label, key).toBe("string")
      expect(label, key).not.toBe("")
    }
  })

  // 预设名走 `layer` 命名空间（`MASK_PRESETS[].labelKey`），与注册表其它文案不同源，单独钉住。
  it.each(LAYER_LOCALES)("%s：每个蒙版预设名都在 layer 命名空间有文案", (_locale, res) => {
    for (const preset of MASK_PRESETS) {
      const label = lookup(res, preset.labelKey)
      expect(typeof label, preset.id).toBe("string")
      expect(label, preset.id).not.toBe("")
    }
  })
})
