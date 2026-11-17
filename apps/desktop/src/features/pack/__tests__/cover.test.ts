/**
 * 封面比例与体积校验的纯逻辑测试。
 *
 * 系列封面分大 / 小两张，比例要求不同；校验只产出提示文案所需的素材，
 * 不碰文件系统也不弹窗。比例错一位就会在系列页被裁切，所以用测试钉死。
 */
import { describe, expect, it } from "vitest"
import { COVER_EXTENSIONS, coverAspectError, formatAspect, isCoverOversize } from "../cover"

describe("封面比例校验", () => {
  it("5:2 与 1:1 通过", () => {
    expect(coverAspectError("large", 2000, 800)).toBeNull()
    expect(coverAspectError("small", 1024, 1024)).toBeNull()
  })

  it("4:3 的大封面与 4:5 的小封面被拒绝，并带出实际尺寸与比例", () => {
    expect(coverAspectError("large", 1920, 1440)).toEqual({
      width: 1920,
      height: 1440,
      aspect: "4:3",
    })
    expect(coverAspectError("small", 1024, 1280)).toEqual({
      width: 1024,
      height: 1280,
      aspect: "4:5",
    })
  })

  it("容差内通过、容差外拒绝", () => {
    // 5:2 = 2.5；2001/800 = 2.50125，差 0.00125 → 通过
    expect(coverAspectError("large", 2001, 800)).toBeNull()
    // 2.5125 差 0.0125 → 拒绝
    expect(coverAspectError("large", 2010, 800)).not.toBeNull()
  })

  it("卡包图不限比例：整张铺到袋面，超出部分由皮肤裁掉", () => {
    expect(coverAspectError("pack", 580, 1000)).toBeNull()
    expect(coverAspectError("pack", 800, 1000)).toBeNull()
    expect(coverAspectError("pack", 1000, 300)).toBeNull()
    expect(coverAspectError("pack", 1, 1)).toBeNull()
  })

  it("非常见比例退化为两位小数", () => {
    expect(formatAspect(1870, 1000)).toBe("1.87:1")
    expect(formatAspect(2000, 800)).toBe("5:2")
  })
})

describe("封面上限提示", () => {
  it("长边超 4096 或文件超 5MB 才算超大", () => {
    expect(isCoverOversize(4096, 3072, 1024)).toBe(false)
    expect(isCoverOversize(4097, 3072, 1024)).toBe(true)
    expect(isCoverOversize(1000, 1000, 5 * 1024 * 1024)).toBe(false)
    expect(isCoverOversize(1000, 1000, 5 * 1024 * 1024 + 1)).toBe(true)
  })

  it("扩展名白名单不含 webm", () => {
    expect(COVER_EXTENSIONS).toEqual(["png", "jpg", "jpeg", "webp", "gif"])
  })
})
