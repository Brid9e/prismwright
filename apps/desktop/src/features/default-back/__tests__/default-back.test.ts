import { describe, expect, it, vi } from "vitest"
import { CardFaceSchema, createEmptyPack } from "@prismwright/schema"
import {
  createDefaultBackFace,
  isDefaultBackPack,
  loadDefaultBack,
  samePath,
  withDefaultBack,
} from "../default-back"

describe("createDefaultBackFace", () => {
  it("给出一个能通过 schema 校验的卡背", () => {
    expect(() => CardFaceSchema.parse(createDefaultBackFace())).not.toThrow()
  })

  it("不引用任何图片：默认卡背不依赖系列内的素材", () => {
    expect(createDefaultBackFace().front).toBe("")
  })

  it("自带一层底纹（调色板 + 渐变）与一层文字", () => {
    const face = createDefaultBackFace()
    expect(face.layers).toHaveLength(2)
    const [holo, text] = face.layers
    expect(holo.kind).toBe("normal")
    expect(holo.effects.map((e) => e.kind)).toEqual(["palette", "gradient"])
    expect(text.kind).toBe("text")
    expect(text.text?.content).toBe("PRISMWRIGHT")
  })

  it("两层都启用且正常叠加，文字压在全息之上", () => {
    const [holo, text] = createDefaultBackFace().layers
    expect(holo.enabled).toBe(true)
    expect(text.enabled).toBe(true)
    expect(text.blend).toBe("normal")
  })
})

describe("samePath", () => {
  it("忽略分隔符风格与收尾分隔符", () => {
    expect(samePath("C:\\Users\\me\\default-back", "C:/Users/me/default-back/")).toBe(true)
  })

  it("大小写不敏感（Windows 盘符与目录名不区分大小写）", () => {
    expect(samePath("C:\\Users\\Me\\Default-Back", "c:\\users\\me\\default-back")).toBe(true)
  })

  it("不同路径为 false", () => {
    expect(samePath("/a/b", "/a/c")).toBe(false)
  })

  it("任一侧为空为 false", () => {
    expect(samePath(null, "/a")).toBe(false)
    expect(samePath("/a", null)).toBe(false)
  })
})

describe("isDefaultBackPack", () => {
  it("当前系列就是默认卡背工程时为 true", () => {
    expect(isDefaultBackPack("/data/default-back", "/data/default-back")).toBe(true)
  })

  it("普通系列为 false", () => {
    expect(isDefaultBackPack("/packs/photos", "/data/default-back")).toBe(false)
  })

  it("默认卡背目录还没解析出来时为 false", () => {
    expect(isDefaultBackPack("/data/default-back", null)).toBe(false)
  })
})

describe("withDefaultBack", () => {
  const face = createDefaultBackFace()

  it("系列没有卡背时补上默认卡背", () => {
    const pack = createEmptyPack("系列")
    expect(withDefaultBack(pack, face).back).toBe(face)
  })

  it("系列自己的卡背优先，默认卡背不覆盖它", () => {
    const own = { ...createDefaultBackFace(), front: "assets/own.png" }
    const pack = { ...createEmptyPack("系列"), back: own }
    expect(withDefaultBack(pack, face).back).toBe(own)
  })

  it("没有默认卡背时原样返回", () => {
    const pack = createEmptyPack("系列")
    expect(withDefaultBack(pack, null)).toBe(pack)
  })

  it("不改原系列（发布副本与本地数据隔离）", () => {
    const pack = createEmptyPack("系列")
    withDefaultBack(pack, face)
    expect(pack.back).toBeNull()
  })
})

describe("loadDefaultBack", () => {
  const root = "/data/default-back"
  const deps = {
    defaultRoot: root,
    isPackDir: vi.fn(),
    readText: vi.fn(),
    join: vi.fn((...parts: string[]) => parts.join("/")),
  }

  it("目录还不是系列时返回 null（还没做过默认卡背）", async () => {
    deps.isPackDir.mockResolvedValue(false)
    await expect(loadDefaultBack(deps)).resolves.toBeNull()
    expect(deps.readText).not.toHaveBeenCalled()
  })

  it("读回 pack.json 里的卡背", async () => {
    const face = createDefaultBackFace()
    deps.isPackDir.mockResolvedValue(true)
    deps.readText.mockResolvedValue(JSON.stringify({ ...createEmptyPack("默认卡背"), back: face }))
    const loaded = await loadDefaultBack(deps)
    expect(loaded?.layers).toHaveLength(2)
  })

  it("工程存在但还没做卡背时返回 null", async () => {
    deps.isPackDir.mockResolvedValue(true)
    deps.readText.mockResolvedValue(JSON.stringify(createEmptyPack("默认卡背")))
    await expect(loadDefaultBack(deps)).resolves.toBeNull()
  })

  it("文件读不出来时静默返回 null，不拦住启动", async () => {
    deps.isPackDir.mockResolvedValue(true)
    deps.readText.mockRejectedValue(new Error("EACCES"))
    await expect(loadDefaultBack(deps)).resolves.toBeNull()
  })
})
