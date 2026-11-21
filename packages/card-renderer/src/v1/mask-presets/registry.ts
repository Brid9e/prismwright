/**
 * 内置程序化蒙版预设注册表。
 *
 * 预设 = 一组形状默认参数。**只定义形状档位**（sides / spike / irregular / density / size /
 * sizeJitter / softness），不含 id 之外的位移、种子与整场变换（保持 / 翻转 / 旋转）——那几项由
 * 图层持有，故选中预设时物化成完整值，且一律回到默认（摆正、不翻不转）。
 *
 * 扩充方式：往 {@link MASK_PRESETS} 加一条、i18n 各加一条 `maskPreset.preset.<id>`；
 * **无需改着色器**（所有预设共用同一 `shardField`）。
 */
import { MaskPresetParamsSchema, type MaskPresetParams } from "@prismwright/schema"

/** 一个内置预设：id + i18n 键 + 形状默认参数。字段只读——注册表是常量，避免被就地改写。 */
export interface MaskPreset {
  /** 稳定标识：落盘进 `maskPreset` 效果条目的 params.id 供跨会话引用，**一经发布不应改名**（改名＝旧系列认不出）。 */
  readonly id: string
  /** `layer` 命名空间下的 i18n 键，如 `maskPreset.preset.polygon`。 */
  readonly labelKey: string
  /** 形状档位；不含 id / 位移 / 种子（那三项由图层持有、物化时补）。 */
  readonly params: Pick<
    MaskPresetParams,
    "sides" | "spike" | "irregular" | "density" | "size" | "sizeJitter" | "softness"
  >
}

/**
 * 内置预设清单。
 *
 * 参数含义（口径见 schema 的 MaskPresetParamsSchema）：
 * - `polygon`：多边形——形状交给「边数」滑块（3 = 三角、4 = 四边、6 = 六边……），「不规则」滑块
 *   再把顶点半径打散（等边三角 → 随机三角，拉高即碎片感）。三角 / 四边 / 六边因此不再各占一档；
 * - `stars`：五角星（sides 5 + spike≈0.38）。尖角不是规则多边形，边数 / 不规则滑块对它只是
 *   改星芒数，故单列一档；
 * - `dots`：圆点（大边数 + spike 1 ≈ 圆）。
 *
 * 尺寸 / 密度的口径是「卡面等比坐标」（卡高 = 1），见 schema 的 MaskPresetParams。本表数值不必因
 * 这次口径修正而调：size 与格距 1 / density 同单位，二者的比值就是碎片占格子的比例，换成等比
 * 坐标后这个比值不变——变的只是碎片不再被横向压扁。
 */
export const MASK_PRESETS: readonly MaskPreset[] = [
  {
    // 默认档位照搬原「碎片」（四边形 + 该套密度 / 尺寸），故选中它仍是熟悉的画面；把「不规则」
    // 拉高就是从前那种碎片散开的观感。
    id: "polygon",
    labelKey: "maskPreset.preset.polygon",
    params: {
      sides: 4,
      spike: 1,
      irregular: 0,
      density: 14,
      size: 0.064,
      sizeJitter: 0.5,
      softness: 0.02,
    },
  },
  {
    id: "stars",
    labelKey: "maskPreset.preset.stars",
    params: {
      sides: 5,
      spike: 0.38,
      irregular: 0,
      density: 10,
      size: 0.1,
      sizeJitter: 0.4,
      softness: 0.02,
    },
  },
  {
    id: "dots",
    labelKey: "maskPreset.preset.dots",
    params: {
      sides: 32,
      spike: 1,
      irregular: 0,
      density: 20,
      size: 0.03,
      sizeJitter: 0.6,
      softness: 0.04,
    },
  },
]

/**
 * 把预设物化成一份完整的 {@link MaskPresetParams}：`{ ...默认, ...预设参数, ...keep }`。
 *
 * 以 `MaskPresetParamsSchema.parse({ id })` 取全套默认（位移归零、种子取默认），再叠上预设的
 * 形状档位——让每次「选中预设」都是可预期的初始观感，不继承上一次的位移或重掷结果。调用方
 * （见 desktop 的 `effectOps.presetChangePatch`）把物化结果作为 `updateEffect` 的参数补丁下发。
 *
 * `keep` 是给「换预设」这个动作留的口子：排布（规则 / 随机）**与形状正交**——预设管「摆什么
 * 形状」，排布管「怎么摆」——切预设时用户的排布选择该挺过去，而默认值会把这一项重置回
 * `random`。故调用方 `presetChangePatch` 把图层现有的排布传进来。类型收窄到只是排布，
 * 免得 `keep` 变成「什么都不重置」的后门，把预设的形状档位一起放行。
 */
export function materializePreset(
  preset: MaskPreset,
  keep?: Pick<MaskPresetParams, "arrangement">,
): MaskPresetParams {
  return { ...MaskPresetParamsSchema.parse({ id: preset.id }), ...preset.params, ...keep }
}
