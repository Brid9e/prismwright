# 编辑器 UI 重置与控件系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已确认的 HTML 原型，把编辑器换成一套语义 token + 统一控件 + 新工作区布局（顶栏 / 卡片库 / 透明的舞台 / 分页签检查器），并支持三种布局模式。

**Architecture:** 先在 `styles/tokens.css` 与 `tailwind.config.ts` 建立语义刻度（颜色、高度、圆角、字级），再把 `src/ui` 的原始控件逐个改为只消费语义类；随后重排外壳（`TitleBar` → 顶栏、`Splitter` 三栏、`PreviewPanel` 舞台）与检查器（页签化）。渲染器、schema、store 的数据语义不动。

**Tech Stack:** React 19、Tailwind 3、Radix（Slider / Select / Switch / Tooltip / Dialog）、zustand、i18next、Tauri 2、vitest（node + SSR 冒烟）。

**Spec:** `docs/superpowers/specs/2026-11-28-editor-ui-control-system-design.md`

## Global Constraints

- 只改 `D:\Code\cardbara-editor`；`D:\Code\card-editor` 里的 monorepo 只用于小程序与云函数，本计划不碰。
- 不改 `@prismwright/renderer`、`@prismwright/schema` 的任何代码或数据格式。
- 界面禁止装饰性渐变；绿色 `--color-accent` 是唯一强调色；稀有度识别色除外。
- 尺寸只允许设计文档 §5 的刻度：间距 4/8/12/16/24；高度 24/28/32/40/46；圆角 4/7/10/14；字级 10/11/12/13/17。
- 组件里禁止 `rounded-[…]`、`h-[…]`、`gap-[…]`、`px-[…]`、`text-[…px]` 任意值；一律用 Tailwind 语义类或 token 变量。
- 所有新增中文文案同时补 `zh-CN` 与 `en` 两个 locale；键名按现有命名空间。
- 控件必须保留键盘可达与可访问名；Radix 行为不退化。
- 每个任务结束必须绿：`pnpm --filter @prismwright/desktop test`、`typecheck`、`build`。

## Review Focus

- 滑杆在极窄检查器（右栏 300px）下：标签、轨道、数字框、复位图标不能重叠或裁切。
- 1024×768 窗口 + 紧凑布局：顶栏不换行，卡片库只剩缩略图条时仍能选中卡片。
- 无 Tauri 环境（`dev:web`）：顶栏与窗口控件降级不能抛错。
- 主题切换：`github-dark` 覆盖新 token 后，滑轨、选中态、描边不能出现「一半新一半旧」。
- 画布交互层：舞台去掉背景容器后，绘画/拖拽命中区域不能因外层 padding 缩水。

---

### Task 1: 语义 token 与 Tailwind 刻度

**Files:**
- Modify: `apps/desktop/src/styles/tokens.css`
- Modify: `apps/desktop/src/styles/base.css`
- Modify: `apps/desktop/tailwind.config.ts`
- Modify: `apps/desktop/src/themes/builtin/github-dark.json`
- Test: `apps/desktop/src/styles/__tests__/tokens.test.ts`（新建）

**Interfaces:**
- Produces: 语义颜色 token（`--color-surface-app|panel|elevated|sunken`、`--color-track`、`--color-track-fill`、`--color-line`、`--color-line-soft`、`--color-accent-soft` 等，完整表见 spec §5.1）；Tailwind 类 `bg-panel` / `bg-track` / `text-muted` / `border-line` / `rounded-control` / `rounded-card` / `rounded-panel` / `rounded-chip` / `h-control` / `h-button` / `h-row` / `h-topbar` / `text-num` / `text-label` / `text-body` / `text-title`。

- [ ] **Step 1: 写失败测试**

新建 `src/styles/__tests__/tokens.test.ts`：读 `../../styles/tokens.css` 与 `../builtin/github-dark.json`，断言：

```ts
const REQUIRED = [
  "--color-surface-app", "--color-surface-panel", "--color-surface-elevated",
  "--color-surface-sunken", "--color-track", "--color-track-fill",
  "--color-line", "--color-line-soft", "--color-border",
  "--color-text", "--color-text-muted", "--color-text-disabled",
  "--color-accent", "--color-accent-hover", "--color-accent-active",
  "--color-accent-soft", "--color-text-on-accent",
  "--color-danger", "--color-warning", "--color-success", "--color-scrim",
  "--color-checker-a", "--color-checker-b",
]
```

断言 ① 每个 `REQUIRED` 都在 `tokens.css` 的 `:root` 里定义；② `github-dark.json` 的每个颜色键都能在 `tokens.css` 找到同名定义（主题只允许覆盖已知语义 token）；③ `tokens.css` 里不再出现 `--palette-accent-*` 蓝色强调色定义。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- tokens` → 预期 FAIL（`--color-track` 等未定义）。

- [ ] **Step 3: 重写 `tokens.css`**

按 spec §5.1 的值重写：保留 `--palette-*` 两层结构，但色板换成中性灰 + 绿色；语义 token 指向新色板；新增 `--color-track`、`--color-track-fill`、`--color-accent-soft`、`--color-line`、`--color-line-soft`。`--color-border` 保留并指向 `#2b2b2b`（兼容旧类），`--color-border-strong` 指向 `#0f0f0f`，`--color-border-subtle` 指向 `#232323`。

- [ ] **Step 4: 更新 `tailwind.config.ts`**

- `colors` 增加 `track`、`track-fill`、`line`、`line-soft`、`accent-soft`，`border` 增加 `line`/`line-soft` 别名。
- `borderRadius` 改为 `{ none: "0", chip: "4px", control: "7px", card: "10px", panel: "14px", full: "9999px" }`，删除 `sm/DEFAULT/md`。
- `height` 增加 `control: "24px"`、`button: "28px"`、`row: "32px"`、`topbar: "46px"`、`panelhead: "40px"`。
- `fontSize` 增加 `num: ["10px","12px"]`、`label: ["11px","16px"]`、`body: ["12px","16px"]`、`title: ["13px","16px"]`。
- `fontFamily.sans` 改为 `['"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "sans-serif"]`；`mono` 保持。

- [ ] **Step 5: 更新 `github-dark.json`**

把 `colors` 换成新 token 名（surface app/panel/elevated/sunken、track、track-fill、line、line-soft、text、muted、disabled、accent 系列、danger/warning/success、scrim、checker）并使用 GitHub 深色调色板；保留稀有度不覆盖（主题不涉及内容识别色）。

- [ ] **Step 6: 更新 `base.css`**

`body` 背景改 `--color-surface-app`；`::selection` 用 `--color-accent` 的 28% 透明；滚动条滑块 `--color-line`、轨道透明，宽 10px；去掉旧的蓝色 focus 默认描边。

- [ ] **Step 7: 跑测试与构建**

Run: `pnpm --filter @prismwright/desktop test -- tokens && pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck && pnpm --filter @prismwright/desktop build`
Expected: 全绿。`themes/__tests__/*` 若因颜色断言失败，按其断言更新为新的语义键。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/styles apps/desktop/tailwind.config.ts apps/desktop/src/themes
git commit -m "feat(ui): 语义 token 与 Tailwind 刻度"
```

---

### Task 2: 基础控件

**Files:**
- Modify: `apps/desktop/src/ui/Slider.tsx`
- Modify: `apps/desktop/src/ui/NumberField.tsx`
- Modify: `apps/desktop/src/ui/Select.tsx`
- Modify: `apps/desktop/src/ui/Switch.tsx`
- Modify: `apps/desktop/src/ui/ColorField.tsx`
- Modify: `apps/desktop/src/ui/IconButton.tsx`
- Create: `apps/desktop/src/ui/Button.tsx`
- Create: `apps/desktop/src/ui/Segmented.tsx`
- Test: `apps/desktop/src/ui/__tests__/slider.test.ts`（补充）

**Interfaces:**
- Produces: `<Button variant="primary" | "secondary" | "ghost" | "danger" size="sm" | "md">`；`<Segmented value options onChange ariaLabel>`；`Slider` 的 props 不变（`value/onChange/onCommit/min/max/step/precision/ariaLabel/disabled/defaultValue/resetLabel`）。

- [ ] **Step 1: 写失败测试（SSR）**

在 `slider.test.ts` 增加一条：渲染后 HTML 同时包含 `rounded-control`（轨道/数字框）、`bg-track`（轨道底）、`bg-track-fill`（已滑过部分）、`h-4 w-2`（手柄尺寸类）。用 class 断言把「厚轨道 + 填充 + 竖手柄」钉住。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- slider` → FAIL（当前 `h-1` / `rounded-sm` / `bg-accent`）。

- [ ] **Step 3: 改 `Slider.tsx`**

Root：`relative flex h-control min-w-0 flex-1 touch-none select-none items-center`。Track：`relative h-control w-full grow overflow-hidden rounded-control border border-line-soft bg-track shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]`。Range：`absolute h-full rounded-control bg-track-fill`。Thumb：`block h-4 w-2 rounded-chip bg-[#f4f1eb] shadow-[0_1px_4px_rgb(0_0_0/0.45)] outline-none focus-visible:ring-2 focus-visible:ring-accent/50`。数字框与复位图标保持原顺序；gap 从 2 改 `gap-2`。

- [ ] **Step 4: 改 `NumberField.tsx`**

类改为 `h-control w-[43px] shrink-0 rounded-control border border-line-soft bg-sunken px-1.5 text-right font-mono text-num text-foreground`，focus 时 `border-accent`。`w-[43px]` 是固定控件宽，加入守卫白名单（见 Task 10）。

- [ ] **Step 5: 新版 `Button.tsx` 与 `Segmented.tsx`**

Button：`h-button rounded-control px-3 text-body font-medium`；primary `bg-accent text-[color:var(--color-text-on-accent)] hover:bg-accent-hover active:bg-accent-active`；secondary `border border-line-soft text-muted hover:bg-elevated hover:text-foreground`；ghost 无边框；danger 红字。Segmented：容器 `inline-flex h-button items-center gap-1 rounded-control`，**不加**内边距（避免选中项圆角与容器冲突）；选中项 `h-control rounded-control bg-elevated px-3 text-foreground shadow-sm`，未选中 `h-control rounded-control px-3 text-muted hover:text-foreground`；`role="tablist"`、每项 `role="tab" aria-selected`。

- [ ] **Step 6: `Switch` / `Select` / `ColorField` / `IconButton` 换新刻度**

Switch 30×17、开态 `bg-accent-soft border-accent`、钮白色。Select 触发器 `h-button rounded-control`，菜单 `rounded-card bg-panel`。ColorField `h-button rounded-control`、色块 15px `rounded-chip`。IconButton 视觉尺寸 24、命中区 28、`rounded-control`，悬停 `bg-elevated`。

- [ ] **Step 7: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test -- slider && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/ui
git commit -m "feat(ui): 新的基础控件（厚滑轨/按钮/分段）"
```

---

### Task 3: 结构控件（分区卡、字段行、树行、标签、空态、Toast）

**Files:**
- Modify: `apps/desktop/src/ui/Section.tsx`
- Modify: `apps/desktop/src/ui/PropertyRow.tsx`
- Modify: `apps/desktop/src/ui/TreeList.tsx`
- Modify: `apps/desktop/src/ui/Tooltip.tsx`
- Create: `apps/desktop/src/ui/Tag.tsx`
- Create: `apps/desktop/src/ui/EmptyState.tsx`
- Create: `apps/desktop/src/ui/Toast.tsx`
- Test: `apps/desktop/src/ui/__tests__/propertyRow.test.ts`（新建）

**Interfaces:**
- Produces: `<SectionCard title collapsible defaultOpen>`；`<PropertyRow label grow reserveControlSpace>` 保持现有 props；`<Tag tone="rare|epic|legend|common">`；`<EmptyState icon title hint>`；`toast(message, tone?)` + `<ToastHost />`。

- [ ] **Step 1: 写失败测试**

`propertyRow.test.ts`：SSR 渲染 `<PropertyRow label="密度">x</PropertyRow>`，断言包含 `min-h-row`、标签 `w-[60px]`（固定标签列）与 `gap-2`；断言标签带 `text-label text-muted truncate`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- propertyRow` → FAIL。

- [ ] **Step 3: 实现并改造**

- `PropertyRow`：`flex min-h-row items-center gap-2 px-2`；标签 `w-[60px] shrink-0 truncate text-label text-muted`（`reserveControlSpace` 时改 `shrink`）；去掉旧的 `w-24`/`text-[12px]`。
- `SectionCard`：`rounded-card border border-line bg-elevated/40`；标题行 `h-row px-3 text-title font-semibold text-foreground`，折叠箭头 muted；内容 `px-3 pb-3`。
- `TreeList`：行 `h-row rounded-control px-2`，选中 `bg-accent-soft` + 左侧 2px 绿条（`before:` 伪元素），悬停 `bg-elevated`。
- `Tag`：`rounded-chip px-1.5 text-num`，色调沿用 `features/cards/rarity.ts` 的 text/tint。
- `EmptyState` / `Toast` / `Tooltip` 按 spec §6.2、§9 实现。
- `Section.tsx` 保留旧导出以减小迁移面，内部改为 SectionCard。

- [ ] **Step 4: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/ui
git commit -m "feat(ui): 分区卡/字段行/树行等结构控件"
```

---

### Task 4: 顶栏（TopBar）

**Files:**
- Modify: `apps/desktop/src/features/titlebar/TitleBar.tsx`
- Modify: `apps/desktop/src/features/titlebar/MenuBar.tsx`
- Modify: `apps/desktop/src/features/titlebar/LayoutControls.tsx`
- Modify: `apps/desktop/src/features/titlebar/SettingsButton.tsx`
- Modify: `apps/desktop/src/features/titlebar/WindowControls.tsx`
- Modify: `apps/desktop/src/app/App.tsx`
- Test: `apps/desktop/src/features/titlebar/__tests__/titleBar.test.ts`、`layoutControls.test.ts`

**Interfaces:**
- Produces: 顶栏高度 `h-topbar`；左侧品牌 + 菜单、系列名、中部拖拽区、右侧撤销/重做 + 保存状态 + 布局切换 + 导出 + 设置 + 窗口控件。`App.tsx` 的外层 padding 为 `p-2`，顶栏与三栏都浮在其上。

- [ ] **Step 1: 更新失败测试**

`titleBar.test.ts`：断言渲染结果含 `h-topbar`、`rounded-panel`、品牌字标、系列名；`minimal` 形态不含菜单与系列名。`layoutControls.test.ts`：断言三颗按钮的可访问名（工作室/专注/紧凑）与 `aria-pressed` 状态。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- titlebar` → FAIL。

- [ ] **Step 3: 重写 `TitleBar.tsx`**

结构：外层 `grid h-topbar grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-panel border border-line-soft bg-panel px-2`，**保留** `data-tauri-drag-region` 与 macOS 交通灯让位（76px）；左区品牌锁形 + `MenuBar`（Windows）；中区放系列名（`pointer-events-none`，可 truncate）；右区 `UndoRedo`（复用 `menuActions.dispatch`）、`SaveStatus`、`LayoutControls`、导出按钮、`SettingsButton`、`WindowControls`。保存失败时红点按钮点击打开一个 `rounded-card` 浮层显示 `lastError` 与「重试」。

- [ ] **Step 4: `App.tsx` 外壳**

`<div className="flex h-full flex-col bg-app p-2 gap-2">`；编辑器态：顶栏 → `Splitter`（左右面板 `rounded-panel`，中间透明）→ **去掉 `StatusBar`**。起始屏与设置视图仍保留顶栏的 `minimal`/完整形态，但设置视图占满剩余高度。给外层 padding 加 `data-tauri-drag-region`。

- [ ] **Step 5: 跑测试、typecheck、build**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck && pnpm --filter @prismwright/desktop build`
Expected: 全绿；`menuActions.test`/`menuModel.test` 不受影响。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/features/titlebar apps/desktop/src/app/App.tsx
git commit -m "feat(ui): 新顶栏（保存状态/布局切换/窗口控件）"
```

---

### Task 5: 左栏卡片库

**Files:**
- Modify: `apps/desktop/src/features/cards/HierarchyPanel.tsx`
- Modify: `apps/desktop/src/features/cards/CardTree.tsx`
- Create: `apps/desktop/src/features/cards/cardFilter.ts`
- Create: `apps/desktop/src/features/cards/useCardThumbnail.ts`
- Test: `apps/desktop/src/features/cards/__tests__/cardFilter.test.ts`（新建）

**Interfaces:**
- Produces: `filterCards(pack, { query, section })` 纯函数；`useCardThumbnail(cardId): string | null`（object URL，缓存 + 卸载释放）。

- [ ] **Step 1: 写失败测试**

`cardFilter.test.ts`：① 空查询返回全部；② 查询匹配昵称（大小写不敏感）；③ 查询匹配编号（`e01`）；④ `section: "hidden"` 只返回隐藏款；⑤ `section: "back"` 返回空（卡背不在卡片列表）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- cardFilter` → FAIL（模块不存在）。

- [ ] **Step 3: 实现 `cardFilter.ts` 与 `useCardThumbnail.ts`**

`useCardThumbnail` 用 `packFs.readAssetBytes(rootDir, previewPngRel(cardId))` → `Blob` → `URL.createObjectURL`；按 `rootDir+cardId+hash` 缓存；失败返回 `null`；卸载时 `revokeObjectURL`。无 Tauri 环境直接返回 `null`。

- [ ] **Step 4: 改造左栏**

`HierarchyPanel`：头部「卡片 24」+ 搜索框（`h-control rounded-control bg-sunken`）+ `Segmented`（全部/隐藏款/卡背）+ 列表 + 底部「＋ 新建卡片」按钮（`sticky bottom-0`，`bg-panel`）。卡背项选中时 `selectBack`。`CardTree` 行改为缩略图 30×42（`rounded-chip`）+ 昵称/编号两行 + `Tag`；保留右键菜单与缺失资源警示。

- [ ] **Step 5: 跑测试、typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS；`uiStore.test` 若涉及 `previewSide` 选择背面的路径不变。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/features/cards
git commit -m "feat(ui): 左栏卡片库（搜索/筛选/缩略图）"
```

---

### Task 6: 舞台

**Files:**
- Modify: `apps/desktop/src/features/preview/PreviewPanel.tsx`
- Modify: `apps/desktop/src/ui/Splitter.tsx`
- Modify: `apps/desktop/src/app/App.tsx`（移除 StatusBar 的残留引用）

**Interfaces:**
- Produces: 舞台无背景容器；顶部一排 `正面/背面` + `预览/绘画/对比(隐藏)` 的分段控件；底部居中浮动视图胶囊（缩放 − / 百分比 / +、适配、播放/暂停、背景开关）。

- [ ] **Step 1: 定位现有结构**

读 `PreviewPanel.tsx` 的渲染树，标出：两侧切换、缩放、绘制模式、画布容器、背景/环境开关。不改任何渲染逻辑，只改容器 class 与控件外壳。

- [ ] **Step 2: 改舞台布局**

外层 `relative flex min-h-0 flex-1 flex-col`，透明底；工具栏 `absolute left-3 top-3 z-10 flex items-center gap-2`；视图胶囊 `absolute bottom-4 left-1/2 -translate-x-1/2 flex h-button items-center gap-1 rounded-full border border-line-soft bg-panel/90 px-1.5 shadow-lg backdrop-blur`。画布容器去掉 `bg-panel`，保留 checker 背景与命中层；绘图画笔命中区不得因外层 padding 缩小。

- [ ] **Step 3: `Splitter` 面板外观**

左右面板容器改为 `overflow-hidden rounded-panel border border-line-soft bg-panel shadow-[0_12px_32px_rgb(0_0_0/0.2)]`；中间不留边框；分栏手柄宽 8、悬停显示 `bg-accent/40`。

- [ ] **Step 4: 跑测试、typecheck、build**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck && pnpm --filter @prismwright/desktop build`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/features/preview apps/desktop/src/ui/Splitter.tsx apps/desktop/src/app/App.tsx
git commit -m "feat(ui): 舞台直铺背景与浮动视图胶囊"
```

---

### Task 7: 检查器页签化

**Files:**
- Modify: `apps/desktop/src/features/cards/InspectorPanel.tsx`
- Modify: `apps/desktop/src/features/cards/CardFaceFields.tsx`
- Modify: `apps/desktop/src/features/layers/LayerList.tsx`
- Modify: `apps/desktop/src/features/layers/LayerDetail.tsx`
- Modify: `apps/desktop/src/features/layers/TextDetail.tsx`
- Modify: `apps/desktop/src/features/effects/EffectStack.tsx`（`features/effects/` 下实际文件为准）
- Create: `apps/desktop/src/features/cards/inspectorTabs.ts`
- Test: `apps/desktop/src/features/cards/__tests__/inspectorTabs.test.ts`（新建）

**Interfaces:**
- Produces: `type InspectorTab = "design" | "layers" | "effects" | "export"`；`INSPECTOR_TABS` 常量；选中页签存 `uiStore.inspectorTab`（不持久化，切换卡片保留）。

- [ ] **Step 1: 写失败测试**

`inspectorTabs.test.ts`：断言页签顺序为 `design/layers/effects/export`；`availableTabs(faceRef)`：卡背也有四页；无选中图层时 `effects` 仍可进入但内容为空态（返回 `true`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- inspectorTabs` → FAIL。

- [ ] **Step 3: 实现页签与分区卡**

检查器头部：卡名（17px 衬线）+ `Tag` + 副行；`Segmented`/页签行 `h-row`；内容区 `overflow-y-auto`。设计页：两张 `SectionCard`（身份 / 画布）。图层页：添加层按钮组 + `LayerList` + `LayerDetail`（拆出「效果」与「混合与蒙版」两个 `SectionCard`）。效果页：只渲染选中层的效果栈与参数（复用现有组件，不再与图层详情叠在同一长滚动）。导出页：读现有导出入口，提供「导出本卡」按钮并说明格式。

- [ ] **Step 4: 跑测试、typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS；`effectOps` 等纯逻辑测试不受影响。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/features/cards apps/desktop/src/features/layers apps/desktop/src/features/effects apps/desktop/src/store/uiStore.ts
git commit -m "feat(ui): 检查器页签（设计/图层/效果/导出）"
```

---

### Task 8: 布局模式

**Files:**
- Modify: `apps/desktop/src/store/uiStore.ts`
- Modify: `apps/desktop/src/features/titlebar/LayoutControls.tsx`
- Modify: `apps/desktop/src/ui/Splitter.tsx`
- Modify: `apps/desktop/src/app/bootstrap.tsx`
- Test: `apps/desktop/src/store/__tests__/uiStore.test.ts`、`features/titlebar/__tests__/layoutControls.test.ts`

**Interfaces:**
- Produces: `layout: "studio" | "focus" | "compact"`、`setLayout(layout)`；`layoutColumns(layout): { left: number; right: number }`（左/右像素宽，0 表示收起）；分栏拖拽写入 `splitSizes` 并覆盖当前模式。

- [ ] **Step 1: 写失败测试**

`uiStore.test.ts` 增加：① 默认 `studio`；② `setLayout("compact")` 后 `layoutColumns` 返回 `{ left: 64, right: 300 }`；③ `focus` → `{ left: 0, right: 348 }`；④ 拖拽后 `splitSizes` 生效且 `setLayout` 切换会重置为该模式默认值。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- uiStore` → FAIL。

- [ ] **Step 3: 实现 store 与持久化**

`uiStore` 增加 `layout`、`splitSizes`、`setLayout`、`setSplitSizes`；`bootstrap.tsx` 复用现有 store 插件读写（键 `ui.layout` / `ui.split`）。`LayoutControls` 三角色按钮 + tooltip + `aria-pressed`。

- [ ] **Step 4: `Splitter` 支持像素列宽与收起**

`Splitter` 接受 `leftWidth/rightWidth`；`0` 时不渲染该栏（`display:none` 或宽度 0 + `overflow-hidden`）；紧凑模式左栏只渲染缩略图（由 props 传入 `compact`）。

- [ ] **Step 5: 跑测试、typecheck、build**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck && pnpm --filter @prismwright/desktop build`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/store apps/desktop/src/features/titlebar apps/desktop/src/ui/Splitter.tsx apps/desktop/src/app/bootstrap.tsx
git commit -m "feat(ui): 工作室/专注/紧凑三种布局"
```

---

### Task 9: 其余页面与对话框扫尾

**Files:**
- Modify: `apps/desktop/src/features/settings/SettingsView.tsx` 及 `features/settings/*.tsx`
- Modify: `apps/desktop/src/features/start/StartScreen.tsx`
- Modify: `apps/desktop/src/features/export/ExportDialog.tsx`
- Modify: `apps/desktop/src/features/bundle/*.tsx`
- Modify: `apps/desktop/src/features/pack/*Dialog.tsx`
- Modify: `apps/desktop/src/ui/Dialog.tsx`、`ConfirmDialog.tsx`、`ContextMenu.tsx`、`ColorStops.tsx`

**Interfaces:** 无新接口；只替换类名与 `Button`/`Segmented`/`SectionCard` 用法，行为不变。

- [ ] **Step 1: 逐文件替换旧刻度类**

`rounded-sm|md` → `rounded-control|card|panel`；`text-[1Xpx]` → `text-num|label|body|title`；`border-border` → `border-line|line-soft`；手写按钮 → `Button`。

- [ ] **Step 2: 对话框统一外观**

对话框 `rounded-panel bg-panel`，标题 13px 600，底部操作区右对齐 gap 8；遮罩 `bg-scrim/60 backdrop-blur-sm`。

- [ ] **Step 3: 跑测试、typecheck、build**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck && pnpm --filter @prismwright/desktop build`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src
git commit -m "feat(ui): 设置/起始屏/对话框换用新控件"
```

---

### Task 10: 样式规范守卫与视觉验收

**Files:**
- Create: `apps/desktop/src/ui/__tests__/styleScale.test.ts`
- Create: `apps/desktop/scripts/screenshot-qa.md`（操作说明，可选）

**Interfaces:** 无。

- [ ] **Step 1: 写守卫测试**

扫描 `src/ui` 与 `src/features` 下 `*.tsx`，命中 `/(rounded|h|w|gap|p|px|py|text)-\[\d/` 即失败。白名单（文件 → 允许模式）：`NumberField.tsx` 的 `w-[43px]`、`CardTree.tsx` 的缩略图尺寸、`PreviewPanel.tsx` 的画布尺寸。断言源码中不出现 `bg-gradient`。

- [ ] **Step 2: 跑测试确认现状**

Run: `pnpm --filter @prismwright/desktop test -- styleScale` → 预期 FAIL 并列出残留文件（Task 9 之后应只剩白名单项；若有遗漏，回到对应任务修掉）。

- [ ] **Step 3: 全量验证**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck && pnpm --filter @prismwright/desktop build`
Expected: 全绿。

- [ ] **Step 4: 视觉验收**

`pnpm dev` 启动桌面壳，在 1440×900、1280×800、1024×768 下分别截工作室/专注/紧凑三种布局；与 `tools/ui-mockup/studio.png`、`focus.png`、`compact.png` 对照，重点核对滑杆填充与手柄、控件圆角、间距节奏、面板层级。把截图与结论写入 `docs/superpowers/notes/2026-11-28-ui-visual-qa.md`。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/ui/__tests__/styleScale.test.ts docs/superpowers/notes
git commit -m "test(ui): 样式刻度守卫与视觉验收记录"
```
