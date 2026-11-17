/**
 * 效果栈面板的纯逻辑（分组、槽位可用性、覆盖判定）——与 React 解耦，便于单测。
 *
 * 面板本身只做「把注册表摊成控件」一件事，凡是能算的都挪到这里：这样分组顺序、槽位上限
 * 这些契约不再散在 JSX 里——改一处、测一处，组件只剩渲染。
 */
import type {
  Effect,
  EffectKind,
  EffectParams,
  EffectRole,
  MaskPresetParams,
} from "@cardbara/schema"
import {
  EFFECT_KINDS,
  EFFECT_REGISTRY,
  MASK_PRESETS,
  materializePreset,
} from "@cardbara/renderer/v1"
import type { FieldDescriptor } from "@cardbara/renderer/v1"
import type { AssetTarget } from "../../store/packStore"

/** 一个角色分组下的条目。 */
export interface RoleGroup {
  role: EffectRole
  effects: Effect[]
}

/**
 * 角色展示序：内容 → 相位 → 颜色 → alpha。
 *
 * 「内容」（图片贴片）不属于相机 / 相位 / 颜色 / 蒙版三段通路，单列一组并排在最上方——
 * 它描述「这一层画什么」，其余三组描述「全息怎么长」。
 *
 * 注意这是**展示契约**、不是类型契约：漏写一个角色不会编译报错（`EffectRole` 联合仍合法），
 * 只会让该角色的条目静默从面板消失、或分组次序错位。故由 `groupByRole` 的单测钉住顺序。
 */
export const ROLE_ORDER: readonly EffectRole[] = ["content", "phase", "color", "alpha"]

/**
 * 按角色分组，组内保持列表序。
 *
 * 两点刻意的设计：
 * - **空组也返回**：面板在每个分组末尾都挂一个「＋ 添加效果」入口，空组正是该入口的落点；
 *   若把空组滤掉，某个角色一旦为空，用户就没地方再加那种效果了。
 * - **组内保序**：`filter` 不改动相对次序，于是相位组里的条目顺序＝底层列表顺序，与
 *   面板的上/下移、以及 store 的 `moveEffect` 完全对齐。
 *
 * 角色取自注册表（`EFFECT_REGISTRY[kind].role`）而非条目自身：它是 kind 的固有属性、
 * 不落盘，注册表是唯一来源（见 schema 的 `EffectRole` 注释）。
 */
export function groupByRole(effects: readonly Effect[]): RoleGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    effects: effects.filter((e) => EFFECT_REGISTRY[e.kind].role === role),
  }))
}

/**
 * 该 kind 在当前列表上是否还有空槽位。
 *
 * 上限一律读注册表的 `maxPerTarget`，不在此另抄一份：它必须与着色器的定长数组长度一致，
 * 抄一份就多一个会漂移的地方（注册表注释已声明二者的对应关系）。界面据此把已达上限的
 * 「添加」项置灰。
 */
export function canAddKind(effects: readonly Effect[], kind: EffectKind): boolean {
  const used = effects.filter((e) => e.kind === kind).length
  return used < EFFECT_REGISTRY[kind].maxPerTarget
}

/**
 * 某角色在该目标类型下可添加的 kind（顺序即注册表的 `EFFECT_KINDS` 序）。
 *
 * 「＋ 添加效果」的候选项与「空分组要不要渲染」共用这一份判定：某个角色在当前目标上
 * 一个 kind 都加不了（如图片只属于图层，卡面就没有 content 候选），空组连入口都没有，
 * 就不该在面板里留一个只有标题的区块。
 */
export function addableKinds(role: EffectRole, scope: "layer" | "face"): EffectKind[] {
  return EFFECT_KINDS.filter(
    (kind) =>
      EFFECT_REGISTRY[kind].role === role &&
      (EFFECT_REGISTRY[kind].scope === "both" || EFFECT_REGISTRY[kind].scope === scope),
  )
}

/**
 * 图片字段上传的落盘目标：由效果的 kind 与字段决定。
 *
 * 图片控件是共享的（`imageMask` 与 `image` 都用它），但落盘目标不同：蒙版写 `maskEffect`、
 * 图片贴片写 `imageEffect`。同一个 `image` 效果里还有第二个图片字段（`normalPath` 法线贴图），
 * 它写 `normalEffect`——写死成一种时，另一种会静默写错位置（画面不动、也不报错）。
 * 条目不存在或不是带图片字段的 kind 时返回 `null`（调用方据此不拉起文件框）。
 *
 * @param fieldKey - 触发控件的是哪个参数键；缺省 `"path"`（主图）。
 */
export function imageTargetForEffect(
  effect: Pick<Effect, "id" | "kind"> | undefined,
  layerId: string,
  fieldKey: string = "path",
): AssetTarget | null {
  if (!effect) return null
  if (effect.kind === "image") {
    return fieldKey === "normalPath"
      ? { kind: "normalEffect", layerId, effectId: effect.id }
      : { kind: "imageEffect", layerId, effectId: effect.id }
  }
  if (effect.kind === "imageMask") return { kind: "maskEffect", layerId, effectId: effect.id }
  return null
}

/**
 * 取该 kind 在当前目标类型下**可显示**的参数字段。
 *
 * 效果自身的 `scope` 决定它能不能挂上来（见「＋ 添加效果」的过滤）；字段级的 `scope` 再细一层：
 * 某些参数只对某一端有意义（如 moire 的 `faceStrength` 只作用于卡面片元、挂到图层是死参数）。
 * 未标注 `scope`（或标 `both`）的字段两端都显示——绝大多数字段如此，故默认即「不筛」。
 */
export function fieldsForScope(
  kind: EffectKind,
  scope: "layer" | "face",
): readonly FieldDescriptor[] {
  // 标注回统一描述类型：注册表用 `as const`，字段被收窄成各自字面量类型的联合，未写出的可选
  // 属性（含 `scope`）在那些成员上「不存在」而非「undefined」，直接取用会报错（同 EffectStack）。
  const fields: readonly FieldDescriptor[] = EFFECT_REGISTRY[kind].fields
  return fields.filter((f) => f.scope === undefined || f.scope === "both" || f.scope === scope)
}

/**
 * 同目标里是否存在**启用中**的指定 kind。
 *
 * 用于 `imageMask` 的覆盖提示：目标上同时启用了程序化蒙版时，图蒙版按既有规则被忽略
 * （见着色器的二选一）。纯展示判定，不进 store。
 */
export function hasEnabledKind(effects: readonly Effect[], kind: EffectKind): boolean {
  return effects.some((e) => e.kind === kind && e.enabled)
}

/**
 * 「选中某个蒙版预设」应下发的参数补丁；预设 id 未知时返回 `null`（调用方据此跳过，不留空撤销步）。
 *
 * 选中预设**不是**写一个 `id` 了事：蒙版形状由 sides / spike / irregular / … 一整组参数决定，
 * 而 `id` 根本不进 uniform（见注册表 `maskPreset.packUniforms`）。故用 `materializePreset` 把预设
 * 物化成整组参数，让每次切档都落到一组可预期的初值（位移归零、种子取默认，见其注释）。写漏这一步
 * 的表现是「换了档位画面不动」——`id` 变了、形状参数没变。
 *
 * 排布（规则 / 随机）与形状正交：预设管「摆什么形状」、排布管「怎么摆」，故把 `current` 里的现状
 * 带回物化，免得用户刚选的「规则」被切档重置成随机（即旧面板切预设时的做法）。
 */
/**
 * 切换蒙版来源时要一并下发的参数补丁；无需补丁时返回 `null`。
 *
 * 颜色源的阈值是「像素色与拾取色的距离」，与图片源的亮度阈值**不是同一个量纲**。沿用图片源
 * 的默认值 0 / 1 会让距离带覆盖整个 [0, 1]——权重处处为 1，即「切到颜色源后画面毫无变化」。
 * 故切过去时给一条常用的颜色带宽；用户已调过的阈值不覆盖（那是他自己的参数，不是初值）。
 */
export function maskSourcePatch(
  source: string,
  params: Record<string, unknown>,
): Partial<EffectParams> | null {
  if (source !== "color") return null
  if (params.edge0 !== 0 || params.edge1 !== 1) return null
  // 0.05–0.25：拾取色附近基本全保留，明显不同的颜色被裁掉，中间平滑过渡。
  return { edge0: 0.05, edge1: 0.25 } as Partial<EffectParams>
}

export function presetChangePatch(
  presetId: string,
  current: Pick<MaskPresetParams, "arrangement">,
): Partial<MaskPresetParams> | null {
  const preset = MASK_PRESETS.find((p) => p.id === presetId)
  if (!preset) return null
  // 物化结果已是完整且 `id` 非空的一份参数（见 `materializePreset`），直接作为补丁下发。
  return materializePreset(preset, { arrangement: current.arrangement })
}

