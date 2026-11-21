# 刻纹合并到网格（设计）

- 日期：2026-11-21
- 状态：草案，待确认
- 仓库：`D:\Code\prismwright`
- 前置：`2026-11-20-balatro-holo-composite-design.md`（调色板合成 / 独立网格）

## 1. 背景

用户已经有两条线效果：

- **刻纹（`lattice`）**：相位效果（`role: "phase"`）。用 `latticeField` 的线族（families / angle / density / width）在 `holoPhase` 里给全息色带加几何刻线，也参与图片/文字的浮雕。
- **网格（`holoGrid`）**：色相效果（`role: "color"`）。固定的交叉网纹（x + 两条 ±45°），只加在 hue 上。

两条线效果职责重叠。用户要求：**删掉刻纹，网格保留，网格继承刻纹的全部可调参数**。产品还没用起来，不需要为旧数据做观感迁移。

## 2. 目标 / 非目标

### 做

1. 删除 `lattice` 效果：schema、Effect 联合、注册表、定长 uniform、`holoPhase` 里的相位加项、内容浮雕里的刻纹、编辑器菜单/文案、默认效果、测试。
2. `holoGrid` 继承刻纹的参数：`families`（原 count）、`angle`、`density`、`width`、`strength`、`offsetX`、`offsetY`。
   - 现有网格的 `size` 删除，改成 `density`（同一个「线频率」概念，刻度按刻纹原来的密度量纲）。
   - 网格的 `strength` / `offsetX` / `offsetY` 保留（刻纹也有同名参数）。
3. 网格的线数学改用刻纹的线族生成器 `latticeField`（它仍在 `shaders/common.ts`），作用从「相位」改为「色相加量」；刻纹的相位/浮雕集成删除。
4. 对旧 pack 里的 `lattice` 条目做**解析期丢弃**（不迁移、不升版本）：包能打开，旧刻纹效果直接消失。
5. 同步编辑器中英文案、默认效果、测试、小程序 bundle、设计/计划文档。

### 不做

- 不保留旧刻纹的相位观感（用户明确说可以直接删）。
- 不做 schemaVersion 迁移；旧刻纹只丢弃。
- 不新增第三种线效果。

## 3. 设计

### 3.1 网格参数

`HoloGridParams`：

| 字段 | 含义 | 默认 | 范围 |
|---|---|---|---|
| `families` | 线族数（原刻纹 count/families） | 刻纹原默认 | 1–4 |
| `angle` | 线族角度 | 刻纹原默认 | -180–180 |
| `density` | 线频率（原网格 size 的接替者） | 刻纹原默认 | 与刻纹一致 |
| `width` | 线宽 | 刻纹原默认 | 与刻纹一致 |
| `strength` | 色相加量强度 | 1 | 0–1 |
| `offsetX` / `offsetY` | 卡面 UV 平移 | 0 | -1–1 |

参数的量纲/默认值直接取刻纹原实现，避免「继承参数但刻度全变」。

### 3.2 网格数学

- 线值：`line = latticeField(vUv - offset, families, angle, density, width)`；
- 色相加量：`grid = line * strength`；
- 色带合成：`holo = holoHueShift(holo, grid)`；
- 叠色合成：`extraGrid = grid`，加进 `hsl.x`；
- 只改色相，不改亮度；蒙版/不透明度/祖先裁切语义不变。

### 3.3 删除刻纹

- `LatticeParamsSchema` / `LatticeParams` / Effect 联合分支 / index 导出 / 断言。
- 注册表的 `lattice` 条目、`LATTICE_MAX`、字段、packUniforms。
- `EffectUniformArrays` 的 `uLattice*`；`toEffectUniforms` 的刻纹打包。
- `shaders/common.ts`：`holoPhase` 里的刻纹循环、内容浮雕里的刻纹；`latticeField` 函数保留（网格用）。
- `base-material.ts` / 基础材质的刻纹 uniform（卡面原本也吃刻纹）。
- 编辑器的效果菜单（`EFFECT_KINDS`）、`effect.json` 的 `lattice` 文案、默认效果里引用刻纹的地方。
- 测试：schema/renderer/editor/store 中所有 lattice 用例。

### 3.4 旧数据

`LayerSchema.effects` 在解析前过滤掉 `kind === "lattice"` 的条目（preprocess），包照常打开、刻纹消失。不升 `CURRENT_SCHEMA_VERSION`。

### 3.5 UI / 文案

- 效果菜单只剩「网格」；面板：族数 / 角度 / 密度 / 宽度 / 强度 / 偏移 X / 偏移 Y。
- 中英文案：`holoGrid.*` 复用刻纹的参数名，去掉 `lattice.*`。

## 4. 风险

- **观感变化**：旧卡上的刻纹（相位刻线）会消失；新产品未使用，接受。
- **默认网格**：默认参数取刻纹默认，网格的默认观感会从现在的交叉网纹变成刻纹的线族；用户可调。
- **基础材质**：卡面原本可用刻纹，删除后卡面只剩 moire/gloss 等；需要确认默认卡面效果不依赖刻纹。

## 5. 待确认

1. 网格默认参数直接取刻纹默认，还是给一组「交叉网纹」默认（复刻现在网格的样子）？
2. 旧 pack 的刻纹采用「解析期丢弃」是否可以（不迁移、不升版本）？

## 6. 流程

确认后写实现计划：`docs/superpowers/plans/2026-11-21-lattice-to-grid.md`，按 schema → renderer → editor → verify/bundle 执行。
