/**
 * i18n 初始化。
 *
 * 资源静态打包而非走 http backend：只有两种语言、八个命名空间，打包进产物比
 * 运行时异步加载更简单、也避免首屏闪出 key。
 *
 * 语言持久化不在这里——`initI18n` 只负责把已确定的语言装上去，读取/写入由
 * `app/bootstrap.tsx` 经 tauri-plugin-store 完成。
 */
import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import zhCommon from "./locales/zh-CN/common.json"
import zhEditor from "./locales/zh-CN/editor.json"
import zhCard from "./locales/zh-CN/card.json"
import zhLayer from "./locales/zh-CN/layer.json"
import zhErrors from "./locales/zh-CN/errors.json"
import zhSettings from "./locales/zh-CN/settings.json"
import zhEffect from "./locales/zh-CN/effect.json"
import zhExport from "./locales/zh-CN/export.json"
import zhBundle from "./locales/zh-CN/bundle.json"
import enCommon from "./locales/en/common.json"
import enEditor from "./locales/en/editor.json"
import enCard from "./locales/en/card.json"
import enLayer from "./locales/en/layer.json"
import enErrors from "./locales/en/errors.json"
import enSettings from "./locales/en/settings.json"
import enEffect from "./locales/en/effect.json"
import enExport from "./locales/en/export.json"
import enBundle from "./locales/en/bundle.json"

/** 支持的语言。`zh-CN` 为回退语言。 */
export const SUPPORTED_LANGUAGES = ["zh-CN", "en"] as const

/** 支持语言的联合类型。 */
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

/** 命名空间列表，与 `locales/` 下的文件名一一对应。 */
export const NAMESPACES = [
  "common",
  "editor",
  "card",
  "layer",
  "errors",
  "settings",
  "effect",
  "export",
  "bundle",
] as const

const resources = {
  "zh-CN": {
    common: zhCommon,
    editor: zhEditor,
    card: zhCard,
    layer: zhLayer,
    errors: zhErrors,
    settings: zhSettings,
    effect: zhEffect,
    export: zhExport,
    bundle: zhBundle,
  },
  en: {
    common: enCommon,
    editor: enEditor,
    card: enCard,
    layer: enLayer,
    errors: enErrors,
    settings: enSettings,
    effect: enEffect,
    export: enExport,
    bundle: enBundle,
  },
}

/** 判断任意字符串是否为受支持的语言。 */
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/**
 * 用指定语言初始化 i18next（重复调用即切换语言）。
 *
 * @param language - 目标语言；非受支持值时回退 `zh-CN`。
 * @returns 已初始化的 i18next 实例。
 */
export function initI18n(language: Language = "zh-CN") {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: "zh-CN",
      ns: NAMESPACES,
      defaultNS: "common",
      interpolation: { escapeValue: false },
    })
  } else {
    void i18n.changeLanguage(language)
  }
  return i18n
}

export default i18n
