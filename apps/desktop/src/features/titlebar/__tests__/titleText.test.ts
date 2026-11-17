/**
 * 标题栏中间文字拼接的行为测试。
 */
import { describe, it, expect } from "vitest"
import { titlebarText } from "../titleText"

describe("titlebarText", () => {
  it("有系列但没选中卡时只显系列名", () => {
    expect(titlebarText({ cardName: null, packName: "我的系列" })).toBe("我的系列")
  })

  it("卡名与系列名之间用长破折号相接", () => {
    expect(titlebarText({ cardName: "火球术", packName: "我的系列" })).toBe("火球术 — 我的系列")
  })
})
