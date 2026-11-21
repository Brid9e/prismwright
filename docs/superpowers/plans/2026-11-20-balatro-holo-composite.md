# 调色板合成：小丑牌镭射参数化 + 独立网格 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `palette` 效果的小丑牌合成从写死常量改为可调参数（默认值不变），并新增可叠加到任意合成的独立「网格」效果。

**Architecture:** 小丑牌合成继续由 `palette` 效果承担：`composite = "balatro"` 时片元取内容（图片/文字/卡面原图）的 HSL，按参数做色相偏移、饱和度/提亮、delta lerp 与蓝偏。网格数学抽成 `holoGridValue`，palette 的内置网格和新的 `holoGrid` 效果共用；后者把色相加量叠加到色带或小丑牌合成上。

**Tech Stack:** TypeScript、Zod（schema）、three.js ShaderMaterial/GLSL、React 编辑器、esbuild（小程序 bundle）。

**Spec:** `docs/superpowers/specs/2026-11-20-balatro-holo-composite-design.md`

## Global Constraints

- 小丑牌参数的**默认值必须与 `holo.fs` 常量逐项一致**：hue 0.036、sat 1.3、lift 0.4、tint 1、deltaBase 0.2、deltaContrast 0.3、deltaBright 0.1、grid 1、gridScale 0.79；不得改变现有画面。
- `palette` 效果保持 `scope: "layer"`；不改卡面片元。
- 独立网格效果 `holoGrid`：`role: "color"`、`scope: "layer"`、每层最多 1 条；不新增纹理采样器，uniform 用「定长数组 + 计数」模式。
- 网格只改色相，不改亮度；蒙版/不透明度/祖先裁切/擦除语义不变。
- 中英文案同时补；`EFFECT_KINDS` 是效果菜单唯一来源。
- 每个任务在 `D:\Code\prismwright` 单独提交；小程序 bundle 在 monorepo 单独提交；默认不 push。
- 工作区已有未提交的草稿（Task 1/2/4 的一部分）：先 `git diff` 核对，按任务收口，不要重写已通过测试的部分。

## Review Focus

- **默认回归**：不选小丑牌、或无新参数时，现有色带画面必须逐项不变；参数默认值与旧常量一致。
- **双层网格**：`palette.grid` 默认 1、独立网格默认不挂；用户同时开时叠加——这是预期，文档说明「只要独立网格就把 palette.grid 设 0」。
- **内容与 alpha**：小丑牌合成的 content 依次取 本层图片 → 文字 → 卡面原图；卡面原图的色/alpha 必须走 `uFaceMapMatrix/uFaceMapOffset`（fit/offset/scale/rotation），不能直接 `texture2D(uFrontMap, vUv)`。
- **混合模式**：调色板合成不改图层混合；小丑牌合成配「叠加」仍会发亮，UI/文档提示用「正常」，但不强制。
- **旧数据**：新增字段全部有默认值，不升 schemaVersion；旧 pack 解析后仍得到旧画面；小程序 bundle 必须重建。
- **色带 + 独立网格**：色带路径的网格是 `holo` 颜色的 HSL 色相偏移，不能把亮度一起改掉。

---

### Task 0: 核对工作区草稿

**Files:**
- Review: `git diff` 全部未提交改动（schema / renderer / i18n / flatten tests）

- [ ] **Step 1: 看草稿差异**

Run: `git status --short`、`git diff`
Expected: 能看到 `PaletteParams` 的 9 个字段、`uPalette*` uniform、`balatroTint` 参数化、注册表字段与 effect.json 文案；没有 `holoGrid` 相关代码。

- [ ] **Step 2: 核对是否已过测试**

Run: `pnpm -F @prismwright/renderer test`、`pnpm -F @prismwright/schema test`、`pnpm -F prismwright typecheck`
Expected: 全绿；若红，先修到绿再进入 Task 1。

---

### Task 1: Schema — `HoloGridParams` + effect 联合

**Files:**
- Modify: `packages/card-schema/src/types.ts`
- Modify: `packages/card-schema/src/schema.ts`
- Test: `packages/card-schema/src/__tests__/holo-grid-params.test.ts`（新建）

**Interfaces:**
- Produces: `HoloGridParams { size: number; strength: number }`；`Effect` 联合新增 `{ kind: "holoGrid"; params: HoloGridParams }`；`EffectKind` 自动包含 `"holoGrid"`。

- [ ] **Step 1: 写失败测试**

新建 `holo-grid-params.test.ts`：

```ts
import { describe, it, expect } from "vitest"
import { EffectSchema, HoloGridParamsSchema } from "@prismwright/schema"

describe("HoloGridParamsSchema", () => {
  it("默认 size 0.79 / strength 1", () => {
    expect(HoloGridParamsSchema.parse({})).toEqual({ size: 0.79, strength: 1 })
  })
  it("EffectSchema 能解析 holoGrid", () => {
    expect(EffectSchema.parse({ kind: "holoGrid", id: "g" })).toMatchObject({
      kind: "holoGrid",
      params: { size: 0.79, strength: 1 },
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @prismwright/schema test -- holo-grid`
Expected: FAIL——`HoloGridParamsSchema` 未导出 / `holoGrid` 不在联合里。

- [ ] **Step 3: 实现 schema/type**

在 `types.ts` 加：

```ts
export interface HoloGridParams {
  /** 网纹密度；默认 0.79（与 palette 内置网格同密度）。 */
  size: number
  /** 色相加量强度 0–1；默认 1。 */
  strength: number
}
```

在 Effect 联合加 `(EffectBase & { kind: "holoGrid"; params: HoloGridParams })`。在 `schema.ts` 加：

```ts
export const HoloGridParamsSchema = z.object({
  size: z.number().min(0.1).max(2).default(0.79),
  strength: z.number().min(0).max(1).default(1),
})
```

并在 `EffectSchema` 的 `z.discriminatedUnion` 里加该分支。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @prismwright/schema test -- holo-grid`、`pnpm -F @prismwright/schema typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/card-schema/src/types.ts packages/card-schema/src/schema.ts packages/card-schema/src/__tests__/holo-grid-params.test.ts
git commit -m "feat(schema): holoGrid 效果参数"
```

---

### Task 2: Renderer — 小丑牌合成参数化收口

**Files:**
- Modify: `packages/card-renderer/src/v1/materials/layer-material.ts`
- Modify: `packages/card-renderer/src/v1/shaders/layer.ts`
- Modify: `packages/card-renderer/src/v1/shaders/common.ts`
- Test: `packages/card-renderer/src/v1/__tests__/layer-material.test.ts`
- Test: `packages/card-renderer/src/v1/__tests__/layer-shader.test.ts`

**Interfaces:**
- Consumes: `PaletteParams` 的 9 个字段（已存在）。
- Produces: `uPaletteHue/Sat/Lift/Tint/DeltaBase/DeltaContrast/DeltaBright/Grid/GridScale`；`balatroTint(content, uv, phase, extraGrid)` 的 `extraGrid` 参数（Task 3 使用）。

- [ ] **Step 1: 写失败测试**

在 `layer-material.test.ts` 的「createLayerMaterial 调色板合成」describe 里加：

```ts
it("小丑牌参数接到 uPalette* uniform，默认值不变", () => {
  const effect = EffectSchema.parse({
    kind: "palette",
    id: "p",
    enabled: true,
    params: { colors: ["#111111"], composite: "balatro", sat: 1.5, grid: 0.2 },
  }) as Effect
  const m = build({ effects: [effect] })
  expect(m.uniforms.uPaletteSat.value).toBe(1.5)
  expect(m.uniforms.uPaletteGrid.value).toBe(0.2)
  expect(m.uniforms.uPaletteHue.value).toBe(0.036)
  expect(m.uniforms.uPaletteLift.value).toBe(0.4)
  expect(m.uniforms.uPaletteTint.value).toBe(1)
  expect(m.uniforms.uPaletteDeltaBase.value).toBe(0.2)
})
```

在 `layer-shader.test.ts` 的「LAYER_FRAGMENT 小丑牌合成」里加：

```ts
expect(LAYER_FRAGMENT).toContain("uniform float uPaletteHue;")
expect(LAYER_FRAGMENT).toContain("holoGridValue(uv, uPaletteGridScale) * uPaletteGrid")
expect(LAYER_FRAGMENT).toContain("mix(hsl.z, 1.0, uPaletteLift)")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @prismwright/renderer test -- layer-material layer-shader`
Expected: FAIL——uPalette* 未声明/未接线（若草稿已接线则 PASS；那就跳过失败确认，注明草稿已满足）。

- [ ] **Step 3: 收口实现**

核对/补齐：
- 材质 uniform：`uPaletteHue`…`uPaletteGridScale` 从 `paletteParams` 读取，缺省用默认值。
- `common.ts`：`holoGridValue(uv, size)` 已存在；`balatroHSL/RGB` 已存在。
- `layer.ts`：`balatroTint` 使用 `uPalette*`；网格强度乘在 `holoGridValue` 上；delta 三项来自 uniform；`extraGrid` 形参保留（当前传 0.0）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @prismwright/renderer typecheck && pnpm -F @prismwright/renderer test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/card-renderer/src/v1/materials/layer-material.ts packages/card-renderer/src/v1/shaders/layer.ts packages/card-renderer/src/v1/shaders/common.ts packages/card-renderer/src/v1/__tests__/layer-material.test.ts packages/card-renderer/src/v1/__tests__/layer-shader.test.ts
git commit -m "feat(renderer): 小丑牌合成参数化"
```

---

### Task 3: Renderer — 独立 `holoGrid` 效果

**Files:**
- Modify: `packages/card-renderer/src/v1/effects/registry.ts`
- Modify: `packages/card-renderer/src/v1/effects/uniforms.ts`
- Modify: `packages/card-renderer/src/v1/materials/layer-material.ts`
- Modify: `packages/card-renderer/src/v1/shaders/layer.ts`
- Test: `packages/card-renderer/src/v1/__tests__/effects-uniforms.test.ts`
- Test: `packages/card-renderer/src/v1/__tests__/layer-material.test.ts`
- Test: `packages/card-renderer/src/v1/__tests__/layer-shader.test.ts`

**Interfaces:**
- Consumes: `HoloGridParams`（Task 1）。
- Produces: `HOLO_GRID_MAX = 1`；uniform `uHoloGridCount`、`uHoloGridSize[1]`、`uHoloGridStrength[1]`；`LAYER_FRAGMENT` 中的独立网格色相加量。

- [ ] **Step 1: 写失败测试**

`effects-uniforms.test.ts`：

```ts
it("holoGrid 打包成 uHoloGridCount / uHoloGridSize / uHoloGridStrength", () => {
  const effects = [EffectSchema.parse({ kind: "holoGrid", id: "g", params: { size: 0.5, strength: 0.8 } }) as Effect]
  const u = toEffectUniforms(effects, [])
  expect(u.uHoloGridCount).toBe(1)
  expect(u.uHoloGridSize[0]).toBe(0.5)
  expect(u.uHoloGridStrength[0]).toBe(0.8)
})
```

`layer-material.test.ts`：

```ts
it("holoGrid 接线到 uHoloGrid*", () => {
  const effect = EffectSchema.parse({ kind: "holoGrid", id: "g", params: { size: 0.6, strength: 0.5 } }) as Effect
  const m = build({ effects: [effect] })
  expect(m.uniforms.uHoloGridCount.value).toBe(1)
  expect(m.uniforms.uHoloGridSize.value[0]).toBe(0.6)
  expect(m.uniforms.uHoloGridStrength.value[0]).toBe(0.5)
})
```

`layer-shader.test.ts`：

```ts
expect(LAYER_FRAGMENT).toContain("uniform float uHoloGridCount;")
expect(LAYER_FRAGMENT).toContain("uHoloGridSize[0]")
expect(LAYER_FRAGMENT).toContain("holoHueShift(")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @prismwright/renderer test -- effects-uniforms layer-material layer-shader`
Expected: FAIL——未知 kind / uniform 缺失。

- [ ] **Step 3: 实现**

- `registry.ts`：
  - `export const HOLO_GRID_MAX = 1`
  - registry 条目：
    ```ts
    holoGrid: {
      kind: "holoGrid",
      role: "color",
      scope: "layer",
      maxPerTarget: HOLO_GRID_MAX,
      defaultParams: () => parseParams("holoGrid", {}),
      labelKey: "holoGrid.label",
      fields: [
        { key: "size", labelKey: "holoGrid.size", type: "slider", min: 0.1, max: 2, step: 0.01, precision: 2 },
        { key: "strength", labelKey: "holoGrid.strength", type: "slider", min: 0, max: 1, step: 0.01, precision: 2 },
      ],
      packUniforms: (p: HoloGridParams): PackedUniforms => ({ size: p.size, strength: p.strength }),
    },
    ```
  - `EFFECT_KINDS` 在 `"palette"` 后加 `"holoGrid"`。
- `uniforms.ts`：`EffectUniformArrays` 加 `uHoloGridCount: number; uHoloGridSize: number[]; uHoloGridStrength: number[]`；`toEffectUniforms` 里按 `pick(effects, "holoGrid", HOLO_GRID_MAX)` + `fill` 打包。
- `layer-material.ts`：`fx` 已透传；确认 `uHoloGrid*` 在材质 uniforms 里（`...fx` 展开即可）。
- `layer.ts`：
  - 声明 `uHoloGridCount`、`uHoloGridSize[1]`、`uHoloGridStrength[1]`。
  - `float independentGrid = uHoloGridCount > 0.5 ? holoGridValue(vUv, uHoloGridSize[0]) * uHoloGridStrength[0] : 0.0;`
  - 色带路径：`holo = holoHueShift(holo, independentGrid);`（在 `glossBands` 之后、alpha 之前）。
  - 小丑牌路径：`outC = balatroTint(content, vUv, phase, independentGrid);`
  - 在 GLSL_COMMON 或 layer.ts 加 `holoHueShift`（用 `balatroHSL/RGB` 只改色相）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @prismwright/renderer typecheck && pnpm -F @prismwright/renderer test && pnpm -F @prismwright/renderer build`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/card-renderer/src/v1/effects/registry.ts packages/card-renderer/src/v1/effects/uniforms.ts packages/card-renderer/src/v1/materials/layer-material.ts packages/card-renderer/src/v1/shaders/layer.ts packages/card-renderer/src/v1/__tests__/
git commit -m "feat(renderer): 独立网格效果 holoGrid"
```

---

### Task 4: 编辑器 — 调色板字段收口 + 网格效果文案

**Files:**
- Modify: `apps/desktop/src/i18n/locales/zh-CN/effect.json`
- Modify: `apps/desktop/src/i18n/locales/en/effect.json`
- Test: `apps/desktop/src/features/effects/__tests__/i18n.test.ts`（自动覆盖注册表字段）

**Interfaces:**
- Consumes: 注册表字段（Task 2/3）。
- Produces: 调色板 9 个滑杆文案、`holoGrid.label/size/strength` 文案；效果菜单出现「网格」。

- [ ] **Step 1: 写/跑失败测试**

Run: `pnpm -F prismwright test -- effects/__tests__/i18n`
Expected: FAIL——`palette.hue` 或 `holoGrid.label` 缺文案（若草稿已补 palette 文案，holoGrid 仍会缺）。

- [ ] **Step 2: 补文案**

在 `effect.json` 的 `palette` 下补（已有一部分）：
`hue / sat / lift / tint / deltaBase / deltaContrast / deltaBright / grid / gridScale`；
新增：
```json
"holoGrid": { "label": "网格", "size": "密度", "strength": "强度" }
```
英文：
```json
"holoGrid": { "label": "Grid", "size": "Density", "strength": "Strength" }
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm -F prismwright typecheck && pnpm -F prismwright test`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/i18n/locales/zh-CN/effect.json apps/desktop/src/i18n/locales/en/effect.json
git commit -m "feat(editor): 小丑牌参数与网格效果文案"
```

---

### Task 5: 全量验证 + 小程序 bundle

**Files:**
- Modify: `apps/miniprogram/miniprogram/lib/prismwright.js`（monorepo）

- [ ] **Step 1: 全量验证**

```bash
cd D:/Code/prismwright
pnpm -F @prismwright/schema typecheck && pnpm -F @prismwright/schema test
pnpm -F @prismwright/renderer typecheck && pnpm -F @prismwright/renderer test && pnpm -F @prismwright/renderer build
pnpm -F prismwright typecheck && pnpm -F prismwright test && pnpm -F prismwright build
```
Expected: 全绿；renderer 测试数 ≥ 492。

- [ ] **Step 2: 重建小程序 bundle**

```bash
cd D:/Code/card-editor
pnpm -F miniprogram build:lib
pnpm -F miniprogram test
```
Expected: `built miniprogram/lib/prismwright.js (from prismwright source)`；969 测试通过。

- [ ] **Step 3: 手工验收**

编辑器里新建图层 → 添加调色板 → 合成方式「小丑牌」→ 调网格/色相/叠加；切到「调色板（色带）」+ 添加「网格」效果；图层混合选「正常」。
Expected: 亮部不过曝；色带/小丑牌都能叠网格；蒙版与不透明度仍生效；默认参数画面与旧版一致。

- [ ] **Step 4: 提交 bundle（monorepo）**

```bash
cd D:/Code/card-editor
git add apps/miniprogram/miniprogram/lib/prismwright.js
git commit -m "build(miniprogram): 重建 bundle（小丑牌参数 + 网格）"
```
