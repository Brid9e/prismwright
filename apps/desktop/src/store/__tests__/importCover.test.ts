/**
 * 系列封面导入的行为测试。
 *
 * 重点：落盘的是降采样后的字节、比例校验失败时整体不落盘、以及换图后可撤销回旧路径。
 * 像素测量 (`measureCover`) 与降采样 (`prepareCoverImage`) 都依赖浏览器
 * `createImageBitmap`，这里整体 mock 掉，只钉住 store 这一层的分支、落盘与状态迁移。
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../tauri/pack-fs", () => ({
  packFs: {
    ensureDir: vi.fn(async () => {}),
    writeTextAtomic: vi.fn(async () => {}),
    writeBytesAtomic: vi.fn(async () => {}),
    readText: vi.fn(async () => ""),
    readFileBytes: vi.fn(async () => new ArrayBuffer(0)),
    copyAsset: vi.fn(async () => ""),
    moveToTrash: vi.fn(async () => "token"),
    restoreFromTrash: vi.fn(async () => {}),
    purgeTrash: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
    isPackDir: vi.fn(async () => true),
    pickDirectory: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    readAssetBytes: vi.fn(async () => new ArrayBuffer(0)),
  },
}))

vi.mock("../../features/pack/cover-measure", () => ({
  measureCover: vi.fn(),
}))

vi.mock("../../features/pack/cover-image", () => ({
  // 默认原样放行；需要验证压缩结果的用例自己改返回值。
  prepareCoverImage: vi.fn(async (bytes: Uint8Array, ext: string) => ({ ext, bytes })),
}))

import { usePackStore } from "../packStore"
import { packFs } from "../../tauri/pack-fs"
import { measureCover } from "../../features/pack/cover-measure"
import { prepareCoverImage } from "../../features/pack/cover-image"

const measureMock = vi.mocked(measureCover)
const prepareMock = vi.mocked(prepareCoverImage)

function reset() {
  usePackStore.setState(usePackStore.getInitialState(), true)
}

async function setup() {
  await usePackStore.getState().newPack("P", "/tmp/p")
}

describe("packStore importCover", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reset()
  })

  it("5:2 大封面：字节写到 covers/<uuid>.<ext> 并写入 coverLarge", async () => {
    await setup()
    measureMock.mockResolvedValue({ width: 2000, height: 800 })

    const result = await usePackStore.getState().importCover("large", "C:/src/大封面.png")

    expect(result).toEqual({
      ok: true,
      rel: expect.stringMatching(/^covers\/[0-9a-f-]{36}\.png$/),
    })
    expect(packFs.writeBytesAtomic).toHaveBeenCalledOnce()
    expect(usePackStore.getState().pack!.coverLarge).toBe((result as { rel: string }).rel)
    expect(usePackStore.getState().pack!.coverSmall).toBe("")
  })

  it("落盘的是降采样后的字节，扩展名随输出格式走", async () => {
    await setup()
    measureMock.mockResolvedValue({ width: 1000, height: 1000 })
    vi.mocked(packFs.readFileBytes).mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer)
    prepareMock.mockResolvedValueOnce({ ext: "webp", bytes: new Uint8Array([9, 9]) })

    const result = await usePackStore.getState().importCover("small", "C:/src/x.jpeg")

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rel).toMatch(/^covers\/[0-9a-f-]{36}\.webp$/)
    expect(prepareMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "jpeg", "small")
    expect(packFs.writeBytesAtomic).toHaveBeenCalledWith(
      "/tmp/p",
      result.rel,
      new Uint8Array([9, 9]),
    )
  })

  it("比例不对时返回 aspect 且不落盘、不改数据", async () => {
    await setup()
    measureMock.mockResolvedValue({ width: 1920, height: 1440 })

    const result = await usePackStore.getState().importCover("large", "C:/src/x.png")

    expect(result).toMatchObject({
      ok: false,
      reason: "aspect",
      width: 1920,
      height: 1440,
      aspect: "4:3",
    })
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
    expect(usePackStore.getState().pack!.coverLarge).toBe("")
  })

  it("扩展名不在白名单（如 .webm）时拒绝", async () => {
    await setup()

    const result = await usePackStore.getState().importCover("small", "C:/src/x.webm")

    expect(result).toMatchObject({ ok: false, reason: "unsupported-format" })
    expect(packFs.readFileBytes).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("换图保留旧文件且可撤销回旧路径", async () => {
    await setup()
    measureMock.mockResolvedValue({ width: 1000, height: 1000 })

    const first = await usePackStore.getState().importCover("small", "C:/src/a.png")
    const second = await usePackStore.getState().importCover("small", "C:/src/b.png")
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    // 两次导入落到两个不同路径，旧文件不被覆盖（本阶段也不主动删除）。
    expect(first.rel).not.toBe(second.rel)
    expect(usePackStore.getState().pack!.coverSmall).toBe(second.rel)
    expect(packFs.moveToTrash).not.toHaveBeenCalled()

    usePackStore.getState().undo()
    expect(usePackStore.getState().pack!.coverSmall).toBe(first.rel)
  })

  it("没有打开系列时返回 no-pack", async () => {
    const result = await usePackStore.getState().importCover("large", "C:/src/x.png")
    expect(result).toEqual({ ok: false, reason: "no-pack" })
  })

  it("裁剪后的字节直接落盘：不再量尺寸、不再校验比例", async () => {
    await setup()
    const cropped = new Uint8Array([7, 7, 7])

    const result = await usePackStore.getState().importCoverBytes("large", cropped, "webp")

    expect(result).toEqual({ ok: true, rel: expect.stringMatching(/^covers\/[0-9a-f-]{36}\.webp$/) })
    if (!result.ok) return
    expect(packFs.writeBytesAtomic).toHaveBeenCalledWith("/tmp/p", result.rel, cropped)
    expect(usePackStore.getState().pack!.coverLarge).toBe(result.rel)
    expect(measureMock).not.toHaveBeenCalled()
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it("裁剪字节落盘后可撤销回旧路径", async () => {
    await setup()
    measureMock.mockResolvedValue({ width: 2000, height: 800 })
    const first = await usePackStore.getState().importCover("large", "C:/src/a.png")
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await usePackStore.getState().importCoverBytes("large", new Uint8Array([1]), "webp")
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(usePackStore.getState().pack!.coverLarge).toBe(second.rel)

    usePackStore.getState().undo()
    expect(usePackStore.getState().pack!.coverLarge).toBe(first.rel)
  })

  it("裁剪字节写盘失败时返回 copy-failed 且不改数据", async () => {
    await setup()
    vi.mocked(packFs.writeBytesAtomic).mockRejectedValueOnce(new Error("磁盘满"))

    const result = await usePackStore.getState().importCoverBytes("small", new Uint8Array([1]), "webp")

    expect(result).toMatchObject({ ok: false, reason: "copy-failed" })
    expect(usePackStore.getState().pack!.coverSmall).toBe("")
  })

  it("读取源文件失败时返回 copy-failed 且不落盘", async () => {
    await setup()
    vi.mocked(packFs.readFileBytes).mockRejectedValueOnce(new Error("文件被占用"))

    const result = await usePackStore.getState().importCover("large", "C:/src/x.png")

    expect(result).toMatchObject({ ok: false, reason: "copy-failed" })
    expect(measureMock).not.toHaveBeenCalled()
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })

  it("测量失败时返回 measure-failed 且不落盘", async () => {
    await setup()
    measureMock.mockRejectedValueOnce(new Error("无法解码"))

    const result = await usePackStore.getState().importCover("small", "C:/src/x.png")

    expect(result).toMatchObject({ ok: false, reason: "measure-failed" })
    expect(packFs.writeBytesAtomic).not.toHaveBeenCalled()
  })
})
