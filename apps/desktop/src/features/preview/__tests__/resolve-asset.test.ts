/**
 * 资源解析器的行为测试。
 *
 * 钉住 Review Focus 第 5 条：读失败必须上报（供 UI 打徽标）并向渲染器抛错
 * （由渲染器的纹理缓存兜住并回退占位），而不是静默变成一张空白图。
 *
 * 依赖处理：`three` 的 TextureLoader 与 `URL.createObjectURL` 在 node 环境不存在，
 * 这里整体替身；被测的是「读字节 → 建纹理 → 失败上报」这条编排逻辑本身。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// 四个参数都声明为**必需**：第三例会用 4 参回调调 `mockImplementationOnce`，
// 若尾部参数是可选的，`Parameters<F>` 仍是「可少传」的签名，四参回调无法赋值。
// `_onError` 取 three 的真实签名 `(err: unknown) => void`（而非 `unknown`）：
// 函数参数是逆变的，第三例的回调会把该位置收窄成可调用类型，`unknown` 不满足赋值。
const loadMock = vi.fn(
  (
    _url: string,
    onLoad: (t: unknown) => void,
    _onProgress: unknown,
    _onError: (err: unknown) => void,
  ) => onLoad({ isTexture: true }),
)

vi.mock("three", () => ({
  TextureLoader: class {
    load = loadMock
  },
}))

vi.mock("../../../tauri/pack-fs", () => ({
  packFs: {
    readAssetBytes: vi.fn(async () => new ArrayBuffer(3)),
  },
}))

import { createResolveAsset } from "../resolve-asset"
import { packFs } from "../../../tauri/pack-fs"

describe("createResolveAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(packFs.readAssetBytes).mockResolvedValue(new ArrayBuffer(3))
    // node 环境没有 object URL API，替身掉；否则成功路径根本走不到 TextureLoader。
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:fake"),
      writable: true,
    })
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true })
  })

  it("按 (rootDir, rel) 读字节并返回纹理", async () => {
    const resolve = createResolveAsset({ rootDir: "/tmp/p", onMissing: vi.fn() })
    const texture = await resolve("assets/a.png")
    expect(packFs.readAssetBytes).toHaveBeenCalledWith("/tmp/p", "assets/a.png")
    expect(texture).toEqual({ isTexture: true })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake")
  })

  it("读取失败时上报路径并抛出（由渲染器的纹理缓存兜住）", async () => {
    vi.mocked(packFs.readAssetBytes).mockRejectedValueOnce(new Error("ENOENT"))
    const onMissing = vi.fn()
    const resolve = createResolveAsset({ rootDir: "/tmp/p", onMissing })

    await expect(resolve("assets/missing.png")).rejects.toThrow("ENOENT")
    expect(onMissing).toHaveBeenCalledWith("assets/missing.png")
  })

  it("加载失败（解码失败）时同样上报", async () => {
    loadMock.mockImplementationOnce(
      (_url: string, _onLoad: unknown, _onProgress: unknown, onError: (e: unknown) => void) => {
        onError(new Error("decode error"))
      },
    )
    const onMissing = vi.fn()
    const resolve = createResolveAsset({ rootDir: "/tmp/p", onMissing })

    await expect(resolve("assets/bad.png")).rejects.toThrow("decode error")
    expect(onMissing).toHaveBeenCalledWith("assets/bad.png")
  })
})
