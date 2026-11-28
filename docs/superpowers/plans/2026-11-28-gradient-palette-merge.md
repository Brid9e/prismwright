# 渐变合并与编辑器控件收尾实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把调色板并入渐变（schema v10）、统一颜色取色器、效果默认展开、覆盖式滚动条、编辑区间距/分割线、扁平滑块，并让预览缩放能真正到 400%。

**Architecture:** 先做独立的颜色控件与交互清理，再改数据层（schema + 迁移 + 渲染器 + 默认卡背），最后做间距/滚动条/缩放这些纯 UI/渲染层收尾。每个任务以 TDD 推进，任务结束跑该层测试 + typecheck，最后一次全量 `pnpm build`。

**Tech Stack:** React 19、Radix（Slider / Popover）、Tailwind 3、zustand、i18next、Tauri 2、vitest（node SSR 冒烟）、three.js、zod。

**Spec:** `docs/superpowers/specs/2026-11-28-gradient-palette-merge-design.md`

## Global Constraints

- 只改 `D:\Code\cardbara-editor`；不碰 `D:\Code\card-editor`。
- 提交留在本地，**不 push**；不启动 `pnpm dev` / `dev:web`，最终验证只跑 `pnpm build`（用户自行验收）。
- 尺寸只允许 4 / 8 / 12 / 16 / 24 刻度；组件里禁止 `rounded-[…]`、`h-[…]`、`gap-[…]`、`px-[…]`、`text-[…px]` 任意值，也禁止 `bg-gradient`（渐变写进 `base.css` 的语义类）。
- 新增中文文案同时补 `zh-CN` 与 `en`；删除文案时两处一起删。
- 控件保留可访问名与键盘可达；Radix 行为不退化。
- 每个任务结束必须绿：对应包 `test` + `typecheck`；最后 `pnpm build` 绿。
- 旧系列迁移以「尽量保持原观感」为准；唯一接受的可见变化：只有调色板的旧层补上默认斜坡（`straight = 1`）。

## Review Focus

- 旧系列迁移：双有 / 仅调色板 / 仅渐变 / 多层 / 卡背 / 隐藏卡 / 幂等，不能崩或丢色标。
- 合并后的 `enabled` 语义：关掉渐变应整条全息消失，但相位全局项仍可从数据读到。
- 取色器透明度：`#rrggbbaa` 与 6 位往返不能丢 alpha；非法 hex 输入不能写入脏数据。
- 覆盖式滚动条：效果展开/折叠、换卡、窗口缩放后滑块高度要重算；内容不滚动时不渲染。
- 预览缩放：贴合点前后连续，宽卡在 `zoom > 1` 时裁切而不是被钉住；400% 封顶。

---

### Task 1: 颜色取色器组件与字段接入

**Files:**
- Create: `apps/desktop/src/ui/color-picker-math.ts`
- Create: `apps/desktop/src/ui/ColorPicker.tsx`
- Create: `apps/desktop/src/ui/__tests__/color-picker-math.test.ts`
- Create: `apps/desktop/src/ui/__tests__/colorPicker.test.ts`
- Modify: `apps/desktop/src/ui/ColorField.tsx`
- Modify: `apps/desktop/src/ui/ColorStops.tsx`
- Modify: `apps/desktop/src/styles/base.css`
- Modify: `apps/desktop/package.json`（新增 `@radix-ui/react-popover`）
- Test: `apps/desktop/src/features/effects/__tests__/effectStack.test.ts`（更新 props）
- Test: `apps/desktop/src/ui/__tests__/styleScale.test.ts`（若新增例外）

**Interfaces:**
- Produces:
  - `interface Hsv { h: number; s: number; v: number }`
  - `function hexToHsv(hex: string): Hsv`
  - `function hsvToHex(hsv: Hsv, alpha: number): string`
  - `function normalizeHexInput(input: string): string | null`
  - `<ColorPicker value onChange ariaLabel size?={ "sm" | "md" } showHex?={ boolean } />`
  - `ColorFieldProps` 签名不变（`value/onChange/ariaLabel/size`）。
  - `ColorStopsProps` 本任务仍保留 `onPick`，下一任务删除。

- [ ] **Step 1: 写颜色换算失败测试**

`color-picker-math.test.ts` 断言：
- `hexToHsv("#ff0000")` → `{ h: 0, s: 1, v: 1 }`；
- `hexToHsv("#00ff0080")` 的 alpha 由 `alphaOf` 单独读，HSV 只取 RGB；
- `hsvToHex({ h: 0, s: 1, v: 1 }, 0.5)` → `"#ff000080"`，alpha 1 → `"#ff0000"`；
- `normalizeHexInput("ff0000")` / `"#F00"` / `"#ff0000ff"` → 合法 8 位归一；`"nope"` → `null`；
- 越界 HSV 夹取（h 360 回绕到 0，s/v 夹到 0–1）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- color-picker-math`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `color-picker-math.ts`**

用纯函数实现 hex ↔ HSV；复用 schema 的 `alphaOf` / `withAlpha`；非法输入返回原值 / null，不抛。

- [ ] **Step 4: 写取色器 SSR 冒烟失败测试**

`colorPicker.test.ts` 渲染 `ColorPicker`，断言：
- 触发器是 `<button>`，带 `aria-label` 与 `aria-haspopup="dialog"`；
- 不渲染 `<input type="color">`；
- `showHex` 为 true 时显示 `#rrggbb` 文本；
- 套 `TooltipProvider`（若用到 Tooltip）不抛错。

- [ ] **Step 5: 实现 `ColorPicker.tsx`**

- Radix Popover：Trigger 是带棋盘格的色块按钮；Content 含 SV 面板、色相滑杆、透明度滑杆、hex 输入。
- SV 面板用 CSS 类 `.color-sv-field`（背景色由内联 `--picker-hue` 驱动），指针拖动更新 s/v；可聚焦、方向键微调。
- 色相 / 透明度用 Radix Slider，轨道用 `.color-hue-track` / `.color-alpha-track`，手柄 `h-control w-2`。
- 透明度写回沿用 `withAlpha`；100% 输出 6 位。
- 弹层 `sideOffset={6}`、`collisionPadding={8}`，Esc 自动关闭。
- 在 `base.css` 增加 `.checkerboard`、`.color-sv-field`、`.color-hue-track`、`.color-alpha-track`；渐变只用 CSS，TSX 不写 `bg-gradient`。

- [ ] **Step 6: 接入 `ColorField` 与 `ColorStops`**

- `ColorField` 改为「色块 + hex 文本」的按钮，点击开 `ColorPicker`；删除原生 input、Radix 透明度滑杆、百分比。
- `ColorStops` 每行：拖动柄 + `ColorPicker` 色块 + 位置 `NumberField` + 删除；删除行内透明度 range 与百分比。本任务暂留吸管按钮与 `onPick`，下一任务删。
- 运行 `pnpm --filter @prismwright/desktop test -- colorPicker color-picker-math effectStack`，Expected: PASS。

- [ ] **Step 7: 跑桌面端测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/ui apps/desktop/src/styles/base.css apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/features/effects/__tests__/effectStack.test.ts
git commit -m "feat(ui): 统一面板内颜色取色器"
```

---

### Task 2: 删除画布吸管链路

**Files:**
- Delete: `apps/desktop/src/features/effects/pickColor.ts`
- Delete: `apps/desktop/src/features/effects/__tests__/pickColor.test.ts`
- Modify: `apps/desktop/src/features/effects/EffectStack.tsx`
- Modify: `apps/desktop/src/features/layers/LayerDetail.tsx`
- Modify: `apps/desktop/src/features/preview/PreviewPanel.tsx`
- Modify: `apps/desktop/src/store/uiStore.ts`
- Modify: `apps/desktop/src/features/preview/eraseCanvas.ts`（注释）
- Modify: `apps/desktop/src/i18n/locales/{zh-CN,en}/effect.json`
- Modify: `apps/desktop/src/i18n/locales/{zh-CN,en}/layer.json`（`colors.pick` / `colors.alpha` 若不再使用）
- Modify: `apps/desktop/src/i18n/locales/{zh-CN,en}/common.json`（`colorAlpha` 若不再使用）
- Test: `apps/desktop/src/store/__tests__/uiStore.test.ts`
- Test: `apps/desktop/src/features/effects/__tests__/effectStack.test.ts`

**Interfaces:**
- Produces: `ColorStopsProps` 只剩 `{ colors, onChange }`；`EffectStackProps` 删除 `onPickColor`；`uiStore` 删除 `colorPick` / `requestColorPick` / `resolveColorPick`。

- [ ] **Step 1: 写/改失败测试**

- `effectStack.test.ts` 的 props 去掉 `onPickColor`，并断言渲染结果不含「从画面拾取」文案。
- `uiStore.test.ts` 断言 store 类型/状态里没有 `colorPick`（用 `"colorPick" in useUiStore.getState()` 为 false）。
- 运行对应测试，Expected: FAIL（类型/属性仍在）。

- [ ] **Step 2: 删除 UI 接线**

`EffectStack` 删除 `onPickColor` prop、`Pipette` 导入、`field.key === "color"` 的吸管按钮、`ColorStops` 的 `onPick`；`LayerDetail` 删除 `requestColorPick` 与 `onPickColor`；`ColorStops` 删除吸管按钮与 `onPick` prop。

- [ ] **Step 3: 删除预览取色流程**

`PreviewPanel` 删除 `colorPick` / `pickActive` / `handlePickPointerDown` / `paletteColors` / 取色覆盖层 JSX / 与取色有关的 `frontImage` 加载 effect / `pickClickAction` 导入；`uiStore` 删除 `ColorPickRequest`、`colorPick` 状态与两个 action；删除 `pickColor.ts` 与其测试。

- [ ] **Step 4: 清理 i18n 与注释**

删除只被吸管使用的键；`eraseCanvas.ts` 的吸管注释改为不再引用 `pickColor.ts`。

- [ ] **Step 5: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src
git commit -m "refactor(ui): 移除画布吸管取色"
```

---

### Task 3: 调色板并入渐变（schema v10）

**Files:**
- Modify: `packages/card-schema/src/types.ts`
- Modify: `packages/card-schema/src/schema.ts`
- Modify: `packages/card-schema/src/migrate.ts`
- Modify: `packages/card-schema/src/defaults.ts`
- Modify: `packages/card-schema/src/effects.ts`
- Modify: `packages/card-schema/src/index.ts`
- Test: `packages/card-schema/src/__tests__/{schema,migrate,resolve-gradient-palette,palette-params}.test.ts`
- Modify: `packages/card-renderer/src/v1/effects/registry.ts`
- Modify: `packages/card-renderer/src/v1/effects/uniforms.ts`
- Modify: `packages/card-renderer/src/v1/mapping.ts`
- Modify: `packages/card-renderer/src/v1/materials/layer-material.ts`
- Modify: `packages/card-renderer/src/v1/index.ts`（若导出变化）
- Test: `packages/card-renderer/src/v1/__tests__/{effects-registry,effects-uniforms,mapping,layer-material}.test.ts`
- Modify: `apps/desktop/src/features/default-back/default-back.ts`
- Test: `apps/desktop/src/features/default-back/__tests__/default-back.test.ts`
- Modify: `apps/desktop/src/i18n/locales/{zh-CN,en}/effect.json`
- Modify: `apps/desktop/src/features/layers/colors.ts`、`apps/desktop/src/store/packStore.ts`、`apps/desktop/src/features/flatten/flatten.ts`（注释）
- Test: `apps/desktop/src/store/__tests__/updates.test.ts`

**Interfaces:**
- Produces:
  - `GradientParams` 含原 `PaletteParams` 全部字段；`Effect` 联合不再有 `palette`。
  - `resolveGradient(effects): GradientParams | null`（不论 enabled）。
  - `resolveHoloGradient(effects): GradientParams | null`（只取 enabled）。
  - `holoIsActive(params: GradientParams | null): boolean`。
  - `EFFECT_REGISTRY.gradient.fields` 顺序：palette 字段在前，渐变字段在后，`straight` 最后。
  - schema 版本 `10`；`straight` 默认 `1`。

- [ ] **Step 1: 写 schema 失败测试**

在 `schema.test.ts` / `palette-params.test.ts` 断言：
- `GradientParamsSchema.parse({})` 含 `colors: []`、`composite: "palette"`、`hue/sat/lift/...` 默认值、`straight: 1`；
- `EffectSchema.parse({ kind: "palette", ... })` 抛错；
- `PackSchema` 的 `schemaVersion` 只接受 10；
- 旧 `colors` 裸字符串仍归一为色标。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/schema test -- schema palette-params`
Expected: FAIL。

- [ ] **Step 3: 改 schema/types/effects**

把 `PaletteParams` 字段并入 `GradientParams`；删除 `palette` 分支与 `PaletteParamsSchema` 导出；`straight` 默认 1；删除 `resolvePalette`，新增 `resolveHoloGradient` / `holoIsActive`。

- [ ] **Step 4: 写迁移失败测试**

`migrate.test.ts` 表驱动：
- `gradient + palette` → 一条 gradient，params 合并，id 取 gradient，位置取靠前，enabled 取 palette；
- 仅 `palette` → 一条 gradient，保留色标，`straight: 1`；
- 仅 `gradient` → 一条 gradient，`colors: []`；
- 多层 / `back` / `hiddenCards` / 面级效果都执行；
- 跑两次结果相同。

Run: `pnpm --filter @prismwright/schema test -- migrate`
Expected: FAIL。

- [ ] **Step 5: 实现 v9→v10 迁移**

在 `migrate.ts` 加 `mergeGradientPalette`，递归遍历效果列表；`CURRENT_SCHEMA_VERSION = 10`；`migrateCardFace` 同时执行 v8→v9 与 v9→v10 合并。

- [ ] **Step 6: 改渲染器并跑失败测试**

- registry：删除 `palette` 条目与 `PALETTE_MAX`；`gradient.fields` 按 spec 顺序拼接；`defaultParams` 带默认色标；`EFFECT_KINDS` 删除 `"palette"`。
- uniforms：仍按 `gradient` 打包；无行为变化。
- mapping：相位全局项用 `resolveGradient`；`hasHolo` 用 `resolveHoloGradient` + `holoIsActive`。
- material：用 `resolveHoloGradient` 取色标与叠色参数。
- 更新 `effects-registry` / `mapping` / `layer-material` / `effects-uniforms` 测试中的 palette 造数，改为 gradient。
- Run: `pnpm --filter @prismwright/renderer test && pnpm --filter @prismwright/renderer typecheck`
- Expected: FAIL → 实现 → PASS。

- [ ] **Step 7: 改编辑器默认卡背与 i18n**

`createDefaultBackFace` 只创建一条 gradient；i18n 把 `palette.*` 字段文案并入 `gradient.*`（合成方式选项改「色带 / 暗部叠色」），删除 `palette` 块；`colors.ts` / `packStore` / `flatten` 注释改名。更新 `default-back` 与 `updates` 测试。

- [ ] **Step 8: 全量桌面测试 + typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: 全绿。

- [ ] **Step 9: 提交**

```bash
git add packages/card-schema packages/card-renderer apps/desktop/src
git commit -m "feat(schema)!: 调色板并入渐变（schema v10）"
```

---

### Task 4: 所有效果默认展开

**Files:**
- Modify: `apps/desktop/src/features/effects/EffectStack.tsx`
- Test: `apps/desktop/src/features/effects/__tests__/effectStack.test.ts`

- [ ] **Step 1: 写失败测试**

渲染一条 `gradient`（或任意 kind）的 `EffectStack`，断言展开区里的字段文案直接出现（不点箭头）；再断言点击箭头后字段消失、再点出现。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- effectStack`
Expected: FAIL（默认折叠）。

- [ ] **Step 3: 改成折叠集合**

`EffectStack` 的状态从 `expanded: Set<string>` 改为 `collapsed: Set<string>`；`isExpanded = !collapsed.has(id)`；toggle 加入/移出。新效果不在集合里，天然展开。

- [ ] **Step 4: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test -- effectStack && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/features/effects
git commit -m "feat(ui): 效果默认全部展开"
```

---

### Task 5: 扁平滑块轨道与同高手柄

**Files:**
- Modify: `apps/desktop/src/ui/Slider.tsx`
- Test: `apps/desktop/src/ui/__tests__/slider.test.ts`
- Modify: `apps/desktop/src/ui/ColorPicker.tsx`（色相 / 透明度滑杆同款）

- [ ] **Step 1: 改失败测试**

`slider.test.ts` 断言：
- 轨道 class 不含 `inset-control`、不含 `border-line-soft`；
- 手柄 class 含 `h-control` 与 `w-2`，不含 `thumb-shadow`；
- 仍含 `bg-track` / `bg-track-fill` / `rounded-control`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/desktop test -- slider`
Expected: FAIL。

- [ ] **Step 3: 改轨道与手柄**

`Slider` Track 去掉 `inset-control` 与 `border border-line-soft`；Thumb 改为 `h-control w-2 rounded-chip`，去掉 `thumb-shadow`。`ColorPicker` 内的滑杆复用同样 class。

- [ ] **Step 4: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test -- slider && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/ui/Slider.tsx apps/desktop/src/ui/ColorPicker.tsx apps/desktop/src/ui/__tests__/slider.test.ts
git commit -m "feat(ui): 扁平滑轨与同高手柄"
```

---

### Task 6: 编辑区间距与分割线

**Files:**
- Modify: `apps/desktop/src/ui/Section.tsx`
- Modify: `apps/desktop/src/ui/PropertyRow.tsx`
- Modify: `apps/desktop/src/features/effects/EffectStack.tsx`
- Modify: `apps/desktop/src/features/layers/LayerDetail.tsx`
- Modify: `apps/desktop/src/features/layers/TextDetail.tsx`
- Modify: `apps/desktop/src/features/layers/LayerList.tsx`
- Modify: `apps/desktop/src/features/cards/CardFaceFields.tsx`
- Modify: `apps/desktop/src/features/cards/InspectorPanel.tsx`
- Test: `apps/desktop/src/ui/__tests__/propertyRow.test.ts`、`apps/desktop/src/features/effects/__tests__/effectStack.test.ts`

**Interfaces:**
- Produces: `SectionCard` 标题 / 内容统一 `px-3`；`PropertyRow` 横向 `px-0`；编辑区不再出现行间 `border-b`。

- [ ] **Step 1: 改失败测试**

- `propertyRow.test.ts` 断言根节点含 `px-0`、不含 `px-2`。
- `effectStack.test.ts` 断言效果条目之间没有 `border-b`（或渲染结果不出现 `border-b border-line` 的条目容器）。
- 运行，Expected: FAIL。

- [ ] **Step 2: 统一容器间距**

按 spec §9.3 改：
- `SectionCard`：标题栏 `px-3`、内容 `px-3 pb-3`；标题栏 `h-row`。
- `PropertyRow`：`px-0`；顶层属性区补 `px-3`（`LayerDetail` 的属性根、`TextDetail` 外层）。
- `InspectorPanel`：内容区 `p-3` + `gap-2`，子视图不再各自 `p-2`。
- `LayerDetail` / `TextDetail`：去掉外层 `py-1`；`LayerDetail` 效果页去掉 `p-2`。
- `CardFaceFields`：去掉根节点 `border-b`、`py-1`；输入框 `h-control` + `border-line-soft`。
- `LayerList`：去掉根 `border-b`；列表与详情用 12 间距分开。

- [ ] **Step 3: 删除不必要的分割线**

删除效果条目 / 角色分组 / 添加菜单的 `border-b` / `border-t`；保留顶栏、左右栏、检查器头部与页签栏的结构边界。效果行与分组标题用 `-mx-3 px-3` 让悬停底色到卡片边缘。

- [ ] **Step 4: 清理 2 / 6 / 10px 间距**

搜索编辑区文件的 `gap-1.5`、`pt-0.5`、`py-1.5`、`px-2.5`，落到 4 / 8 / 12。

- [ ] **Step 5: 跑桌面端测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test && pnpm --filter @prismwright/desktop typecheck`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src
git commit -m "feat(ui): 规范编辑区间距并去掉多余分割线"
```

---

### Task 7: 覆盖式滚动条

**Files:**
- Create: `apps/desktop/src/ui/scrollbar-math.ts`
- Create: `apps/desktop/src/ui/ScrollArea.tsx`
- Create: `apps/desktop/src/ui/__tests__/scrollbar-math.test.ts`
- Create: `apps/desktop/src/ui/__tests__/scrollArea.test.ts`
- Modify: `apps/desktop/src/styles/base.css`
- Modify: `apps/desktop/src/features/cards/InspectorPanel.tsx`
- Modify: `apps/desktop/src/features/cards/HierarchyPanel.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsView.tsx`
- Modify: `apps/desktop/src/ui/Dialog.tsx`
- Modify: `apps/desktop/src/features/pack/AlbumDialog.tsx`

**Interfaces:**
- Produces:
  - `scrollbarMetrics(input: { scrollTop; scrollHeight; clientHeight; trackHeight; minThumb? }): { visible; thumbTop; thumbHeight }`
  - `<ScrollArea className? viewportClassName? ariaLabel?>{children}</ScrollArea>`

- [ ] **Step 1: 写几何失败测试**

`scrollbar-math.test.ts`：
- 内容小于视口 → `visible: false`；
- 可滚动时 `thumbHeight >= 24` 且按比例缩短；
- `thumbTop` 在 `[0, trackHeight - thumbHeight]`；
- 极端值（0 / NaN）不产生 NaN。

- [ ] **Step 2: 实现 `scrollbar-math.ts`**

纯函数，夹取所有输出；`trackHeight <= 0` 时隐藏。

- [ ] **Step 3: 写 ScrollArea SSR 冒烟**

断言：内容渲染；视口带 `scroll-area` 类；SSR 下不报错（jsdom/node 无布局）。

- [ ] **Step 4: 实现 `ScrollArea.tsx`**

外层 `relative min-h-0`，内层 `h-full overflow-y-auto overflow-x-hidden scroll-area`；内容包装层供 `ResizeObserver`；滑块 `absolute right-1 w-2 rounded-full bg-line`，`top/height` 用内联 style；滚动 / 悬停 / 拖动时显现，800ms 后淡出；拖动按比例写 `scrollTop`；内容不滚动时不渲染滑块。

- [ ] **Step 5: 接入主滚动区**

`InspectorPanel` 内容区、`HierarchyPanel` 卡片列表、`SettingsView`、`Dialog`、`AlbumDialog` 换成 `ScrollArea`；保持原有 `min-h-0` / `flex-1` 布局。`base.css` 增加 `.scroll-area { scrollbar-width: none; }` 与 `::-webkit-scrollbar { display: none; }`。

- [ ] **Step 6: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test -- scroll && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src
git commit -m "feat(ui): 覆盖式滚动条"
```

---

### Task 8: 预览缩放 400% 并裁切

**Files:**
- Modify: `packages/card-renderer/src/v1/zoom.ts`
- Modify: `packages/card-renderer/src/v1/card-view.ts`
- Test: `packages/card-renderer/src/v1/__tests__/zoom.test.ts`

**Interfaces:**
- Produces：`zoomToCameraDistance(zoom: number, fitDistance?: number): number`；`zoom = 1` 时距离为 `max(BASE_DISTANCE, fitDistance)`，`zoom > 1` 时按比例拉近，不再套 fit 下限。

- [ ] **Step 1: 写失败测试**

`zoom.test.ts`：
- `zoomToCameraDistance(1)` 仍为 `BASE_DISTANCE`；
- `zoomToCameraDistance(1, fit)` 当 `fit > BASE_DISTANCE` 时为 `fit`；
- `zoomToCameraDistance(2, fit)` 为 `fit / 2`；
- `zoomToCameraDistance(4, fit)` 为 `fit / 4`；
- 越界仍夹到 `MAX_ZOOM`（4） / `MIN_ZOOM`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @prismwright/renderer test -- zoom`
Expected: FAIL。

- [ ] **Step 3: 改 `zoom.ts` 与 `card-view.ts`**

`zoomToCameraDistance` 接受可选 `fitDistance`，基准取 `max(BASE_DISTANCE, fitDistance)`；`applyCameraDistance` 删掉 `Math.max(..., fitCameraDistance)`，改为 `zoomToCameraDistance(zoom, fitCameraDistance(...))`。更新注释：`zoom = 1` 整卡可见，`zoom > 1` 可裁切，400% 封顶。

- [ ] **Step 4: 跑渲染器测试与 typecheck**

Run: `pnpm --filter @prismwright/renderer test && pnpm --filter @prismwright/renderer typecheck`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/card-renderer/src/v1
git commit -m "feat(renderer): 预览缩放可放大到 400% 并裁切"
```

---

### Task 10: 右下角图层面板

**Files:**
- Modify: `apps/desktop/src/features/cards/InspectorPanel.tsx`
- Modify: `apps/desktop/src/features/layers/LayerList.tsx`
- Modify: `apps/desktop/src/features/cards/inspectorTabs.ts`
- Modify: `apps/desktop/src/i18n/locales/{zh-CN,en}/editor.json`
- Test: `apps/desktop/src/features/cards/__tests__/inspectorTabs.test.ts`
- Test: `apps/desktop/src/features/layers/__tests__/layerList.test.ts`（新建 SSR 冒烟，若可行）

**Interfaces:**
- Produces：右栏 = 上方检查器 + 下方常驻图层面板；`INSPECTOR_TABS` 仍为 `design/layers/effects/export`，但 `layers` 的展示文案改为「属性 / Properties」；`LayerList` 根节点可填满高度。

- [ ] **Step 1: 改页签文案与失败测试**

`editor.json` 的 `inspector.layers` 中文改「属性」、英文改「Properties」；`inspectorTabs.test.ts` 保持键顺序断言不变，新增断言文案不再出现「图层」（通过 i18n 读取或常量）。

- [ ] **Step 2: 改 `LayerList` 布局**

根节点 `flex min-h-0 flex-col`（去掉 `border-b`）；树容器从 `max-h-48` 改为 `min-h-0 flex-1 overflow-y-auto overflow-x-hidden`，让底部面板的剩余高度都由它滚动。

- [ ] **Step 3: 在 `InspectorPanel` 中加右栏上下分栏**

- 仅当 `hasFace && !usingDefaultBack && face` 时渲染竖向 `PanelGroup`：
  - 上 `Panel`：页签内容（原 `min-h-0 flex-1 overflow-y-auto` 内容）。
  - `PanelResizeHandle`：复用 `Splitter` 的视觉（8px 空气 + 悬浮绿线）。
  - 下 `Panel`：`<LayerList face={face} faceRef={faceRef} />`。
  - `autoSaveId="prismwright-right-dock"`；上默认 66%、min 30%；下默认 34%、min 20%、max 60%。
- 无卡面 / 默认卡背占位时，不渲染底部面板，内容区仍占满。
- `layers` 页签内容只保留选中层属性：`selectedLayer ? <LayerDetail section="properties" /> : 空态`，删掉页签内的 `LayerList`。
- 保持现有 `ConfirmDialog` 在面板组之外。

- [ ] **Step 4: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test -- inspectorTabs layer && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/features/cards apps/desktop/src/features/layers apps/desktop/src/i18n
git commit -m "feat(ui): 图层面板停靠右下角"
```

---

### Task 11: 修复图层拖拽父子命中

**Files:**
- Modify: `apps/desktop/src/features/layers/LayerTree.tsx`
- Modify: `apps/desktop/src/features/layers/drop.ts`
- Delete: `apps/desktop/src/ui/dnd-modifiers.ts`（若不再被引用）
- Test: `apps/desktop/src/features/layers/__tests__/drop.test.ts`
- Test: `apps/desktop/src/features/layers/__tests__/layerTree.test.ts`（新建，若可行）

**Interfaces:**
- Produces：`dropZoneAt(relativeY: number): DropZone`；`LayerTree` 使用 `useDraggable` + `useDroppable` + `DragOverlay`，指针命中按真实 DOM 矩形计算。

- [ ] **Step 1: 写 `dropZoneAt` 失败测试**

`drop.test.ts` 断言：
- `0` / `0.249` → `"top"`；
- `0.25` / `0.5` / `0.749` → `"middle"`；
- `0.75` / `1` → `"bottom"`。

- [ ] **Step 2: 实现 `dropZoneAt`**

在 `drop.ts` 导出纯函数；`LayerTree` 的三段判定改用它。

- [ ] **Step 3: 重写 `LayerTree` 拖拽**

- 去掉 `SortableContext` / `useSortable`；每行用 `useDroppable({ id })`，把手用 `useDraggable({ id })`。
- `DndContext` 里渲染 `DragOverlay`：跟随指针显示当前行文本的轻量行；原行 `opacity-50`。
- `onDragStart` 记录 `activeId`；`onDragMove` 用 `activatorEvent.clientY + delta.y` 取指针 y，遍历每行 `getBoundingClientRect()`，找包含该 y 的行；没有则保留上一次 `over`。用 `dropZoneAt((y - rect.top) / rect.height)` 求 zone；再调用 `resolveDrop(rows, activeId, overId, zone)`，返回 `null` 的目标不设高亮。
- `onDragEnd` 用本地 `over` 状态 + `resolveDrop` 落位；忽略 dnd-kit 的 `event.over`。
- 键盘拖拽保留 `KeyboardSensor` 与 `closestCenter` 兜底；指针拖拽不依赖 dnd-kit 的碰撞结果。
- 行上仍保留 `pointerWithin` 的 droppable 注册，供键盘与自动滚动使用。

- [ ] **Step 4: 删除无用修饰器**

若 `restrictToVerticalAxis` 不再使用，删除 `ui/dnd-modifiers.ts`；`ColorStops` 的 sortable 不动。

- [ ] **Step 5: 跑测试与 typecheck**

Run: `pnpm --filter @prismwright/desktop test -- drop effectStack && pnpm --filter @prismwright/desktop typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/features/layers apps/desktop/src/ui
git commit -m "fix(ui): 稳定图层拖拽的父子命中"
```

---

### Task 12: 全量验证与收尾

**Files:**
- Modify: `.superpowers/sdd/2026-11-28-gradient-palette-merge/progress.md`（ledger）
- No production files unless verification finds failures.

- [ ] **Step 1: 全量测试与 typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: 全绿。

- [ ] **Step 2: 用户要求的最终构建**

Run: `pnpm build`
Expected: exit 0，所有 workspace 构建成功。

- [ ] **Step 3: 记录验收命令与结果**

在 ledger 写：
- 每个任务的提交区间；
- `pnpm -r test` / `pnpm -r typecheck` / `pnpm build` 的结果；
- 遗留 minor（若有）。

- [ ] **Step 4: 最终提交（若 Step 1/2 有修复）**

```bash
git add -A
git commit -m "test: 全量验证与收尾"
```

---

## Self-Review

- **Spec coverage:** §5 数据模型 → Task 3；§6 迁移 → Task 3；§7.1 默认展开 → Task 4；§7.2 覆盖滚动条 → Task 7；§7.3 扁平滑块 → Task 5；§8 统一颜色控件 → Task 1/2；§9 间距与分割线 → Task 6；§10 预览缩放 → Task 8；§11 右下角图层面板 → Task 10；§12 拖拽命中 → Task 11；§13-15 影响/风险/验收 → Task 12。
- **Step scan:** 每个任务有失败测试、实现、验证、提交；没有 TBD。
- **Type consistency:** `resolveHoloGradient` / `holoIsActive` / `zoomToCameraDistance(zoom, fitDistance?)` / `dropZoneAt` 在任务间名字一致。
- **Review Focus:** 迁移、enabled、alpha、滚动条重算、缩放贴合点、拖拽三段命中均有对应测试任务；指针拖拽与右栏分栏由用户手动验收。
