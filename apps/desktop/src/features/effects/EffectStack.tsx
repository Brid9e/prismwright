/**
 * 效果栈面板：把目标的 `effects` 列表按角色分组渲染，逐条给出开关、调序、参数编辑与删除。
 *
 * 设计出发点——**注册表驱动**：字段控件不逐效果手写，而是读 `EFFECT_REGISTRY[kind].fields`
 * 自动生成。于是加一种效果时，面板这一侧一行不用改；面板只负责「把描述摊成控件」。
 * 旧面板（LayerDetail）里每种效果各写一大段 JSX 的做法由此收敛掉。
 *
 * 组件是**受控的展示组件**：不碰 store，一切经 `onAdd` / `onRemove` / `onToggle` / `onMove` /
 * `onUpdate` 上抛给调用方（卡面或图层面板）。唯一的本地状态是「哪几条展开着参数」——纯视图
 * 状态，不该进撤销栈，也不必让 store 知道。
 *
 * 分组与槽位这类可算的东西都挪到 `effectOps`（纯函数、有单测）；本文件只留渲染。
 */
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ImagePlus,
  Paintbrush,
  Plus,
  Trash2,
} from "lucide-react"
import type {
  ColorStop,
  Effect,
  EffectKind,
  EffectParams,
  EffectRole,
  MaskPresetParams,
} from "@prismwright/schema"
import { EFFECT_REGISTRY, MASK_PRESETS } from "@prismwright/renderer/v1"
import type { FieldDescriptor } from "@prismwright/renderer/v1"
import { PropertyRow } from "../../ui/PropertyRow"
import { Slider } from "../../ui/Slider"
import { Select } from "../../ui/Select"
import { Switch } from "../../ui/Switch"
import { IconButton } from "../../ui/IconButton"
import { ColorStops } from "../../ui/ColorStops"
import { ColorField } from "../../ui/ColorField"
import {
  addableKinds,
  canAddKind,
  fieldsForScope,
  groupByRole,
  hasEnabledKind,
  maskSourcePatch,
  presetChangePatch,
} from "./effectOps"

export interface EffectStackProps {
  /** 本面板所编辑目标的类型，用于过滤「＋ 添加效果」菜单（见注册表的 `scope`）。 */
  scope: "layer" | "face"
  /** 待编辑的效果列表（按列表序；组内顺序即此顺序）。 */
  effects: readonly Effect[]
  onAdd: (kind: EffectKind) => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
  /** `toIndex` 是**全列表**下标（store 的 `moveEffect` 口径），见 {@link siblingTargetIndex}。 */
  onMove: (id: string, toIndex: number) => void
  onUpdate: (id: string, patch: Partial<EffectParams>) => void
  /** 图片字段（imageMask / image 共用）的「上传 / 替换」动作；父组件负责拉原生文件框并落盘。 */
  onPickImage: (id: string, fieldKey: string) => void
  /**
   * 绘画字段（maskErase 的 path）的画笔动作：父组件把「进入绘画态」记进 uiStore，
   * 由预览面板接管指针、画完再落盘写回 path。
   */
  onPaintErase: (id: string) => void
}

/**
 * 用运行时字段键构造一条参数补丁。
 *
 * `EffectParams` 是按 kind 判别的联合，而这里的键与值由注册表的字段描述在**运行时**给出——
 * TS 无法从一个字符串键推出它属于哪个成员，故用这一次定向 cast 收口（全组件仅此一处）。
 * 这么做是安全的：键、控件类型与取值域同出注册表一条描述，键与值的对应关系由它单点保证；
 * 这里只是让 TS 相信这层运行时契约，并非放宽类型。
 */
function fieldPatch(fieldKey: string, value: unknown): Partial<EffectParams> {
  return { [fieldKey]: value } as Partial<EffectParams>
}

/**
 * 相位组内上/下移：返回相邻同角色条目在**全列表**里的下标；无可移对象时返回 null。
 *
 * 为什么要算「全列表下标」而不是分组内下标：store 的 `moveEffect(id, toIndex)` 是先从列表里
 * 按 id 摘出、再插到钳制后的下标。传入上一条同角色条目的下标，摘出后正好插在它前面；传入下一条
 * 的下标则插在它后面——因此这里换算成全列表下标才对得上 store 的口径。
 *
 * 只在**同角色内**找相邻者：跨 kind 的先后由着色器的固定通路决定，组内同 kind 的顺序才是用户
 * 能调、也该调的东西。
 */
function siblingTargetIndex(effects: readonly Effect[], id: string, dir: -1 | 1): number | null {
  const self = effects.findIndex((e) => e.id === id)
  if (self < 0) return null
  const role = EFFECT_REGISTRY[effects[self].kind].role
  const sameRole = effects
    .map((e, idx) => ({ e, idx }))
    .filter((x) => EFFECT_REGISTRY[x.e.kind].role === role)
  const pos = sameRole.findIndex((x) => x.e.id === id)
  const target = sameRole[pos + dir]
  return target ? target.idx : null
}

/**
 * 一个效果条目的参数控件区——按注册表的字段描述逐项生成。
 *
 * 导出仅为 SSR 冒烟测试可直接喂一条效果（展开态是内部视图状态，测试点不开）；应用内只由
 * `EffectRow` 渲染。
 */
export function EffectFields({
  effect,
  scope,
  onUpdate,
  onPickImage,
  onPaintErase,
}: {
  effect: Effect
  /** 本面板所编辑目标的类型；字段级 `scope` 据此过滤（见 `fieldsForScope`）。 */
  scope: "layer" | "face"
  onUpdate: (id: string, patch: Partial<EffectParams>) => void
  onPickImage: (id: string, fieldKey: string) => void
  onPaintErase: (id: string) => void
}) {
  const { t } = useTranslation("effect")
  // 第二把 t：绑定 `layer` 命名空间。预设下拉的文案（`maskPreset.preset.*`）归 `layer`，
  // 与注册表其它文案不同源——用 `effect` 的 t 会把原始 key 画到界面上。
  const { t: tLayer } = useTranslation("layer")
  // 参数按 kind 是判别联合；字段键在运行时由注册表给出，TS 看不到「键 ↔ 值」的对应，故收成
  // Record 以按键取值。各 `*Params` 是具名接口（无字符串索引签名），不能直接断言成 `Record`，
  // 经一次 `unknown` 中转。键与值的类型一致性由注册表单点保证（见 registry 的字段描述）。
  const params = effect.params as unknown as Record<string, unknown>
  // 注册表的默认参数（按 kind 记忆）：滑块复位图标的目标值。schema 是默认值的唯一来源，
  // 不在这里另抄一份数字。
  const defaults = useMemo(
    () => EFFECT_REGISTRY[effect.kind].defaultParams() as unknown as Record<string, unknown>,
    [effect.kind],
  )
  // 先按目标类型筛掉不适用于该端的字段（如 moire 的卡面浮雕只对卡面有意义）。标注为
  // `FieldDescriptor[]`：注册表用 `as const`，字段对象被收窄成各自字面量类型的联合，可选属性
  // （precision / visibleWhen）在未写出的成员上「不存在」而非「undefined」，直接取用会报错；
  // 标注回统一描述类型后，可选属性恢复为可选。
  const fields: readonly FieldDescriptor[] = fieldsForScope(effect.kind, scope)

  return (
    <>
      {fields.map((field) => {
        // 条件字段（如渐变的「角度」只在平行模式出现）在条件不满足时整行不渲染。
        if (field.visibleWhen && !field.visibleWhen(params)) return null

        const label = t(field.labelKey)
        switch (field.type) {
          case "slider":
            return (
              <PropertyRow key={field.key} label={label} grow reserveControlSpace>
                <Slider
                  value={params[field.key] as number}
                  min={field.min!}
                  max={field.max!}
                  step={field.step}
                  precision={field.precision}
                  defaultValue={
                    typeof defaults[field.key] === "number"
                      ? (defaults[field.key] as number)
                      : undefined
                  }
                  resetLabel={t("reset")}
                  onChange={(v) => onUpdate(effect.id, fieldPatch(field.key, v))}
                />
              </PropertyRow>
            )
          case "select":
            return (
              <PropertyRow key={field.key} label={label}>
                <Select
                  value={String(params[field.key])}
                  options={(field.options ?? []).map((o) => ({
                    value: o.value,
                    label: t(o.labelKey),
                  }))}
                  onChange={(v) => {
                    // 切到颜色源时补一条合适的阈值带宽（见 maskSourcePatch）：沿用图片源的
                    // 0 / 1 会让颜色蒙版恒为全权重，用户会以为「点了没反应」。
                    const extra = field.key === "source" ? maskSourcePatch(v, params) : null
                    onUpdate(effect.id, { ...fieldPatch(field.key, v), ...extra })
                  }}
                />
              </PropertyRow>
            )
          case "switch":
            return (
              <PropertyRow key={field.key} label={label}>
                <Switch
                  checked={Boolean(params[field.key])}
                  onChange={(c) => onUpdate(effect.id, fieldPatch(field.key, c))}
                  ariaLabel={label}
                />
              </PropertyRow>
            )
          case "image": {
            // 图片字段（imageMask / image 共用的 path）：只读回显「文件名」（无值显示未设置），
            // 配上传 / 替换按钮；已有路径时再给一个清除按钮。真实文件选择由父组件经 onPickImage
            // 拉起原生对话框，落盘目标由效果的 kind 决定。
            const path = String(params[field.key] ?? "")
            const fileName = path ? (path.split("/").pop() ?? path) : ""
            // 不 grow：控件区按内容宽右对齐（`ml-auto`），文件名与图标贴齐面板右缘——与卡面图的
            // 同一字段一致；若 grow 则控件区撑满、内容贴左，上传按钮会浮在中间。
            return (
              <PropertyRow key={field.key} label={label}>
                <span className="min-w-0 max-w-[16ch] truncate text-label text-muted" title={path}>
                  {fileName || t("imageMask.notSet")}
                </span>
                <IconButton
                  icon={ImagePlus}
                  label={path ? t("imageMask.replace") : t("imageMask.upload")}
                  onClick={() => onPickImage(effect.id, field.key)}
                />
                {path && (
                  <IconButton
                    icon={Trash2}
                    label={t("imageMask.remove")}
                    onClick={() => onUpdate(effect.id, fieldPatch(field.key, ""))}
                  />
                )}
              </PropertyRow>
            )
          }
          case "color": {
            // 单色字段（imageMask / 光泽的颜色）：色块 + hex，点开面板内取色器（见 ColorField）。
            // 缺参时的回退取自注册表默认值——不在此另写 hex 字面量（硬编码色值由 lint 兜住）。
            const current = String(params[field.key] ?? defaults[field.key] ?? "")
            return (
              <PropertyRow key={field.key} label={label}>
                <ColorField
                  value={current}
                  onChange={(hex) => onUpdate(effect.id, fieldPatch(field.key, hex))}
                  ariaLabel={label}
                />
              </PropertyRow>
            )
          }
          case "paint": {
            // 绘画字段（maskErase 的 path）：画面由用户在预览里画出来，故这里不给文件框，
            // 只给「画笔」入口 + 状态回显；已画过时再给一个清除（把 path 清空 = 不擦除）。
            const painted = String(params[field.key] ?? "") !== ""
            return (
              <PropertyRow key={field.key} label={label}>
                <span className="min-w-0 max-w-[16ch] truncate text-label text-muted">
                  {painted ? t("maskErase.painted") : t("maskErase.notPainted")}
                </span>
                <IconButton
                  icon={Paintbrush}
                  label={painted ? t("maskErase.continue") : t("maskErase.start")}
                  onClick={() => onPaintErase(effect.id)}
                />
                {painted && (
                  <IconButton
                    icon={Trash2}
                    label={t("maskErase.clear")}
                    onClick={() => onUpdate(effect.id, fieldPatch(field.key, ""))}
                  />
                )}
              </PropertyRow>
            )
          }
          case "colorStops": {
            // 色标字段（palette）：复用 ui/ColorStops。key={effect.id} 保证切换条目时内部选中态重置。
            return (
              <PropertyRow key={field.key} label={label} grow>
                <div className="min-w-0 flex-1">
                  <ColorStops
                    key={effect.id}
                    colors={params[field.key] as ColorStop[]}
                    onChange={(colors) => onUpdate(effect.id, fieldPatch(field.key, colors))}
                  />
                </div>
              </PropertyRow>
            )
          }
          case "preset": {
            // 预设字段的候选项来自 `MASK_PRESETS`（非 field.options），文案走 `layer`。
            // 选中即物化整组形状参数（详见 `presetChangePatch`）——只写 `id` 会「换了档位画面不动」。
            return (
              <PropertyRow key={field.key} label={label}>
                <Select
                  value={String(params[field.key])}
                  options={MASK_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: tLayer(preset.labelKey),
                  }))}
                  onChange={(v) => {
                    const patch = presetChangePatch(v, {
                      arrangement: params.arrangement as MaskPresetParams["arrangement"],
                    })
                    if (patch) onUpdate(effect.id, patch)
                  }}
                />
              </PropertyRow>
            )
          }
        }
      })}
    </>
  )
}

/** 「＋ 添加效果」下拉：列出该分组下可加的 kind；达槽位上限的置灰并标注原因。 */
function AddEffectMenu({
  kinds,
  effects,
  onAdd,
}: {
  /** 该分组 + 该目标类型下可加的 kind（由调用方经 `addableKinds` 算好）。 */
  kinds: readonly EffectKind[]
  effects: readonly Effect[]
  onAdd: (kind: EffectKind) => void
}) {
  const { t } = useTranslation("effect")
  // 调用方只在有候选时渲染本菜单；这里防御空数组，免得出现一个空下拉。
  if (kinds.length === 0) return null

  return (
    <DropdownMenu.Root>
      {/* 触发按钮占满一整行、底色取面板之上更亮的一档（`elevated`），作分组末尾的收尾动作。
          横向内边距只由这层容器给（`px-2`），与分组标题对齐；`w-full` 显式铺满——`<button>`
          默认按内容收缩，光靠 `flex` 在 WebView 里未必撑开。 */}
      <div className="px-2 pb-1 pt-0.5">
        <DropdownMenu.Trigger className="flex h-6 w-full items-center justify-center gap-1 rounded-control bg-elevated px-1.5 text-body text-muted outline-none hover:text-foreground focus:ring-1 focus:ring-ring data-[state=open]:text-foreground">
          <Plus size={13} />
          {t("add")}
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-control border border-line-soft bg-elevated py-1 shadow-lg"
        >
          {kinds.map((kind) => {
            const available = canAddKind(effects, kind)
            return (
              <DropdownMenu.Item
                key={kind}
                disabled={!available}
                onSelect={() => onAdd(kind)}
                className="flex cursor-default items-center gap-2 px-2 py-1 text-body text-foreground outline-none data-[highlighted]:bg-accent-soft data-[disabled]:text-disabled"
              >
                <span className="truncate">{t(EFFECT_REGISTRY[kind].labelKey)}</span>
                {/* 满槽位时在右侧标注原因，避免「点了没反应」的困惑。 */}
                {!available && (
                  <span className="ml-auto text-num text-disabled">{t("role.full")}</span>
                )}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** 单条效果：开关 +（相位组）调序 + 名称 + 展开 + 删除；展开时铺开参数控件。 */
function EffectRow({
  effect,
  role,
  scope,
  expanded,
  overridden,
  onToggleExpand,
  onToggle,
  onRemove,
  onUpdate,
  onMove,
  onPickImage,
  onPaintErase,
  moveUpIndex,
  moveDownIndex,
}: {
  effect: Effect
  /** 条目所属角色；仅相位组显示调序按钮。 */
  role: EffectRole
  /** 目标类型；透传给参数区做字段级过滤（见 `EffectFields`）。 */
  scope: "layer" | "face"
  expanded: boolean
  /** 本条被同目标的程序化蒙版覆盖（仅 imageMask 可能为 true）；展开区顶部显示提示。 */
  overridden?: boolean
  onToggleExpand: (id: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<EffectParams>) => void
  onMove: (id: string, toIndex: number) => void
  onPickImage: (id: string, fieldKey: string) => void
  onPaintErase: (id: string) => void
  /** 上移目标（全列表下标）；null = 组内已是首条，按钮置灰。 */
  moveUpIndex: number | null
  /** 下移目标（全列表下标）；null = 组内已是末条。 */
  moveDownIndex: number | null
}) {
  const { t } = useTranslation("effect")
  const name = t(EFFECT_REGISTRY[effect.kind].labelKey)

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-1 px-2 py-1">
        <Switch checked={effect.enabled} onChange={() => onToggle(effect.id)} ariaLabel={name} />

        {/* 调序只对相位组开放——其它两组在着色器里是无序通路，顺序不影响画面。 */}
        {role === "phase" && (
          <>
            <IconButton
              icon={ChevronUp}
              label={t("moveUp")}
              disabled={moveUpIndex === null}
              onClick={() => {
                if (moveUpIndex !== null) onMove(effect.id, moveUpIndex)
              }}
            />
            <IconButton
              icon={ChevronDown}
              label={t("moveDown")}
              disabled={moveDownIndex === null}
              onClick={() => {
                if (moveDownIndex !== null) onMove(effect.id, moveDownIndex)
              }}
            />
          </>
        )}

        <span className="min-w-0 flex-1 truncate text-body text-foreground" title={name}>
          {name}
        </span>

        <button
          type="button"
          onClick={() => onToggleExpand(effect.id)}
          aria-label={name}
          aria-expanded={expanded}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-muted hover:bg-elevated hover:text-foreground"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <IconButton icon={Trash2} label={t("remove")} onClick={() => onRemove(effect.id)} />
      </div>

      {/* 被覆盖提示：置于展开区之上，无论是否展开都能看到（用户需要先知道它当前不生效）。 */}
      {overridden && (
        <div className="px-2 pb-1 text-num text-warning">{t("imageMask.overridden")}</div>
      )}
      {expanded && (
        <EffectFields
          effect={effect}
          scope={scope}
          onUpdate={onUpdate}
          onPickImage={onPickImage}
          onPaintErase={onPaintErase}
        />
      )}
    </div>
  )
}

export function EffectStack({
  scope,
  effects,
  onAdd,
  onRemove,
  onToggle,
  onMove,
  onUpdate,
  onPickImage,
  onPaintErase,
}: EffectStackProps) {
  const { t } = useTranslation("effect")
  // 展开态是纯视图状态，不进 store——它不该进撤销栈，重渲染也不该被撤销历史牵动。
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // 同目标启用了程序化蒙版时，图蒙版按着色器的二选一被忽略——据此给图蒙版行加覆盖提示。
  const imageMaskOverridden = hasEnabledKind(effects, "maskPreset")

  return (
    <div className="py-1">
      <div className="select-none px-2 py-1 text-num font-medium uppercase tracking-wide text-disabled">
        {t("title")}
      </div>

      {groupByRole(effects).map(({ role, effects: group }) => {
        // 该分组在当前目标上可加的 kind：既决定「＋ 添加效果」的候选，也决定空组是否值得
        // 渲染。图片只在图层上存在，卡面的 content 组既无条目也无入口——隐藏它，别留一个
        // 只有标题的空区块。
        const kinds = addableKinds(role, scope)
        if (group.length === 0 && kinds.length === 0) return null

        return (
          <div key={role} className="border-b border-line last:border-b-0">
            <div className="select-none px-2 py-1 text-num font-medium uppercase tracking-wide text-muted">
              {t(`role.${role}`)}
            </div>

            {group.map((effect) => (
              <EffectRow
                key={effect.id}
                effect={effect}
                role={role}
                scope={scope}
                expanded={expanded.has(effect.id)}
                overridden={effect.kind === "imageMask" && imageMaskOverridden}
                onToggleExpand={toggleExpanded}
                onToggle={onToggle}
                onRemove={onRemove}
                onUpdate={onUpdate}
                onMove={onMove}
                onPickImage={onPickImage}
                onPaintErase={onPaintErase}
                moveUpIndex={role === "phase" ? siblingTargetIndex(effects, effect.id, -1) : null}
                moveDownIndex={role === "phase" ? siblingTargetIndex(effects, effect.id, 1) : null}
              />
            ))}

            <AddEffectMenu kinds={kinds} effects={effects} onAdd={onAdd} />
          </div>
        )
      })}
    </div>
  )
}
