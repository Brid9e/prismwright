/**
 * 吸管取色的坐标换算钉桩。
 *
 * 这里最容易错的是两处「翻不翻」：纹理 v 轴向上、像素行向下；以及底图的填充 / 偏移 /
 * 缩放 / 旋转要先过 `frontUvTransform` 才能得到真正的采样 UV。任一处算反，吸到的都是
 * 画面另一侧的颜色——看起来「能用」，却总取错。
 */
import { describe, it, expect } from "vitest"
import { CARD_ASPECT } from "@cardbara/renderer/v1"
import type { ColorStop } from "@cardbara/schema"
import {
  applyPickedStopColor,
  faceRefMatches,
  frontPixelCoord,
  imagePixelCoord,
  pickClickAction,
  rgbToHex,
} from "../pickColor"

describe("imagePixelCoord", () => {
  it("中心 UV 落在图片中心像素", () => {
    expect(imagePixelCoord(0.5, 0.5, 100, 200)).toEqual({ x: 50, y: 100 })
  })

  it("纹理 v 轴向上、像素行向下：v=0 是图片底边", () => {
    expect(imagePixelCoord(0.5, 0, 100, 200)).toEqual({ x: 50, y: 199 })
    expect(imagePixelCoord(0.5, 1, 100, 200)).toEqual({ x: 50, y: 0 })
  })

  it("越界 UV 返回 null（点在卡面底色上，没有原图可吸）", () => {
    expect(imagePixelCoord(-0.01, 0.5, 100, 100)).toBeNull()
    expect(imagePixelCoord(1.01, 0.5, 100, 100)).toBeNull()
    expect(imagePixelCoord(0.5, Number.NaN, 100, 100)).toBeNull()
  })

  it("尺寸为零时返回 null（图片尚未解码完）", () => {
    expect(imagePixelCoord(0.5, 0.5, 0, 100)).toBeNull()
  })
})

describe("frontPixelCoord", () => {
  const identity = { fit: "stretch" as const, offsetX: 0, offsetY: 0, scale: 1, rotation: 0 }

  it("卡面比例与图片比例一致、拉伸填充时，UV 一一对应", () => {
    // 图片比例取卡面比例，stretch 下正好铺满，卡面 UV 即图片 UV。
    const coord = frontPixelCoord(0.5, 0.5, { width: 250, height: 350 }, identity)
    expect(coord).toEqual({ x: 125, y: 175 })
  })

  it("偏移与缩放会改变采样点（点到的位置跟着画面走）", () => {
    const base = frontPixelCoord(0.5, 0.5, { width: 250, height: 350 }, identity)
    // 图片右移 0.1 卡高 → 卡面中心采样到图片更靠左的位置。
    const moved = frontPixelCoord(
      0.5,
      0.5,
      { width: 250, height: 350 },
      { ...identity, offsetX: 0.1 },
    )
    expect(moved!.x).toBeLessThan(base!.x)
  })

  it("图片比例大于卡面比例时，cover 会裁掉左右，卡面中心仍在图片中心", () => {
    const coord = frontPixelCoord(
      0.5,
      0.5,
      { width: 700, height: 350 },
      { ...identity, fit: "cover" },
    )
    expect(coord!.x).toBe(350)
    expect(coord!.y).toBe(175)
  })

  it("卡面宽高比可调：方图 cover 到方卡时不裁切，到 5:7 卡上会裁掉左右", () => {
    const square = { width: 350, height: 350 }
    const cover = { ...identity, fit: "cover" as const }
    // 方卡：方图正好铺满，左缘就是图片左缘。
    expect(frontPixelCoord(0, 0.5, square, cover, 1)).toEqual({ x: 0, y: 175 })
    // 5:7 卡：左右被裁，卡面左缘落在图片内部。
    const onNarrow = frontPixelCoord(0, 0.5, square, cover)
    expect(onNarrow!.x).toBeGreaterThan(0)
  })

  it("卡面尺寸按 CARD_ASPECT 兜底：图片是方图时 cover 撑满高度", () => {
    const coord = frontPixelCoord(0.5, 0.5, { width: 350, height: 350 }, { ...identity, fit: "cover" })
    expect(coord!.x).toBe(175)
    expect(coord!.y).toBe(175)
    // CARD_ASPECT 参与换算：方图 cover 到窄卡上会被裁掉上下（这里只验证换算没抛错）。
    expect(CARD_ASPECT).toBeLessThan(1)
  })
})

describe("faceRefMatches", () => {
  // 拾色请求记的是「写回哪个卡面」，而预览只显示一张。两边对不上时必须拒绝落点——
  // 否则在背面视图里点了正面某张卡的效果，吸到的是背面的颜色。
  it("正面请求与当前选中的卡一致时匹配", () => {
    expect(faceRefMatches({ kind: "card", cardId: "c1" }, "front", "c1")).toBe(true)
  })

  it("正面请求但预览在背面（或选中的是另一张卡）时不匹配", () => {
    expect(faceRefMatches({ kind: "card", cardId: "c1" }, "back", "c1")).toBe(false)
    expect(faceRefMatches({ kind: "card", cardId: "c1" }, "front", "c2")).toBe(false)
  })

  it("背面请求只在背面视图匹配", () => {
    expect(faceRefMatches({ kind: "back" }, "back", "c1")).toBe(true)
    expect(faceRefMatches({ kind: "back" }, "front", "c1")).toBe(false)
  })
})

describe("pickClickAction", () => {
  // 拾色层盖住整个预览，点击不处理就等于把卡片锁死。这里的规则钉住三条出口：
  // 取到色写回、点卡外取消、没有底图取消；其余情况允许再点一次。
  const base = { insideCard: true, hasFrontImage: true, color: "#ff0000" }

  it("落在卡内且采到颜色时写回", () => {
    expect(pickClickAction(base)).toBe("sample")
  })

  it("点卡外是取消——这是「十字光标关不掉」的主要出口", () => {
    expect(pickClickAction({ ...base, insideCard: false, color: null })).toBe("cancel")
  })

  it("卡外点击优先判取消，即使意外采到了颜色也不写回", () => {
    expect(pickClickAction({ ...base, insideCard: false })).toBe("cancel")
  })

  it("卡面没有底图时取消：永远吸不到色，留着十字光标只会锁住卡片", () => {
    expect(pickClickAction({ ...base, hasFrontImage: false, color: null })).toBe("cancel")
  })

  it("底图还在解码、或点在图片被裁掉的区域时忽略，允许再点", () => {
    expect(pickClickAction({ ...base, color: null })).toBe("ignore")
  })
})

describe("rgbToHex", () => {
  it("转成小写 #rrggbb，并补齐前导零", () => {
    expect(rgbToHex(255, 0, 8)).toBe("#ff0008")
    expect(rgbToHex(0, 0, 0)).toBe("#000000")
  })
})

describe("applyPickedStopColor（吸管写回色标）", () => {
  const stop = (color: string, at: number): ColorStop => ({ color, at })
  const list = [stop("#111111", 0), stop("#222222", 0.5), stop("#333333", 1)]

  it("只改目标色标的色值，位置与其它颜色不动", () => {
    const after = applyPickedStopColor(list, 1, "#ff0000")
    expect(after).toEqual([stop("#111111", 0), stop("#ff0000", 0.5), stop("#333333", 1)])
    expect(after).not.toBe(list)
    expect(after[1]).not.toBe(list[1])
  })

  it("保留该色标原有的透明度——吸色只取 RGB，不该把半透明色标变实", () => {
    const translucent = [stop("#111111", 0), stop("#22222280", 1)]
    expect(applyPickedStopColor(translucent, 1, "#00ff00")).toEqual([
      stop("#111111", 0),
      stop("#00ff0080", 1),
    ])
  })

  it("下标越界时返回原数组引用（效果在拾色期间被删掉）", () => {
    expect(applyPickedStopColor(list, 5, "#ff0000")).toBe(list)
    expect(applyPickedStopColor([], 0, "#ff0000")).toEqual([])
  })
})
