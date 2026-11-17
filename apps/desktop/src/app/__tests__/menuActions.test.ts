/**
 * 菜单动作表的行为测试。
 *
 * 这张表由原生菜单与自绘标题栏**共用**，界面本身在 node 环境里渲染不了，但「点这一项
 * 会发生什么」是纯粹的 store 迁移——把它钉住，两个界面就都测到了。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { createEmptyPack } from "@cardbara/schema"
import { dispatch } from "../menuActions"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"

/** 复位两个 store（zustand v5 的 `getInitialState()` 给出未受影响的初始快照）。 */
function reset() {
  useUiStore.setState(useUiStore.getInitialState(), true)
  usePackStore.setState(usePackStore.getInitialState(), true)
}

describe("dispatch", () => {
  beforeEach(reset)

  it("app.settings 打开设置", () => {
    dispatch("app.settings")
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })

  it("view.left / view.right 折叠整栏", () => {
    dispatch("view.left")
    expect(useUiStore.getState().collapsed.left).toBe(true)
    dispatch("view.right")
    expect(useUiStore.getState().collapsed.right).toBe(true)
  })

  it("view.checker 切换棋盘底", () => {
    const before = useUiStore.getState().showChecker
    dispatch("view.checker")
    expect(useUiStore.getState().showChecker).toBe(!before)
  })

  it("file.export.series 在已打开系列时打开对话框", () => {
    usePackStore.setState({ pack: createEmptyPack("P") })
    dispatch("file.export.series")
    expect(useUiStore.getState().bundleExport).toEqual({ open: true, cardId: null })
  })

  it("file.export.series 无系列时什么都不做", () => {
    dispatch("file.export.series")
    expect(useUiStore.getState().bundleExport.open).toBe(false)
  })

  it("file.export.gif / png / webm 打开导出对话框并预选格式", () => {
    dispatch("file.export.gif")
    expect(useUiStore.getState().exportDialog).toEqual({ open: true, format: "gif" })
    dispatch("file.export.webm")
    expect(useUiStore.getState().exportDialog).toEqual({ open: true, format: "webm" })
    dispatch("file.export.png")
    expect(useUiStore.getState().exportDialog).toEqual({ open: true, format: "png" })
  })

  it("file.renamePack 在已打开系列时请求重命名", () => {
    usePackStore.setState({ pack: createEmptyPack("P") })
    dispatch("file.renamePack")
    expect(useUiStore.getState().pendingRenamePack).toBe(true)
  })

  it("file.renamePack 无系列时什么都不做", () => {
    dispatch("file.renamePack")
    expect(useUiStore.getState().pendingRenamePack).toBe(false)
  })

  it("file.probabilities 在已打开系列时弹出抽卡概率", () => {
    usePackStore.setState({ pack: createEmptyPack("P") })
    dispatch("file.probabilities")
    expect(useUiStore.getState().pendingProbabilities).toBe(true)
  })

  it("file.probabilities 无系列时什么都不做", () => {
    dispatch("file.probabilities")
    expect(useUiStore.getState().pendingProbabilities).toBe(false)
  })

  it("file.album 在已打开系列时打开卡册排版", () => {
    usePackStore.setState({ pack: createEmptyPack("P") })
    dispatch("file.album")
    expect(useUiStore.getState().albumOpen).toBe(true)
  })

  it("file.album 无系列时什么都不做", () => {
    dispatch("file.album")
    expect(useUiStore.getState().albumOpen).toBe(false)
  })

  it("file.covers 在已打开系列时打开封面对话框", () => {
    usePackStore.setState({ pack: createEmptyPack("P") })
    dispatch("file.covers")
    expect(useUiStore.getState().coverOpen).toBe(true)
  })

  it("file.covers 无系列时什么都不做", () => {
    dispatch("file.covers")
    expect(useUiStore.getState().coverOpen).toBe(false)
  })

  it("edit.delete-card 有选中卡时发起删除确认", () => {
    usePackStore.setState({ selectedCardId: "c1" })
    dispatch("edit.delete-card")
    expect(useUiStore.getState().pendingConfirm).toEqual({ kind: "delete-card", cardId: "c1" })
  })

  it("edit.delete-card 无选中卡时什么都不做", () => {
    dispatch("edit.delete-card")
    expect(useUiStore.getState().pendingConfirm).toBe(null)
  })

  it("未知 id 静默忽略", () => {
    expect(() => dispatch("no.such.item")).not.toThrow()
    expect(useUiStore.getState().settingsOpen).toBe(false)
  })

  it("app.quit 在无 Tauri 环境时静默降级（不抛）", async () => {
    // 单测跑在 node 里，没有 `__TAURI_INTERNALS__`：动态 import 若拿不到窗口只能静默失败，
    // 绝不能把异常甩给调用方（菜单项在两种界面下都可能是同一段代码触发的）。
    dispatch("app.quit")
    await Promise.resolve()
  })
})
