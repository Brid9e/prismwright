/**
 * uiStore 的行为测试。
 *
 * 只测非数据态：面板折叠、预览开关、对话框队列、缺失资源标记。
 * 选中态不在这里（见设计文档偏离 D1）。
 */
import { describe, it, expect, beforeEach } from "vitest"
import { useUiStore } from "../uiStore"
import { ERASE_BRUSH_WIDTH } from "../../features/preview/eraseCanvas"
import type { BundleInfo } from "../../tauri/bundle"

function reset() {
  useUiStore.setState(useUiStore.getInitialState(), true)
}

describe("uiStore", () => {
  beforeEach(reset)

  it("初始为深色 + 正面 + 中文", () => {
    const s = useUiStore.getState()
    expect(s.language).toBe("zh-CN")
    expect(s.previewSide).toBe("front")
    expect(s.collapsed).toEqual({ left: false, right: false })
    expect(s.folded).toEqual({ left: false, right: false })
    expect(s.settingsOpen).toBe(false)
    expect(s.pendingNewPack).toBeNull()
  })

  it("toggleCollapsed 只翻转指定一侧", () => {
    useUiStore.getState().toggleCollapsed("left")
    expect(useUiStore.getState().collapsed).toEqual({ left: true, right: false })
    useUiStore.getState().toggleCollapsed("left")
    expect(useUiStore.getState().collapsed).toEqual({ left: false, right: false })
  })

  it("toggleFolded 只翻转指定一侧，且与 collapsed 相互独立", () => {
    useUiStore.getState().toggleFolded("right")
    expect(useUiStore.getState().folded).toEqual({ left: false, right: true })
    // 折内容不动整栏隐藏状态——两者是独立的机制（标题栏常驻 vs 整栏收起）。
    expect(useUiStore.getState().collapsed).toEqual({ left: false, right: false })
    useUiStore.getState().toggleFolded("right")
    expect(useUiStore.getState().folded).toEqual({ left: false, right: false })
  })

  it("previewZoom 默认为 2，可设置", () => {
    expect(useUiStore.getState().previewZoom).toBe(2)
    useUiStore.getState().setPreviewZoom(2.5)
    expect(useUiStore.getState().previewZoom).toBe(2.5)
  })

  it("markMissing 幂等：重复标记同一路径不产生新的引用", () => {
    useUiStore.getState().markMissing("assets/a.png")
    const after1 = useUiStore.getState().missingAssets
    useUiStore.getState().markMissing("assets/a.png")
    expect(useUiStore.getState().missingAssets).toBe(after1)
    expect(useUiStore.getState().missingAssets).toEqual({ "assets/a.png": true })
  })

  it("clearMissing 不带参数清空全部，带参数只清一条", () => {
    useUiStore.getState().markMissing("a")
    useUiStore.getState().markMissing("b")
    useUiStore.getState().clearMissing("a")
    expect(useUiStore.getState().missingAssets).toEqual({ b: true })
    useUiStore.getState().clearMissing()
    expect(useUiStore.getState().missingAssets).toEqual({})
  })

  it("requestConfirm / resolveConfirm 成对", () => {
    useUiStore.getState().requestConfirm({ kind: "delete-card", cardId: "c1" })
    expect(useUiStore.getState().pendingConfirm).toEqual({ kind: "delete-card", cardId: "c1" })
    useUiStore.getState().resolveConfirm()
    expect(useUiStore.getState().pendingConfirm).toBeNull()
  })

  it("setLanguage 同时切换 i18n 之外的状态（语言本身）", () => {
    useUiStore.getState().setLanguage("en")
    expect(useUiStore.getState().language).toBe("en")
  })

  it("editorVersion 默认为 v1，可设置", () => {
    expect(useUiStore.getState().editorVersion).toBe("v1")
    useUiStore.getState().setEditorVersion("v1")
    expect(useUiStore.getState().editorVersion).toBe("v1")
  })

  it("settingsOpen 默认关，可开可关", () => {
    expect(useUiStore.getState().settingsOpen).toBe(false)
    useUiStore.getState().setSettingsOpen(true)
    expect(useUiStore.getState().settingsOpen).toBe(true)
    useUiStore.getState().setSettingsOpen(false)
    expect(useUiStore.getState().settingsOpen).toBe(false)
  })

  it("openExportDialog / closeExportDialog 成对，关闭保留已选格式", () => {
    expect(useUiStore.getState().exportDialog).toEqual({ open: false, format: "gif" })
    useUiStore.getState().openExportDialog("webm")
    expect(useUiStore.getState().exportDialog).toEqual({ open: true, format: "webm" })
    useUiStore.getState().closeExportDialog()
    expect(useUiStore.getState().exportDialog).toEqual({ open: false, format: "webm" })
  })

  it("newPackDir 默认空，可设置", () => {
    expect(useUiStore.getState().newPackDir).toBe("")
    useUiStore.getState().setNewPackDir("/home/u/Documents/Prismwright")
    expect(useUiStore.getState().newPackDir).toBe("/home/u/Documents/Prismwright")
  })

  it("requestNewPack / resolveNewPack 成对", () => {
    expect(useUiStore.getState().pendingNewPack).toBeNull()
    useUiStore.getState().requestNewPack("/tmp/p")
    expect(useUiStore.getState().pendingNewPack).toEqual({ baseDir: "/tmp/p" })
    useUiStore.getState().resolveNewPack()
    expect(useUiStore.getState().pendingNewPack).toBeNull()
  })

  it("requestColorPick / resolveColorPick 成对", () => {
    const request = {
      ref: { kind: "card", cardId: "c1" } as const,
      target: { scope: "face" } as const,
      effectId: "e1",
    }
    expect(useUiStore.getState().colorPick).toBeNull()
    useUiStore.getState().requestColorPick(request)
    expect(useUiStore.getState().colorPick).toEqual(request)
    useUiStore.getState().resolveColorPick()
    expect(useUiStore.getState().colorPick).toBeNull()
  })

  it("requestErasePaint / resolveErasePaint 成对，且与拾色互不干扰", () => {
    const ref = { kind: "back" } as const
    useUiStore.getState().requestErasePaint({ ref, target: { scope: "face" }, effectId: "e2" })
    expect(useUiStore.getState().erasePaint).toEqual({
      ref,
      target: { scope: "face" },
      effectId: "e2",
    })
    // 两种模式各自一个槽位：开绘画不应顺带清掉拾色请求（反之亦然）。
    expect(useUiStore.getState().colorPick).toBeNull()
    useUiStore.getState().resolveErasePaint()
    expect(useUiStore.getState().erasePaint).toBeNull()
  })

  // 绘画期间的撤销 / 重做借给画布；会话一结束就必须摘掉，否则 Ctrl+Z 会作用在
  // 一张已经 dispose 的画布上（而不是回到 pack 的历史）。
  it("erasePaintHistory 可注册，结束绘画时一并摘除", () => {
    const undo = () => {}
    const redo = () => {}
    useUiStore.getState().requestErasePaint({
      ref: { kind: "back" },
      target: { scope: "face" },
      effectId: "e3",
    })
    useUiStore.getState().setErasePaintHistory({ undo, redo })
    expect(useUiStore.getState().erasePaintHistory).toEqual({ undo, redo })

    useUiStore.getState().resolveErasePaint()
    expect(useUiStore.getState().erasePaintHistory).toBeNull()
  })

  // 画笔宽度是跨会话的偏好（调粗一次，下次再画还是这个宽度），故进 store 而不是绘画会话本地。
  it("eraseBrushWidth 有默认值且可设置", () => {
    expect(useUiStore.getState().eraseBrushWidth).toBe(ERASE_BRUSH_WIDTH)
    useUiStore.getState().setEraseBrushWidth(96)
    expect(useUiStore.getState().eraseBrushWidth).toBe(96)
  })

  // 默认开：不铺底色就只剩一片透明，看不出笔迹边界。
  it("erasePreview 默认开，可关", () => {
    expect(useUiStore.getState().erasePreview).toBe(true)
    useUiStore.getState().setErasePreview(false)
    expect(useUiStore.getState().erasePreview).toBe(false)
  })

  it("bundle 对话框状态独立开关", () => {
    const info: BundleInfo = {
      kind: 2,
      manifest: {
        format: "prismwright-bundle",
        version: 1,
        kind: "series",
        includesHistory: false,
        createdAt: "2026-11-06T00:00:00.000Z",
        appVersion: "0.1.0",
        series: { id: "s1", name: "系列", cardCount: 1 },
        card: null,
      },
      size: 10,
      entryCount: 2,
    }
    useUiStore.getState().openBundleImport("/f.cards", info)
    expect(useUiStore.getState().bundleImport).toEqual({
      open: true,
      sourcePath: "/f.cards",
      info,
    })
    useUiStore.getState().closeBundleImport()
    expect(useUiStore.getState().bundleImport.open).toBe(false)
    useUiStore.getState().openBundleExport("c1")
    expect(useUiStore.getState().bundleExport).toEqual({ open: true, cardId: "c1" })
  })

  it("右键菜单：打开记录位置与条目，关闭清空", () => {
    expect(useUiStore.getState().contextMenu).toBeNull()
    const items = [{ kind: "item" as const, label: "复制", onSelect: () => {} }]
    useUiStore.getState().openContextMenu({ x: 12, y: 34, items })
    expect(useUiStore.getState().contextMenu).toEqual({ x: 12, y: 34, items })
    useUiStore.getState().closeContextMenu()
    expect(useUiStore.getState().contextMenu).toBeNull()
  })
})
