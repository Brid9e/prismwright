# 渐变与调色板合并设计

日期：2026-11-28
状态：方向已确认（数据层合并），等待设计评审
范围仓：`D:\Code\cardbara-editor`
取代：`2026-11-28-card-face-to-layers-design.md` 中「调色板 / 渐变是两个独立效果」的部分

## 1. 背景

卡面降级为纯图层后，全息效果被拆成两条独立效果：

- `gradient`（渐变，相位组）：斜坡形态、密度、角度、扭转、相位全局项；
- `palette`（调色板，颜色组）：色标、合成方式、叠色参数，并决定该层是否出全息。

界面上因此有两个开关、两次「添加效果」，用户要先加调色板再加渐变才能得到一张完整的全息层。产品原型里只有一条「渐变」。用户要求：把两者合并成一条「渐变」，色标 / 合成参数在上，原渐变参数在下，整齐默认 1。

## 2. 目标

1. 数据层只保留一条「渐变」效果，同时承载色标与相位参数。
2. UI 相位组只剩「渐变」一项；展开后先显示色标 / 合成方式 / 叠色参数，再显示模式 / 密度 / 角度 / 扭转 / 相位全局项 / 整齐。
3. `straight`（整齐）默认值改为 1：新建渐变默认色带笔直等距。
4. 旧系列自动迁移，不要求用户手工重配。
5. 开关、删除、撤销、槽位校验都只面对一条效果。
6. 所有效果默认展开：进入效果页签即可看到全部参数，新增效果也自动展开。
7. 滚动区域改用覆盖式滚动条：滚动条浮在内容上、不占布局宽度，悬停 / 滚动时显现，静止后淡出。
8. 所有颜色字段统一使用同一个面板内取色器：自带色相 / 明度 / 透明度，去掉系统取色框、自绘吸管与独立的透明度滑杆。
9. 编辑区间距统一到 4pt 刻度，删除行间 / 分组间不必要的分割线。
10. 预览缩放允许放大到 400%：超过整卡贴合点后继续放大并裁切边缘，不再出现「数字涨、画面不动」。
11. 图层面板停靠到右下角并常驻，像 Photoshop 一样始终可见；原「图层」页签改为「属性」，只显示选中层的属性。
12. 修复图层拖拽的父子命中：拖拽行不再跟着指针遮住目标，父子「放进里面」稳定命中。

## 3. 非目标

- 不改着色器的相位 / 色带算法；合并只改数据形状与入口。
- 不重命名渲染器的色板工具（`palette.ts`、`paletteUniforms`）——它们描述色标表本身，不是效果种类。
- 不改摩尔纹、网格、光泽、蒙版、图片效果。
- 不新增「色带 / 相位」分组标题或二级折叠；字段按用户要求平铺。
- 不引入第三方取色器运行时；用现有 Radix Popover + 自绘滑块实现。
- 不保留画布吸管：移除从预览取色的整套交互，颜色只能在新取色器里改。
- 拖拽优先修现有 dnd-kit 的用法，不先换库；若真机验收仍不稳定，再另起替换计划。

## 4. 方案

选定 **A：数据层合并**。

- 把 `PaletteParams` 的全部字段并入 `GradientParams`；删除 `palette` 效果种类、`PaletteParams`、`resolvePalette`。
- schema 版本从 9 升到 10；加载旧系列时把每个效果列表里的第一条 `gradient` 与第一条 `palette` 合成一条 `gradient`。
- `gradient` 角色仍为 `phase`，槽位上限仍为 1。

不选 **B：仅界面合并**。两条效果若仍留在数据里，开关 / 删除 / 新增 / 撤销都要同时操作两条 id；只有一个条目的旧数据、第二条被手动删除、拖拽排序等边界会持续产生歧义，后续每个功能都得记住「调色板和渐变是一对」。一次迁移把状态收敛成一条，代价更小。

## 5. 数据模型

### 5.1 合并后的 `GradientParams`

字段顺序即 UI 展示顺序：

1. 色标与合成：`composite`、`colors`、`hue`、`sat`、`lift`、`tint`、`deltaBase`、`deltaContrast`、`deltaBright`（原 `PaletteParams` 原样迁入）；
2. 斜坡：`mode`、`count`、`angle`、`twist`、`twistSeed`；
3. 相位全局项：`distortionStrength`、`phaseSpeed`、`tiltGain`、`noiseStrength`、`transition`、`offsetX`、`offsetY`；
4. `straight`。

`Effect` 联合、`EffectSchema`、`EFFECT_KINDS`、`EFFECT_REGISTRY` 删除 `palette` 分支；`EffectKind` 随之收窄。`PaletteComposite` 类型保留，因为它是色带合成方式的名称，不是效果种类。

### 5.2 默认值

- `straight`：schema 默认从 0 改为 1。旧数据里已落盘的 `straight` 值不改写；只有新建效果、以及迁移中需要补渐变参数的旧调色板层会得到 1。
- `colors`：schema 默认仍为 `[]`（空色标 = 不出全息）；「添加渐变」走注册表 `defaultParams`，预置金 → 蓝 → 紫三色。
- `composite` 等叠色参数：沿用原默认值。
- `DEFAULT_GRADIENT_PHASE` 不变（它只覆盖相位全局项）。

### 5.3 渲染器解析

- `resolveGradient(effects)`：仍返回第一条 `gradient`（**不论 enabled**），供相位全局项读取。
- 新增 `resolveHoloGradient(effects)`：返回第一条 **enabled** 的 `gradient`，供色标 / 合成方式 / `uHasHolo` 使用。
- `paletteIsActive` 改为 `holoIsActive(params)`：`colors.length > 0` 或 `composite === "tint"` 即出全息。材质侧不再单独 OR `paletteComposite`。
- 渐变斜坡的定长数组仍由 `pick(effects, "gradient", GRADIENT_MAX)` 打包，只取 enabled 条目；合并后行为不变。

## 6. 迁移（v9 → v10）

对每张卡面（`cards`、`hiddenCards`、`back`）的每个效果列表（面级 + 每一层递归）执行：

1. 找出第一条 `gradient` 与第一条 `palette`。
2. 两条都存在：
   - `params = { ...gradient.params, ...palette.params }`（两组键不重名）；
   - `id` 取渐变条目的 id，位置取两者中较靠前的下标；
   - `enabled` 取 `palette.enabled`——用户感知的是「这层有没有全息」。
3. 只有 `palette`：
   - `params = { ...默认渐变参数, ...palette.params }`；默认参数含 `straight: 1`；
   - `id` / 位置 / `enabled` 取调色板条目。
4. 只有 `gradient`：
   - `params = { ...gradient.params, colors: [] }`；空色标保持「这层不出全息」，与迁移前一致；
   - `id` / 位置 / `enabled` 取渐变条目。
5. 同一列表里多出的调色板 / 渐变条目：只保留合并后的第一条，其余丢弃。渲染器本来就只读第一条（`GRADIENT_MAX = 1`），丢弃不会改变画面。
6. 迁移幂等：迁移后列表里不再有 `palette`，再次执行无变化。

已知的唯一可见变化：**只有调色板、没有渐变**的旧层会补上默认斜坡（整齐 = 1）；这是合并的必要代价，记录在此。旧层若原本有渐变，`straight` 保持落盘值，不会被强制改成 1。

`.card` 单卡导入走 `migrateCardFace`，同一个合并函数必须在该入口也执行；`migrateCardFace` 变成「v8→v9 + v9→v10」两段。

## 7. UI

- 相位组只剩「渐变」；添加菜单里没有「调色板」。
- 展开后的字段顺序见 §5.1：先色标 / 合成，后斜坡 / 相位项，`straight` 最后。
- 色标拾色仍写回本效果的 `colors`；`PreviewPanel` 的判定从 `kind === "palette"` 改为 `kind === "gradient"`。
- 默认卡背改为只创建一条渐变效果。
- i18n：`gradient` 命名空间补齐原 `palette.*` 的字段文案；删除 `palette` 块。合成方式选项文案改为「色带 / 内容着色」，不再出现「调色板」字样。
- `straight` 的滑块说明保持「只留斜坡、去掉扰动」；默认值改为 1。

### 7.1 所有效果默认展开

`EffectStack` 的展开态从「记录已展开的 id」改为「记录已折叠的 id」：

- 初始集合为空 = 所有效果展开；
- 新增效果天然展开（不在折叠集合里）；
- 用户点箭头才把 id 放进折叠集合；
- 效果被删除时其 id 留在集合里无害（id 不复用）。

这样不需要在 `effects` 变化时做「把新 id 加进展开集合」的同步，也不会因为撤销 / 重做把展开态改回去。

### 7.2 覆盖式滚动条

新增共享组件 `ui/ScrollArea.tsx`：

- 外层 `relative min-h-0`，内层保留原生 `overflow-y-auto` 与键盘滚动，只隐藏原生滚动条（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`）。
- 覆盖一条绝对定位的滑块：宽度 6px、`rounded-full`、`bg-line`，`pointer-events` 只在可拖动区域开启；滑块高度按 `clientHeight / scrollHeight` 计算，最小 24px。
- 悬停滚动区、滚动、拖动时滑块显现；约 800ms 无交互后淡出。轨道透明，不画槽。
- 拖动滑块按比例写回 `scrollTop`；点击轨道跳转到对应位置（可选，实现成本低，一并做）。
- 用 `ResizeObserver` 观察滚动容器与内容包装层，内容高度变化（展开 / 折叠 / 换卡）后重算；滚动事件用 rAF 合帧。
- 内容不需要滚动时滑块不渲染。

几何计算抽成纯函数 `scrollbarMetrics(...)` 单测；组件本身做 SSR 冒烟（jsdom 无布局，量不到真实高度）。首轮应用到检查器主体、左栏卡片库、设置页与对话框这些主滚动区；小浮层（下拉、右键菜单）保持原生。

### 7.3 滑块：扁平轨道 + 同高手柄

- 轨道去掉 `.inset-control` 内阴影与 `border border-line-soft` 边框，只留纯色 `bg-track`；已滑过部分仍是 `bg-track-fill`。
- 手柄高度改为与轨道一致（`h-control`，24px），宽度保持 8px、`rounded-chip`；去掉 `thumb-shadow` 投影，与扁平轨道一致。
- 新取色器里的色相 / 透明度滑杆复用同一套轨道与手柄样式，不再出现细轨 + 高出轨道的小手柄。
- 禁用态仍由 Root 统一降透明度 + `cursor-not-allowed`；可访问名与键盘行为不变。

## 8. 统一颜色控件

### 8.1 现状

- `ColorField`（单色）：原生 `<input type="color">` + Radix 透明度滑杆 + 百分比，固定 160px；
- `ColorStops`（渐变色标）：每行一个系统取色块 + 自绘吸管按钮 + 透明度 range + 百分比 + 位置 + 删除；
- 吸管另有一整套「预览覆盖层 → 取像素 → 写回」流程（`uiStore.ColorPickRequest` / `PreviewPanel` / `pickColor`）。

原生取色框弹系统面板、样式不可控，透明度和吸管又各占一行宽度；两个颜色控件的行为也不一致。

### 8.2 新组件

新增 `ui/ColorPicker.tsx`（含 `ColorSwatch` 触发器与 `ColorPickerPopover`）：

- 触发器是一个带棋盘格的色块按钮，尺寸 `h-6 w-7`；点开在面板内弹出取色器。
- 取色器内容：饱和度 / 明度二维面板、色相滑杆、透明度滑杆、十六进制输入。
- 透明度写进色值本身（`#rrggbbaa`；100% 仍输出 6 位），沿用 schema 的 `withAlpha` / `alphaOf`。
- 棋盘格用现有 `--color-checker-a` / `--color-checker-b` token；不新增色值。
- 弹层用 Radix Popover（新增 `@radix-ui/react-popover`，与现有 Radix 控件同一体系，不引入完整 UI 框架）。
- 键盘可达：色块按钮有可访问名与 `aria-haspopup`；色相 / 透明度用 Radix Slider（轨道与手柄按 §7.3 的扁平同高样式）；二维面板可聚焦并用方向键微调饱和度 / 明度；Esc 关闭。
- 颜色换算（hex ↔ HSV、alpha 合成、非法输入归一）抽成纯函数 `ui/color-picker-math.ts`，单测覆盖；组件本身做 SSR 冒烟。

### 8.3 字段改造

- `ColorField`：去掉原生取色框、透明度滑杆与百分比，改成「色块 + 十六进制文本」的单行按钮，点击开取色器。宽度从 160px 缩到内容宽。
- `ColorStops` 每一行：保留拖动柄、色块、位置百分比、删除；删掉吸管按钮、透明度 range、透明度百分比。透明度在取色器里改。
- 所有颜色入口统一走 `ColorField` / `ColorPicker`：卡面底色、文字色、描边色、投影色、光泽色、图蒙版颜色、渐变色标。
- 删除吸管整套链路：`ColorPickRequest`、`uiStore.colorPick` / `requestColorPick` / `resolveColorPick`、`PreviewPanel` 的取色覆盖层与底图取像素、`features/effects/pickColor.ts`、`ColorStops.onPick`、`EffectStack.onPickColor`、`LayerDetail` 的接线与相关 i18n 键。擦除画笔流程不动。
- `toSixDigitHex` 若只服务于原生取色框，一并删除；若新取色器的十六进制输入仍要用，则保留并改注释。

### 8.4 取舍

| 取舍 | 理由 |
| --- | --- |
| 不引入 `react-colorful` 等库 | 体积极小但透明度仍需自绘；沿用 Radix + Tailwind 可保持控件系统一致 |
| 去掉画布吸管 | 新取色器在面板内完成取色；吸管占用一行宽度，且依赖预览覆盖层，边界多 |
| 行内不再显示透明度百分比 | 色块棋盘格能看出透明；精确值在取色器内看 |
| 十六进制文本仍显示 | 单色字段没有透明度滑杆后仍有可读值；渐变色标行太窄，只留色块 |

## 9. 编辑区间距与分割线

### 9.1 间距

只使用设计系统的 4pt 刻度：4 / 8 / 12 / 16 / 24。

- 面板内容外边距：12（`p-3`）；卡片之间：8（`gap-2`）。
- `SectionCard` 标题栏与内容区统一 12 横向内边距（现在标题 8、内容 12，左缘不齐）。
- 卡片内部字段行横向不再叠加内边距：`PropertyRow` 改为 `px-0`，由所在卡片内容区给 12；顶层没有卡片的属性区自己补 `px-3`。
- 字段行纵向间距 4；标签与控件 8；分区内部 12；分区之间 8。
- 去掉编辑区里的 2 / 6 / 10px 间距类：`pt-0.5`、`gap-1.5`、`py-1.5`、`px-2.5` 等，一律落到最近的 4 / 8 / 12。
- 效果行、分组标题、添加按钮的内容左缘与卡片标题一致；行悬停底色用 `-mx-3 px-3` 延伸到卡片边缘，内容仍对齐。

### 9.2 分割线

只保留结构性边界：

- 保留：顶栏下缘、左右栏与舞台的分界、检查器头部 / 页签栏下缘（滚动区起点）、输入框与按钮自身描边。
- 删除：效果条目之间、效果角色分组之间、`CardFaceFields` 底部、图层列表与图层详情之间、`AddEffectMenu` 上下的 `border-b` / `border-t`。
- `SectionCard` 的外框保留（它是分组容器，不是行间分割线）。
- 删除分割线后靠 8 / 12 的间距和分组标题区分层级，不再用一条线切每一行。

### 9.3 组件落点

- `ui/Section.tsx`：标题栏 `px-3`；内容区 `px-3 pb-3`；标题栏高度 `h-row`。
- `ui/PropertyRow.tsx`：横向 `px-0`；行高 `min-h-row`；标签与控件 `gap-2`。
- `features/effects/EffectStack.tsx`：去掉条目 / 分组底边线；分组间 12、条目间 4；标题 / 行 / 添加菜单统一 `-mx-3 px-3`；`py-1` 改为 `py-2` 或在卡片内不再叠加上下内边距。
- `features/layers/LayerDetail.tsx`、`features/layers/TextDetail.tsx`、`features/cards/CardFaceFields.tsx`：去掉外层 `py-1` / `p-2` 重复内边距与 `border-b`；输入框统一 `h-control` + `border-line-soft`。
- `features/cards/InspectorPanel.tsx`：内容区统一 `p-3` + `gap-2`，子视图不再各自加 `p-2`。
- `features/layers/LayerList.tsx`：去掉根节点 `border-b`，列表与详情靠 12 间距分开。

## 10. 预览缩放：允许放大到 400% 并裁切

现状：`applyCameraDistance` 取 `max(缩放距离, 整卡贴合距离)`，放大到贴合距离后相机被钉住，百分比继续涨但画面不动。用户要求允许继续放大并裁切边缘，上限 400%。

- `fitCameraDistance` 仍用来保证 `zoom === 1` 时整张卡可见：基准距离改为 `max(BASE_DISTANCE, fitDistance)`。
- 相机距离改为 `基准距离 / clampZoom(zoom)`；`zoom > 1` 后不再套贴合下限，超过贴合点即平滑裁切，不再有「数字涨、画面不动」。
- `MAX_ZOOM` 保持 4（400%），`MIN_ZOOM` 保持 0.5；重置视角仍回到 `zoom = 1`，整卡可见。
- 宽高比很宽的卡在 `zoom > 1` 时会裁切，这是本次取舍；`zoom = 1` 仍保证完整。
- `zoomToCameraDistance` 增加可选 `fitDistance` 参数（或等价的纯函数），单测覆盖：
  - `fitDistance < BASE_DISTANCE` 时与旧行为一致（zoom 1 = BASE，zoom 4 = BASE/4）；
  - `fitDistance > BASE_DISTANCE` 时 zoom 1 = fit，zoom 2 = fit/2；
  - 超出 `[MIN_ZOOM, MAX_ZOOM]` 仍夹取。
- 不加上限之外的缩放（>400%）与平移；先解决「放大到贴合点就停」。

## 11. 右下角图层面板（Photoshop 式）

### 11.1 结构

- 右栏改为上下两段：上方是检查器（卡名 / 页签 / 当前页内容），下方是常驻的**图层面板**。
- 两段之间用竖向 `PanelResizeHandle` 分隔，可拖高度；默认 34%，最小 20%，最大 60%，`autoSaveId` 持久化。
- 图层面板只在「有可编辑卡面且不是默认卡背占位」时出现；无卡面 / 使用默认卡背时隐藏，检查器占满整栏。
- 底部面板复用 `LayerList`：标题「图层」+ **选中层属性**（混合模式下拉 + 一个图层不透明度）+ 一排添加图标 + 可滚动的图层树。树不再写死 `max-h-48`，改为 `min-h-0 flex-1` 填满面板并滚动。
- 选中层属性直接放在图层面板顶部，像 PS：只保留 `blend` 与 `opacity`；`holoMix` / `holoAlpha` 的 UI 控件删除（数据字段保留在 schema 里，渲染器继续用默认值，避免破坏旧系列）。
- 图层名不再占属性行：**双击行名**或右键「重命名图层」进入行内编辑；回车 / 失焦提交，Esc 取消。
- 添加动作收成一排图标（图片 / 文字 / 图层），删除「添加底图」长按钮。
- 原「图层」页签更名为「属性」，且**只对文字层显示**，内容只剩 `TextDetail`（字体 / 字号 / 颜色 / 描边 / 投影）；普通层的属性已在图层面板顶部。页签顺序为 设计 / 属性（仅文字层）/ 效果 / 导出。
- 布局模式切换不改这个上下比例；紧凑布局下仍保留图层面板，只是高度由用户/默认值决定。

### 11.2 落点

- `features/cards/InspectorPanel.tsx`：在页签内容与底部面板之间插入竖向 `PanelGroup`；移除 `layers` 页签里的 `LayerList`；`layers` 页签只渲染 `TextDetail`，并按选中层是否为文字层过滤页签。
- `features/layers/LayerList.tsx`：根节点 `flex h-full min-h-0 flex-col`；顶部渲染混合下拉 + 透明度滑杆；添加动作改 `IconButton` 图标行；树容器 `min-h-0 flex-1`；管理行内重命名状态。
- `features/layers/LayerDetail.tsx`：只剩效果栈（`section` prop 删除），名称 / 混合 / 透明度的旧属性分支删除。
- `features/layers/LayerTree.tsx`：行支持双击重命名与 `RenameInput`。
- `features/cards/inspectorTabs.ts`：`layers` 的展示文案改为「属性」；`INSPECTOR_TABS` 顺序不变，标签变。
- `ui/contextMenuModel.ts`：图层右键菜单新增「重命名图层」。
- i18n：`editor.inspector.layers` 中文改「属性」，英文改「Properties」；`layer.action.rename` 补「重命名图层 / Rename layer」；删除不再使用的 `action.addBackground`、`field.name`、`field.holoMix`、`field.holoAlpha`、`section.detail`、`section.composite`。

## 12. 拖拽父子命中

### 12.1 现状与原因

`LayerTree` 用 `SortableContext` + `useSortable`，被拖行会跟着指针移动，于是：

- 指针下面经常是**被拖行自己**的矩形，`pointerWithin` 命中自身或它的子树，`resolveDrop` 返回 `null`，看起来就是「怎么都放不进去」；
- 指针落在行间空隙时 `pointerWithin` 为空，退回 `closestCenter`，而它按被拖行中心找最近行，不是按指针，高亮会跳错行；
- 行在拖拽中被排序变换，`event.over.rect` 也在动，三段判定跟着漂。

### 12.2 修法（保留 dnd-kit）

- 去掉 `SortableContext` / `useSortable`。改用 `useDraggable`（把手）+ `useDroppable`（整行），并用 `DragOverlay` 渲染一个跟随指针的轻量行预览；原行留在原位半透明。被拖行不再遮住目标。
- 命中改为**按指针真实位置**：在 `onDragMove` 里取指针 y，与各行 `getBoundingClientRect()` 比较，取包含该 y 的行；落在行间空隙时保留上一次有效目标，不跳到 `closestCenter`。
- 排除非法目标：被拖行自身及其子树不参与命中，高亮只在合法落点上出现；松手仍由 `resolveDrop` 复核。
- 三段判定抽成纯函数 `dropZoneAt(relativeY): "top" | "middle" | "bottom"`（上 25% / 中 50% / 下 25%），单测覆盖边界。
- 键盘拖拽保留 dnd-kit `KeyboardSensor` + `closestCenter` 兜底；指针拖拽不再依赖它的碰撞结果。
- 若真机验收仍出现「抓不住 / 放不进」，再评估替换拖拽库；本次先修正用法。

### 12.3 验收

- 把任意层拖到另一层的中段：高亮整行，松手成为其子层。
- 拖到上 / 下缘：出现 0.5px 插入线，松手同级重排。
- 拖到自己的子树：不出现高亮，松手无操作。
- 指针在行间空隙停顿：高亮保持在上一个有效行，不跳走。
- 深层嵌套 + 左栏窄宽度下仍可把层拖进父层。

## 13. 影响面

- `packages/card-schema`：`types.ts`、`schema.ts`、`migrate.ts`、`defaults.ts`、`effects.ts`、`index.ts`、测试。
- `packages/card-renderer`：`effects/registry.ts`、`effects/uniforms.ts`、`mapping.ts`、`materials/layer-material.ts`、测试。着色器不动。
- `apps/desktop`：`features/default-back`、`features/effects/EffectStack`（主要靠注册表，改动小）、`features/preview/PreviewPanel`、`store/packStore` 的数组拷贝注释、i18n、测试。
- 颜色控件：新增 `ui/ColorPicker.tsx` 与 `ui/color-picker-math.ts`；改 `ui/ColorField.tsx`、`ui/ColorStops.tsx`；删 `features/effects/pickColor.ts` 与 `uiStore` 的取色请求；改 `PreviewPanel`、`LayerDetail`、`EffectStack`、`CardFaceFields`、`TextDetail` 的接线；样式表加棋盘格类；新增 `@radix-ui/react-popover`。
- 滑块：`ui/Slider.tsx` 与 `styles/base.css`（`.inset-control` 仍可能被其它凹槽复用，只从滑轨移除）改扁平轨道、同高手柄；`ui/__tests__/slider.test.ts` 同步。
- 不需要动资源收集 / 缩略图 / 导出流程：它们只按效果列表通用遍历。
- 间距与分割线：`ui/Section.tsx`、`ui/PropertyRow.tsx`、`features/effects/EffectStack.tsx`、`features/layers/LayerDetail.tsx`、`features/layers/TextDetail.tsx`、`features/layers/LayerList.tsx`、`features/cards/CardFaceFields.tsx`、`features/cards/InspectorPanel.tsx` 与相关 SSR 测试。
- 预览缩放：`packages/card-renderer/src/v1/zoom.ts`、`card-view.ts` 与 `zoom.test.ts`；`PreviewPanel` 的百分比 / 按钮上限不变（已是 `MAX_ZOOM = 4`）。
- 右下角图层面板：`features/cards/InspectorPanel.tsx`、`features/layers/LayerList.tsx`、`features/cards/inspectorTabs.ts`、i18n、相关 SSR / 页签测试。
- 拖拽命中：`features/layers/LayerTree.tsx`、`features/layers/drop.ts`（新增 `dropZoneAt`）、`ui/dnd-modifiers.ts`（若不再需要竖直限制则删除）、相关单测。

## 14. 风险与取舍

| 风险 | 取舍 |
| --- | --- |
| 只有调色板的旧层补上默认斜坡 | 接受；这是合并后「一条渐变」的自然结果，且整齐 = 1 让它接近纯色带 |
| 旧层「渐变关闭、调色板开启」时合并后斜坡会重新生效 | 接受；该组合在 UI 里要手动分两步才能造出，合并后开关语义是「整条全息」 |
| schema v10 使旧版编辑器无法打开新系列 | 本地优先、无云同步；与 v9 升级同一策略 |
| 一次迁移改动面大 | 用表驱动迁移测试覆盖：双有 / 仅调色板 / 仅渐变 / 多层 / 卡背 / 隐藏卡 / 幂等 |
| 自绘取色器的可访问性与弹层定位 | 色相 / 透明度复用 Radix Slider；二维面板补方向键；弹层用 Radix Popover 的碰撞检测 |
| 去掉吸管后没有「从画面取色」 | 用户明确要求去掉；颜色可在取色器里用色相 / 明度调到目标色，必要时再补拾色能力 |
| jsdom 无布局，弹层 / 棋盘格量不到 | 几何与换算走纯函数单测；外观由用户真机验收 |
| 去掉分割线后层级变弱 | 用分组标题 + 8 / 12 间距建立层级；先删行间线，保留卡片外框与面板边界 |
| 缩放不再保整卡可见，宽卡放大后会裁边 | 这是用户选的「放大并裁切」；`zoom = 1` 仍保证整卡可见，重置视角回到 1 |
| 渲染器 zoom 语义变化影响其它消费方 | 仅本仓桌面端消费；小程序仓不在本次范围，升级时需复核其预览取景 |
| 右栏上下分栏 + 横向分栏嵌套，窄窗口下高度可能不足 | 底部面板最小 20%、默认 34%；紧凑布局仍可拖；内容区各自 `min-h-0` |
| dnd-kit 指针命中依赖 DOM 测量，jsdom 测不到 | 三段判定与非法目标过滤抽纯函数单测；真实拖拽由用户手动验收 |
| 拖拽修复后仍不稳定 | 本次先修用法；若真机仍失败，记录具体操作并另起计划替换拖拽库 |

## 15. 验收

- 单元测试：schema、迁移、解析器、注册表、uniform、mapping、材质、编辑器 UI、颜色换算、i18n 键完整性。
- 全量 `pnpm build` 绿（用户要求只跑构建，不启 dev）。
- 用户手动验收：旧系列打开、相位组一条「渐变」、色标在上渐变在下、整齐默认 1、添加 / 删除 / 撤销正常。
- 用户手动验收：所有效果默认展开；新增效果自动展开；覆盖式滚动条在检查器 / 左栏 / 设置 / 对话框表现一致。
- 用户手动验收：所有颜色字段点开同一个面板内取色器；色相 / 明度 / 透明度 / 十六进制可用；行内不再有原生取色框、吸管按钮、独立透明度滑杆。
- 用户手动验收：滑块轨道无边框 / 无内阴影，手柄与轨道同高且无投影。
- 用户手动验收：检查器 / 效果页 / 图层页的左缘对齐，间距只有 4 / 8 / 12；效果条目、分组、图层列表之间不再有分割线。
- 用户手动验收：预览缩放能连续放大到 400%，超过整卡贴合点后边缘被裁切，不再出现「数字涨画面不动」。
- 用户手动验收：右栏底部常驻图层面板，可拖高度；「属性」页签只显示选中层属性，图层树只在右下角。
- 用户手动验收：图层拖拽中 / 上 / 下三段稳定命中；拖进父层不再被自身遮挡；拖进自己子树不出现落点。
