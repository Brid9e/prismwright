# 调色板合成：叠色（HSL）+ 独立网格（设计）

- 日期：2026-11-20
- 状态：已实现（含后续改名与偏移）
- 产品命名：调色板合成叫「叠色」（数据值 tint）；公式参考 Balatro holo.fs，UI 与数据不使用来源名。
- 仓库：`D:\Code\prismwright`
- 相关提交：`f5fa7da`（调色板新增合成方式，第一版把叠色合成写死）、`5817cbf`（小程序 bundle 重建）

## 1. 背景与问题

卡片的镭射由图层效果 `palette`（调色板）驱动：色标决定全息颜色，相位来自视角。用户碰到两个问题：

1. 图层的「叠加(add)」会让整卡发亮；叠色的镭射不是加法，而是按内容对比度做 delta lerp + HSL 蓝偏。
2. 调色板合成只有一套写死的公式；用户希望**能选**「色带 / 叠色」，并且叠色这一套的常量可调。

第一版（`f5fa7da`）已经把 `palette` 效果加了 `composite: "palette" | "tint"`（旧的 `balatro` 在解析期落到 `tint`），但叠色的光照/网纹/蓝偏都是着色器常量。用户随后要求：

- **都做**：把「叠色合成」参数化（不只写死一种样式）；
- 把**网纹**拆成独立效果，能叠加到任意合成上（包括原来的色带）。

本设计就是这两件事的定稿依据。参数化半截代码已在工作区，尚未提交；独立网格尚未实现。

## 2. 目标 / 非目标

### 做

1. `palette` 效果的 `tint`（叠色）合成参数化：
   - 色相偏移倍率、饱和、提亮、蓝偏、delta 的基础/对比度/亮度、内置网格强度/密度；
   - 默认值 = Balatro `holo.fs` 的常量（现有观感不变）；
   - 只有 `composite = "tint"` 时在 UI 显示这些滑杆，色标隐藏。
2. 新增独立效果 **「网格」（`holoGrid`）**：
   - 交叉网纹（x 向 + 两条 ±45°）作为**色相**加量，作用于任意合成；
   - 参数：大小、强度、X/Y 偏移；每层最多 1 条；
   - 与 `palette` 的内置网格共用同一份 `holoGridValue`，避免两份数学漂移。
3. 同步：schema、注册表、编辑器字段/i18n、材质 uniform、着色器、测试、小程序 bundle。

### 不做（本轮）

- 叠色的**时间/每张牌种子的流动场**（`field_part1..3`、`time`、`holo.x/y`）。当前的色相相位仍来自我们的视角相位；`uTime` 只在导出时推进。这是下一轮独立设计。
- Foil / Polychrome / Negative 三个版本样式；先只做 Holo 的合成 + 网格。
- 实时预览动画（预览仍冻结在 time=0）。
- 强制改写图层的混合模式。

## 3. 现状与约束

- `palette` 效果 `scope: "layer"`：卡面片元不跑 `holoPhase/holoColor`，卡面上的调色板是空转；本特性只在图层上生效。
- 图层着色器可以拿到：
  - 卡面原图（`uFrontMap` + 卡面底图的 fit/offset/scale/rotation 变换 `uFaceMapMatrix/uFaceMapOffset`）；
  - 本层图片/文字内容（`imgC/imgA`、`textC/textA`）；
  - 蒙版权重 `mw`、不透明度 `uOpacity`、圆角 `card`、祖先裁切 `ancestorClip`、擦除 `erase`。
- 叠色合成的「内容」按以下优先级取：本层图片 → 本层文字 → 卡面原图；覆盖 alpha 取对应内容的 alpha（卡面原图时用 `mw * opacity * card * ancestorClip * erase * front.a`）。
- 图层的**混合模式**（正常/叠加/滤色/正片叠底/暗部颜色）与调色板合成是两层：叠色合成建议配「正常」；选「叠加」仍会整卡发亮。文档里写明，不做强制。
- 纹理单元已经接近上限（15/16）；新效果不新增采样器，只加标量/小数组 uniform。
- 颜色空间与常量：Balatro 常量按游戏色彩空间调过；我们沿用原值作为默认，允许用户用滑杆微调。

## 4. 设计

### 4.1 `palette` 参数

在 `PaletteParams` 上增加平铺字段（不嵌套对象，UI 字段系统按 key 直接生成）：

| 字段 | 含义 | 默认 | 范围 |
|---|---|---|---|
| `composite` | `palette` / `tint` | `palette` | 枚举 |
| `hue` | 相位 → 色相的倍率（`fract(phase * hue)`） | 0.036 | 0–0.2 |
| `sat` | 饱和度倍数 | 1.3 | 0–2 |
| `lift` | 向白提亮比例（`mix(L, 1, lift)`，等价于原 `0.6L+0.4`） | 0.4 | 0–1 |
| `tint` | 蓝偏：通道权重从 `(1,1,1)` 插值到 `(0.9,0.8,1.2)` | 1 | 0–1 |
| `deltaBase` | 基础混合权重 | 0.2 | 0–1 |
| `deltaContrast` | 内容对比度加成 | 0.3 | 0–1 |
| `deltaBright` | 内容亮度加成 | 0.1 | 0–1 |

公式：

```
hsl = HSL(0.5*content + 0.5*blue)
hsl.x = fract(hsl.x + fract(phase*hue) + independentGrid)
hsl.y = clamp(hsl.y * sat)
hsl.z = mix(hsl.z, 1, lift)
delta = deltaBase + deltaContrast*(hi-lo) + deltaBright*hi
delta = clamp(delta * uHoloMix * uHoloAlpha)
tinted = RGB(hsl) * mix(vec3(1), vec3(0.9,0.8,1.2), tint)
result = mix(content, tinted, delta)
```

默认值与现有写死实现逐项一致；参数只影响 `tint` 分支。

### 4.2 独立网格效果

新增效果 kind `holoGrid`：

- 角色：`color`；范围：`layer`；每层上限 1。
- 参数：
  - `size` 0.1–2，默认 0.79（与内置网格同密度）
  - `strength` 0–1，默认 1
  - `offsetX` / `offsetY` -1–1，默认 0（网纹在卡面 UV 上的平移）
- uniform：`uHoloGridCount`、`uHoloGridSize[1]`、`uHoloGridStrength[1]`、`uHoloGridOffsetX[1]` / `uHoloGridOffsetY[1]`（沿用定长数组 + 计数模式）。
- 应用位置：
  - **色带合成**：对 `holoColor` 得到的 `holo` 做 HSL 色相偏移 `holoGridValue(uv - offset, size) * strength`；
  - **叠色合成**：作为 `extraGrid` 加进 `hsl.x`；
  - 两者都只改色相，不改亮度；蒙版/不透明度照旧。
- 叠色本身不画网格；要网格就加这条「网格」效果（网格密度/强度/偏移都在这里）。

### 4.3 UI / i18n

- 调色板效果面板：
  - 合成方式（调色板/叠色）；
  - `palette`：色标；
  - `tint`：7 个滑杆（色相/饱和/提亮/蓝偏/三项 delta），色标隐藏；网格由「网格」效果提供。
- 新增效果菜单出现「网格」，面板四个滑杆（大小/强度/X 偏移/Y 偏移）。
- 中英文案补 `effect.json`；字段可见性按 `composite` 过滤。

### 4.4 涉及文件

- schema：`packages/card-schema/src/types.ts`、`schema.ts`（`PaletteParams` 字段、`HoloGridParams` + Effect 联合）
- 渲染器：
  - `effects/registry.ts`（palette 字段、holoGrid 注册、`HOLO_GRID_MAX`）
  - `effects/uniforms.ts`（网格数组打包）
  - `materials/layer-material.ts`（palette uniform、fx 透传）
  - `shaders/common.ts`（`holoGridValue`、HSL 工具）
  - `shaders/layer.ts`（palette 参数 uniform、叠色合成、独立网格的应用）
- 编辑器：`effect.json`（zh/en）；无需改 `EffectStack`（现有 select/slider 通用）
- 测试：schema 默认值、材质 uniform、着色器字符串、uniform 打包、i18n
- 小程序：`apps/miniprogram` 的 `lib/prismwright.js` 重建（monorepo）

## 5. 备选与取舍

- **把整个叠色合成做成一条独立效果**：会让「调色板」与「叠色」在两个入口，用户不知道箔的颜色归谁管；且 palette 已有唯一的槽位。否决。
- **把网格塞进现有的刻纹（lattice）效果**：刻纹是明暗/浮雕，网格是色相加量，角色不同；塞进去会让刻纹的亮度语义变脏。否决。
- **先移植 field/time 再参数化**：用户当前要的是「可调的合成 + 独立网格」；field/time 是另一套相位引擎，先把可调的合成稳定下来。延后。

## 6. 测试

- schema：`PaletteParamsSchema` 默认值；`holoGrid` 参数解析/默认值。
- 渲染器：palette 参数 → uniform；`uHoloGrid*` 打包；着色器包含 `hslTint` / `holoGridValue` / 独立网格分支；材质混合仍走 normal。
- 编辑器：i18n 字段键齐全；注册表字段可见性；类型检查。
- 小程序：重建 bundle，969 测试。
- 手工：一张卡上分别选「色带 / 叠色」，调网格强度/大小；用「正常」混合；确认亮部不过曝、蒙版/不透明度仍生效。

## 7. 待确认

1. 叠色合成的 7 个参数是否全要，还是有想删/想加的（比如「蓝偏」是否拆成预混 + 通道权重两项）？
2. 独立网格的默认值 0.79/1 是否可以；需不需要再加角度/线宽？
3. 内置网格默认开、独立网格默认关——这个默认是否可以（避免默认叠加两层）？
4. 预览仍静态（time=0）、只有导出动，是否接受？

## 8. 流程

确认本设计后，再写实现计划（`docs/superpowers/plans/2026-11-20-balatro-holo-composite.md`），按任务拆 schema → 渲染器 → 注册表/UI → i18n → 测试 → bundle，再执行。
