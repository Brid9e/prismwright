/**
 * 文字字体下拉的清单。
 *
 * 只列「系统可能装了」的族名，不打包字体文件（见 spec §2.2 / §5.2）：小程序只能拿到设备
 * 上真实存在的字体，桌面字体在手机上多半会回退，故三个通用族置顶并作为默认。
 *
 * 标签是专有名词，中英文共用同一份清单（不挂 i18n）——把「微软雅黑」翻译成别的名字只会
 * 让人认不出来。`value` 直接写进 `TextParams.fontFamily`（CSS font-family 语义）。
 */
export interface TextFontOption {
  value: string
  label: string
}

export const TEXT_FONTS: readonly TextFontOption[] = [
  { value: "sans-serif", label: "sans-serif" },
  { value: "serif", label: "serif" },
  { value: "monospace", label: "monospace" },
  { value: "Microsoft YaHei", label: "微软雅黑 / Microsoft YaHei" },
  { value: "PingFang SC", label: "苹方 / PingFang SC" },
  { value: "Noto Sans CJK SC", label: "思源黑体 / Noto Sans CJK SC" },
  { value: "SimHei", label: "黑体 / SimHei" },
  { value: "SimSun", label: "宋体 / SimSun" },
  { value: "NSimSun", label: "新宋体 / NSimSun" },
  { value: "KaiTi", label: "楷体 / KaiTi" },
  { value: "FangSong", label: "仿宋 / FangSong" },
  { value: "DengXian", label: "等线 / DengXian" },
  { value: "LiSu", label: "隶书 / LiSu" },
  { value: "YouYuan", label: "幼圆 / YouYuan" },
  { value: "Arial", label: "Arial" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Georgia", label: "Georgia" },
  { value: "Verdana", label: "Verdana" },
  { value: "Courier New", label: "Courier New" },
]

/**
 * 下拉选项：当前值不在清单里（用户手填的族名）时把它作为额外项插在最前。
 *
 * @param current - 当前 `fontFamily`。
 */
export function textFontOptions(current: string): TextFontOption[] {
  const value = current.trim()
  if (value === "" || TEXT_FONTS.some((font) => font.value === value)) return [...TEXT_FONTS]
  return [{ value, label: value }, ...TEXT_FONTS]
}
