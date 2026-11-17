/**
 * 应用启动编排。
 *
 * 顺序要紧：先读持久化语言 → 用该语言初始化 i18n → 才挂 React。反过来会让首帧
 * 用默认语言渲染一次再切换，用户能看到一闪而过的语言跳变。默认新建目录与编辑器版本
 * 同理，在挂 React 前解析好：设置页首帧就是正确值，不会先亮一下默认选项。选中主题也
 * 一并在挂载前应用：保证首帧即为所选外观，否则会先闪一下默认深色再跳到所选主题。
 */
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { initI18n } from "../i18n/init"
import { loadLanguage } from "./language"
import { loadEditorVersion } from "./editorVersion"
import { resolveNewPackDir } from "./packDir"
import { loadThemeId } from "./theme"
import { useUiStore } from "../store/uiStore"
import { useThemeStore } from "../store/themeStore"
import { applyTheme } from "../themes/apply"
import { findTheme } from "../themes/registry"

export async function bootstrap() {
  const language = await loadLanguage()
  initI18n(language)
  useUiStore.getState().setLanguage(language)
  useUiStore.getState().setEditorVersion(await loadEditorVersion())
  useUiStore.getState().setNewPackDir(await resolveNewPackDir())

  // 主题：读选中 id → 载入可用主题（内置同步 + 导入读盘，非 Tauri 时降级为空）→
  // 在挂载前应用，避免首帧闪默认主题再跳到所选外观。
  useThemeStore.setState({ selectedId: await loadThemeId() })
  await useThemeStore.getState().load()
  const { themes, selectedId } = useThemeStore.getState()
  applyTheme(findTheme(themes, selectedId)?.tokens ?? null)

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
