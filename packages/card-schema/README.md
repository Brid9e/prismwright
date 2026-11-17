# @cardbara/schema

Card Editor 的**数据层**包：纯 TypeScript + [zod](https://zod.dev/)，零 UI / IO 依赖。
它定义了 `pack.json` 的完整数据模型、运行时校验、默认值工厂与版本守卫，是全部持久化
数据的单一事实来源。

## 用途

- 提供 `pack.json` 的类型契约与 zod 校验；
- 集中定义所有字段默认值（新建实体时自动补全）；
- 作为载入入口 `parsePack`，挡住版本过新的数据并校验为当前版本。

## 导出结构

所有符号统一从包根导入（`import { ... } from "@cardbara/schema"`），共七组：

| 组别 | 符号 | 说明 |
|---|---|---|
| types | `Rarity` `BlendMode` `MaskMode` `MaskArrangement` `PatternMode` `ColorStop` `Layer` `CardFace` `Card` `Pack`，以及效果栈的 `EffectRole` `EffectKind` `EffectBase` `Effect` `EffectParams` 与八种效果参数接口（`GradientParams` `LatticeParams` `MoireParams` `GlossParams` `PaletteParams` `MaskPresetParams` `MaskImageParams` `ImageParams`） | 手写 TS 类型 |
| schema | `HEX_COLOR` 及十九个 zod 校验器（`RaritySchema` … `PackSchema`、`EffectSchema` 与各 `*ParamsSchema`，含 `PaletteParamsSchema` `ImageParamsSchema`） | zod 校验器 |
| stops | `evenlySpacedStops` `DEFAULT_PALETTE` `DEFAULT_STOPS` `DEFAULT_GRADIENT_PHASE` | 色标工具与默认调色板、渐变相位默认 |
| defaults | `newId` `createLayer` `createCard` `createCardFace` `createEmptyPack` | 默认值工厂 |
| migrate | `CURRENT_SCHEMA_VERSION` `migrate` `parsePack` | 版本守卫与加载 |
| tree | `flattenLayers` `findLayerById` `detachLayer` `ancestorChain` `exceedsNestDepth` 等 | 图层树工具 |
| effects | `resolveImageMask` `resolveImage` `resolveGradient` `resolvePalette` | 效果查询 |

> 手写类型与 zod schema 互为镜像，一致性由 `schema.ts` 末尾的**编译期双向可赋值断言**
> 保证，任一侧漂移都会在 `tsc` 阶段报错。

## `pack.json` 结构

顶层即一个 `Pack`：系列身份、系列级背面、普通 / 隐藏卡片列表，以及若干保留字段。

```jsonc
{
  "schemaVersion": 7,
  "editorVersion": "v1",        // 创建该系列时的编辑器版本（工具版本，非数据格式版本）
  "id": "8f3c…",
  "name": "星辰之约",
  "notes": "",
  "back": null,                 // CardFace | null
  "cards": [
    {
      "id": "c1",
      "num": 1,                 // 非负整数，展示为 e1、e2…
      "name": "星河",
      "notes": "",
      "rarity": "common",       // common | rare | epic | legendary，仅标签、不参与渲染
      "front": "",              // 卡面图相对系列根的路径
      "effects": [],            // 卡面级效果栈（见下节）
      "layers": [               // 顺序即渲染层级，索引 0 在最底
        {
          "id": "l1",
          "name": "",
          "enabled": true,
          "holoMix": 0.9,       // 0–1，全息混合度
          "holoAlpha": 1,       // 0–1，全息不透明度
          "blend": "add",       // add | normal | screen | multiply
          "opacity": 1,         // 0–1，图层整体不透明度
          "effects": [],        // 图层级效果栈（见下节）
          "children": []        // 子图层：被本层蒙版软裁切
        }
      ]
    }
  ],
  "hiddenCards": [],
  "rarityGradients": {},        // Partial<Record<Rarity, string[]>>，按稀有度的渐变预设
  "rarityProbabilities": {},    // 保留字段
  "synthesisMergeRatios": {},   // Partial<Record<Rarity, number>>，保留字段
  "createdAt": "2026-10-10T00:00:00.000Z",
  "updatedAt": "2026-10-10T00:00:00.000Z"
}
```

可省略字段（如 `notes` / `enabled` / 各数值参数）在解析时会被 schema 的默认值补全；
解析器会**剥离** schema 未声明的额外字段（见下方版本约定）。

### 效果栈（`effects`）

卡面（`CardFace.effects`）与图层（`Layer.effects`）各持一个效果列表——渐变、调色板、几何刻纹、
摩尔纹、光泽、程序化蒙版、图蒙版、图片（`image`）八种视觉效果都作为**列表条目**挂载，取代改造前绑死在
`CardFace.material` / `Layer.colors` 等专属字段上的写法（像 Blender 节点一样「需要就加上去」）。

每条是 `{ id, enabled, kind, params }`：`id` 是列表内稳定引用的 uuid，`kind` 判别 `params`
的形状，`enabled` 为 `false` 时整条不参与渲染但参数保留。目前八种 `kind`：

| kind | 角色 | 说明 |
|---|---|---|
| `gradient` | phase | 全息色带的空间映射 |
| `palette` | color | 全息色带的色标表（原 `Layer.colors`） |
| `lattice` | phase | 几何刻纹 |
| `moire` | phase | 摩尔纹刻蚀 |
| `gloss` | color | 光泽光带 |
| `maskPreset` | alpha | 程序化蒙版（形状由参数化 n 边形生成） |
| `imageMask` | alpha | 图蒙版（用户上传的一张图，按亮度阈值取权重） |
| `image` | content | 图片贴片（可平移 / 旋转 / 缩放） |

「角色」（`EffectRole`：`phase` / `color` / `alpha` / `content`）决定效果在渲染管线的哪一步生效，是 kind
的固有属性、**不落盘**，由渲染层的效果注册表给出；面板据此把列表分组展示。同一目标上
`maskPreset` 与 `imageMask` 同处 `alpha` 组，着色器里**二选一**（程序化蒙版优先）。
`content` 单列一组、排在最上方。

一个 `imageMask` 条目示例（其余 kind 的参数见各 `*Params` 类型）：

```jsonc
{
  "id": "f2a1…",
  "enabled": true,
  "kind": "imageMask",
  "params": {
    "path": "assets/cards/c1/masks/l1.png", // 相对系列根的路径；空串 = 已添加但未上传
    "mode": "line",   // "line" 暗线出全息 | "fill" 亮区出全息
    "edge0": 0,       // 亮度下限阈值 0–1
    "edge1": 0.95,    // 亮度上限阈值 0–1
    "invert": false
  }
}
```

一个 `palette` 条目示例（`colors` 为空表示本目标不出全息）：

```jsonc
{
  "id": "a1b2…",
  "enabled": true,
  "kind": "palette",
  "params": {
    "colors": [
      { "color": "#ff00ff", "at": 0 },
      { "color": "#00ffff", "at": 1 }
    ]
  }
}
```

### 色标的格式

`PaletteParams.colors` 的元素是 `{ "color": "#rrggbb", "at": 0.5 }`，`at ∈ [0, 1]` 是**相位域**位置
（0 为 `spectrum()` 的相位起点、1 为终点），不是卡面上的空间位置——全息色由视角相位采样，
与卡面 UV 无关。`at` 越界会被**拒绝**而不是静默钳制；两个色标位置重合是合法的，表达硬边。

**裸 hex 字符串数组也接受**，作为解析期的书写便利：按数组下标等距展开（`i / (n - 1)`，
单个色标取 0.5），并按 `at` 升序排序后归一为对象形式，解析结果与逐个写 `{ color, at }` 等价。

## schemaVersion 版本约定

- 数据格式版本由顶层 `schemaVersion` 标识，当前为 `7`（`CURRENT_SCHEMA_VERSION`）。
- 顶层 `editorVersion` 是**工具**版本：创建该系列时所用的编辑器 / 渲染器版本（如 `"v1"`），
  与数据格式版本无关。旧文件缺此字段时按 `"v1"` 解析，下次保存补写；因此它不触发版本升级。
- 载入流程：读 `pack.json` → `JSON.parse` → `migrate(raw)`（过版本守卫）→ `PackSchema.parse()`。
  统一入口为 `parsePack(raw)`。
- **不再保留历史升级分支**：本产品尚无历史数据，此前的 v1→v6 逐级升级链已随本轮结构变更退役。
  因此 `migrate` 现在只做两件事——挡住**高于当前版本**的数据（抛错，无法安全降级），
  以及把不高于当前版本的数据**原样传过**（同一引用），交给 `PackSchema` 校验。
- 做**破坏性结构变更**时递增版本号，并在 `migrate.ts` 的 `migrate` 中追加一条升级分支。
- **未知字段策略**：解析时剥离未声明字段。数据演进统一由 `schemaVersion` 迁移负责，
  因此不保留额外字段，以保持已知结构稳定。
