# 刻纹合并到网格 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `lattice`（刻纹）效果，把它的全部可调参数与线族数学并入 `holoGrid`（网格），旧数据里的刻纹在解析期丢弃。

**Architecture:** `holoGrid` 从固定交叉网纹改为「刻纹线族生成器 + 色相加量」：线值用 `latticeField(vUv - offset, families, angle, density, width) * strength`，加到色带或叠色的色相上。`latticeField` 保留在 `shaders/common.ts`；`holoPhase` / 内容浮雕 / 基础材质里的刻纹相位集成全部删除。

**Tech Stack:** TypeScript、Zod、three.js GLSL、React 编辑器、esbuild（小程序 bundle）。

**Spec:** `docs/superpowers/specs/2026-11-21-lattice-to-grid-design.md`

## Global Constraints

- 网格参数与默认值**继承刻纹**：`count` 默认 3（1–8）、`angle` 0（0–360）、`density` 30（1–100）、`width` 1/7（0.02–0.6）、`strength` 0.5（0–1）、`offsetX/Y` 0（-1–1）。现有网格的 `size` 删除，由 `density` 接替。
- 网格只改色相，不改亮度；`latticeField` 的线族数学保留，刻纹的相位/浮雕集成删除。
- 旧 pack 里的 `kind: "lattice"` 在解析前过滤掉，不升 schemaVersion；包能打开、刻纹消失。
- `lattice` 从 EffectKind / 注册表 / uniform / UI / 文案 / 默认效果 / 测试中彻底删除。
- 每个任务在 `D:\Code\cardbara-editor` 单独提交；小程序 bundle 在 monorepo 单独提交；默认不 push。

## Review Focus

- **没有悬挂 uniform**：`uLattice*` 在 `common.ts` / `layer.ts` / `base-material.ts` / `uniforms.ts` 全部清干净，否则 GLSL 编译或 typecheck 会红。
- **网格默认观感**：默认参数取刻纹默认（count 3 / density 30 / width 1/7 / strength 0.5），网格默认从原来的交叉网纹变成刻纹线族在色相上的版本；这是预期。
- **旧数据丢弃**：`lattice` 条目丢弃后，卡上其他效果/图层仍能解析；不因未知 kind 整包失败。
- **角色**：网格仍是 `color` / `layer` / 最多 1 条；不再有 phase 角色。
- **默认效果**：编辑器默认卡面/图层若引用 lattice，需要替换/删除，否则新建卡就报错。
- **bundle**：小程序 bundle 必须重建（schema/renderer 都变了）。

---

### Task 1: Schema — 网格继承刻纹参数、删除 lattice、旧数据丢弃

**Files:**
- Modify: `packages/card-schema/src/types.ts`
- Modify: `packages/card-schema/src/schema.ts`
- Modify: `packages/card-schema/src/index.ts`
- Test: `packages/card-schema/src/__tests__/holo-grid-params.test.ts`
- Test: `packages/card-schema/src/__tests__/effect-schema.test.ts` / `schema.test.ts`（删刻纹用例）

**Interfaces:**
- Produces: `HoloGridParams { count; angle; density; width; strength; offsetX; offsetY }`；`EffectKind` 不再含 `"lattice"`；旧 lattice 在 `LayerSchema` 解析时被过滤。

- [ ] **Step 1: 写失败测试**

`holo-grid-params.test.ts`：

```ts
it("默认继承刻纹参数", () => {
  expect(HoloGridParamsSchema.parse({})).toEqual({
    count: 3, angle: 0, density: 30, width: 1 / 7, strength: 0.5, offsetX: 0, offsetY: 0,
  })
})
it("带 lattice 的旧 effects 解析时被丢弃", () => {
  const layer = LayerSchema.parse({
    id: "l", effects: [{ kind: "lattice", id: "x", params: { count: 3 } }],
  })
  expect(layer.effects).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @cardbara/schema test -- holo-grid`
Expected: FAIL——默认值不是刻纹默认；lattice 仍能解析。

- [ ] **Step 3: 实现**

- `HoloGridParamsSchema` 的字段/默认值按 Global Constraints；删除 `size`。
- 删除 `LatticeParamsSchema`、`LatticeParams`、Effect 联合分支、`EffectSchema` 分支、index 导出、`_assertLattice*`。
- `LayerSchema.effects` 加 preprocess：过滤 `e?.kind === "lattice"`，再走 `z.array(EffectSchema)`。
- 删掉 schema 测试里的刻纹用例。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @cardbara/schema typecheck && pnpm -F @cardbara/schema test`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/card-schema/src
git commit -m "feat(schema): 网格继承刻纹参数，删除 lattice"
```

---

### Task 2: Renderer — 删刻纹、网格改用 latticeField

**Files:**
- Modify: `packages/card-renderer/src/v1/effects/registry.ts`
- Modify: `packages/card-renderer/src/v1/effects/uniforms.ts`
- Modify: `packages/card-renderer/src/v1/shaders/common.ts`
- Modify: `packages/card-renderer/src/v1/shaders/layer.ts`
- Modify: `packages/card-renderer/src/v1/materials/base-material.ts`
- Test: `packages/card-renderer/src/v1/__tests__/`（effects-registry / effects-uniforms / layer-material / layer-shader / mapping / mask-transform）
- Test: `packages/card-renderer/src/v1/__tests__/base-material.test.ts`

**Interfaces:**
- Consumes: `HoloGridParams`（Task 1）。
- Produces: 网格 uniform `uHoloGridFamilies/Angle/Density/Width/Strength/OffsetX/OffsetY`（定长 1 + `uHoloGridCount` 计数）；`latticeField` 保留。

- [ ] **Step 1: 写失败测试**

`effects-registry.test.ts`：`EXPECTED` 的 `holoGrid` 键改为 `families/angle/density/width/strength/offsetX/offsetY`；`EFFECT_KINDS` 不再含 `lattice`（十种 → 九种）。

`layer-shader.test.ts`：

```ts
it("网格用 latticeField 的线族数学，且只加色相", () => {
  expect(LAYER_FRAGMENT).toContain("latticeField(")
  expect(LAYER_FRAGMENT).not.toContain("uLatticeCount")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @cardbara/renderer test -- effects-registry layer-shader`
Expected: FAIL。

- [ ] **Step 3: 实现**

- registry：删除 `lattice` 条目与 `LATTICE_MAX`；网格 fields 改为 count/angle/density/width/strength/offsetX/offsetY；`packUniforms` 输出 `families: p.count` 等；`EFFECT_KINDS` 删 `"lattice"`。
- uniforms.ts：删 `uLattice*` 与打包；网格数组改新参数。
- common.ts：删 `holoPhase` 的刻纹循环、内容浮雕的刻纹；保留 `latticeField`；删 `uLattice*` 声明。
- layer.ts：删刻纹残留；网格值 = `latticeField(vUv - offset, families, angle, density, width) * strength`；色带路径 `holoHueShift`，叠色路径 `extraGrid`。
- base-material.ts / base shader：删刻纹 uniform/引用。
- 测试：删 lattice 用例；网格测试改新参数；补 `latticeField` 断言。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @cardbara/renderer typecheck && pnpm -F @cardbara/renderer test && pnpm -F @cardbara/renderer build`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/card-renderer/src
git commit -m "feat(renderer): 删除刻纹，网格改用 latticeField"
```

---

### Task 3: Editor — 删刻纹菜单/文案/默认效果，网格字段换新

**Files:**
- Modify: `apps/desktop/src/i18n/locales/zh-CN/effect.json`
- Modify: `apps/desktop/src/i18n/locales/en/effect.json`
- Modify: 默认效果里引用 lattice 的文件（`packages/card-schema/src/defaults.ts` 或 store 默认，按 grep 结果）
- Test: `apps/desktop/src/features/effects/__tests__/i18n.test.ts`
- Test: `apps/desktop/src/features/effects/__tests__/effectOps.test.ts`
- Test: `apps/desktop/src/store/__tests__/effects.test.ts`

- [ ] **Step 1: 跑失败测试**

Run: `pnpm -F cardbara test -- effects`
Expected: FAIL——lattice 字段/文案/默认用例仍存在，网格缺新文案。

- [ ] **Step 2: 实现**

- `effect.json`：删 `lattice` 块；`holoGrid` 的字段文案改为 族数/角度/密度/宽度/强度/偏移 X/偏移 Y（en：Families/Angle/Density/Width/Strength/Offset X/Offset Y）；删 `size`。
- 默认效果：把引用 lattice 的默认条目替换成 `holoGrid`（带刻纹默认参数）或删除。
- 测试：删 lattice 用例；网格用例改新参数。

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm -F cardbara typecheck && pnpm -F cardbara test && pnpm -F cardbara build`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src packages/card-schema/src/defaults.ts
git commit -m "feat(editor): 删除刻纹，网格继承刻纹参数"
```

---

### Task 4: 全量验证 + 小程序 bundle

- [ ] **Step 1: 全量验证**

```bash
cd D:/Code/cardbara-editor
pnpm -F @cardbara/schema typecheck && pnpm -F @cardbara/schema test
pnpm -F @cardbara/renderer typecheck && pnpm -F @cardbara/renderer test && pnpm -F @cardbara/renderer build
pnpm -F cardbara typecheck && pnpm -F cardbara test && pnpm -F cardbara build
```
Expected: 全绿。

- [ ] **Step 2: 小程序 bundle**

```bash
cd D:/Code/card-editor
pnpm -F miniprogram build:lib
pnpm -F miniprogram test
```
Expected: `built ... (from cardbara-editor source)`；969 测试通过。

- [ ] **Step 3: 手工验收**

编辑器新建/打开一张卡 → 效果菜单只剩「网格」→ 调族数/角度/密度/宽度/强度/偏移；旧 pack（含 lattice）能打开，刻纹消失、其余效果保留。
Expected: 网格线随参数变化；旧包不报错。

- [ ] **Step 4: 提交 bundle（monorepo）**

```bash
cd D:/Code/card-editor
git add apps/miniprogram/miniprogram/lib/cardbara.js
git commit -m "build(miniprogram): 重建 bundle（刻纹并入网格）"
```
