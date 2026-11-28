/**
 * 「默认卡背」的进入 / 退出 / 另存为本系列。
 *
 * 默认卡背是应用数据目录下的一份普通系列：进入编辑就是打开它，退出就是打开回原系列。
 * 文件系统与 Tauri 的路径 API 都 mock 掉，测的是这条编排本身。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createEmptyPack, type Pack } from "@prismwright/schema"

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "/data"),
}))

vi.mock("../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    copyAsset: vi.fn(async () => ""),
    moveToTrash: vi.fn(async () => "token"),
    restoreFromTrash: vi.fn(async () => {}),
    purgeTrash: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
    isPackDir: vi.fn(async () => true),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
  },
}))

import {
  customizeBackFlow,
  editDefaultBackFlow,
  leaveDefaultBackFlow,
} from "../defaultBack"
import { createDefaultBackFace } from "../../features/default-back/default-back"
import { useDefaultBackStore } from "../../store/defaultBackStore"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { packFs } from "../../tauri/pack-fs"
import { join } from "../path"

const DEFAULT_ROOT = "/data/default-back"
const SERIES_ROOT = "/packs/mine"

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
  useUiStore.setState(useUiStore.getInitialState(), true)
  useDefaultBackStore.setState(useDefaultBackStore.getInitialState(), true)
  vi.clearAllMocks()
  // 测试跑在 node 环境（没有 window）：给 `window.alert` 一个落点。
  vi.stubGlobal("window", { alert: vi.fn() })
}

const packJson = (name: string, back: Pack["back"] = null) =>
  JSON.stringify({ ...createEmptyPack(name), back })

describe("editDefaultBackFlow", () => {
  beforeEach(reset)

  it("首次进入时建好工程，并预置内置造型", async () => {
    vi.mocked(packFs.isPackDir).mockResolvedValue(false)

    await editDefaultBackFlow("默认卡背")

    const state = usePackStore.getState()
    expect(state.rootDir).toBe(DEFAULT_ROOT)
    expect(state.pack?.back?.layers).toHaveLength(2)
    // 建完立刻落盘：这份工程之后由自动保存接管。
    expect(packFs.writeTextAtomic).toHaveBeenCalled()
    expect(useUiStore.getState().settingsOpen).toBe(false)
    expect(useUiStore.getState().previewSide).toBe("back")
  })

  it("工程已存在时直接打开，不覆盖用户做好的卡背", async () => {
    const back = createDefaultBackFace()
    vi.mocked(packFs.isPackDir).mockResolvedValue(true)
    vi.mocked(packFs.readText).mockResolvedValue(packJson("默认卡背", back))

    await editDefaultBackFlow("默认卡背")

    const state = usePackStore.getState()
    expect(state.rootDir).toBe(DEFAULT_ROOT)
    expect(state.pack?.back?.layers).toHaveLength(2)
  })

  it("打开前先保存当前系列（切换不能丢未落盘的改动）", async () => {
    vi.mocked(packFs.isPackDir).mockResolvedValue(true)
    vi.mocked(packFs.readText).mockResolvedValue(packJson("我的系列"))

    await usePackStore.getState().openPack(SERIES_ROOT)
    vi.mocked(packFs.writeTextAtomic).mockClear()
    await editDefaultBackFlow("默认卡背")

    expect(packFs.writeTextAtomic).toHaveBeenCalledWith(
      join(SERIES_ROOT, "pack.json"),
      expect.any(String),
    )
  })

  it("取不到应用数据目录时留在设置里，不切走系列", async () => {
    const { appDataDir } = await import("@tauri-apps/api/path")
    vi.mocked(appDataDir).mockRejectedValueOnce(new Error("no tauri"))
    vi.mocked(packFs.readText).mockResolvedValue(packJson("我的系列"))
    await usePackStore.getState().openPack(SERIES_ROOT)

    await editDefaultBackFlow("默认卡背")

    expect(usePackStore.getState().rootDir).toBe(SERIES_ROOT)
    expect(window.alert).toHaveBeenCalled()
  })
})

describe("leaveDefaultBackFlow", () => {
  beforeEach(reset)

  it("回到进入之前打开的那个系列", async () => {
    vi.mocked(packFs.isPackDir).mockResolvedValue(true)
    vi.mocked(packFs.readText).mockResolvedValue(packJson("我的系列"))

    await usePackStore.getState().openPack(SERIES_ROOT)
    await editDefaultBackFlow("默认卡背")
    await leaveDefaultBackFlow()

    expect(usePackStore.getState().rootDir).toBe(SERIES_ROOT)
    expect(useUiStore.getState().previewSide).toBe("front")
  })

  it("原系列已不在时退回启动屏，而不是停在一个假的空编辑器里", async () => {
    vi.mocked(packFs.isPackDir).mockResolvedValue(true)
    vi.mocked(packFs.readText).mockResolvedValue(packJson("我的系列"))

    await usePackStore.getState().openPack(SERIES_ROOT)
    await editDefaultBackFlow("默认卡背")
    // 退出时原目录已经找不到了。
    vi.mocked(packFs.isPackDir).mockResolvedValue(false)
    await leaveDefaultBackFlow()

    expect(usePackStore.getState().pack).toBeNull()
  })
})

describe("customizeBackFlow", () => {
  beforeEach(reset)

  it("把默认卡背拷进本系列，素材一并搬过来", async () => {
    const back = createDefaultBackFace()
    back.layers[0].effects = [{ id: "img", enabled: true, kind: "image", params: { path: "assets/x.png", x: 0, y: 0, rotation: 0, scale: 1, fit: "contain", bumpStrength: 0, bumpDetail: 0.01, bumpFlow: 0.5, bumpLight: 1, bumpLightAngle: 127, bumpLightColor: "#ffffff", bumpInvert: false, normalPath: "", normalFlipY: false } }]
    vi.mocked(packFs.readText).mockResolvedValue(packJson("我的系列"))
    await usePackStore.getState().openPack(SERIES_ROOT)
    useDefaultBackStore.setState({ rootDir: DEFAULT_ROOT, face: back, loaded: true })

    await customizeBackFlow()

    const own = usePackStore.getState().pack?.back
    expect(own?.layers).toHaveLength(2)
    expect(own).not.toBe(back)
    expect(packFs.copyAsset).toHaveBeenCalledWith(
      `${DEFAULT_ROOT}/assets/x.png`,
      SERIES_ROOT,
      "assets/x.png",
    )
  })

  it("系列已有自己的卡背时不动它", async () => {
    const back = createDefaultBackFace()
    vi.mocked(packFs.readText).mockResolvedValue(packJson("我的系列", back))
    await usePackStore.getState().openPack(SERIES_ROOT)
    const before = usePackStore.getState().pack?.back
    useDefaultBackStore.setState({ rootDir: DEFAULT_ROOT, face: back, loaded: true })

    await customizeBackFlow()

    expect(usePackStore.getState().pack?.back).toBe(before)
    expect(packFs.copyAsset).not.toHaveBeenCalled()
  })
})
