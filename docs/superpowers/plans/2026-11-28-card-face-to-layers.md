# 卡面降级为纯图层 — 实现计划

**Spec:** `docs/superpowers/specs/2026-11-28-card-face-to-layers-design.md`

**Global constraints**
- 最终 `CardFace` 不带 `front*` / 面级 `effects`；图片只能通过图层 `image` 效果存在。
- 旧数据必须能打开；schemaVersion 升到 9；整卡擦除迁移成父级 group。
- 背景图 = 最靠下的可见 image 图层；颜色蒙版 / shadow / tint / bump / moire 继承以它为准，没有则回退 `baseColor`。
- 旧面级 moire `faceStrength` → 图层 `contentRelief`；旧图层 moire 默认 `contentRelief = 1`。
- 每个任务在本仓库单独提交；未知上传/发布不做，除非用户明确要求。

## Task 1: Schema v9 + 迁移
- [ ] 删除 `CardFace.front*` / `CardFace.effects`；删除 `ImageParams.followFront` / `MaskImageParams.followFront`。
- [ ] `MoireParams.faceStrength` → `contentRelief`（默认 1）。
- [ ] schemaVersion 8 → 9（migrate.ts / types.ts / schema.ts / defaults.ts）。
- [ ] `migrate.ts`：v7→v8 只在 `<8` 执行；新增 v8→v9 face 迁移（front→底部 image 图层，面级效果→图层，maskErase→group，faceStrength→contentRelief）。
- [ ] `migrateCardFace` 导出，给 `.card` 单卡包用。
- [ ] 迁移测试 + schema 测试更新。

## Task 2: Renderer
- [ ] 基材简化为 `baseColor` + 圆角遮罩；删除前图/面级效果/蒙版/擦除/bump。
- [ ] card-view / frame-renderer 找「背景 image 图层」，把它的纹理/变换/bump/moire 传给图层材质。
- [ ] 图层材质的颜色源蒙版、shadow、palette tint、bump 继承读背景图；无背景图用 `baseColor`。
- [ ] moire `contentRelief` 接入图层内容浮雕（默认 1）。
- [ ] 删除 followFront、faceStrength、面级效果路径。
- [ ] 渲染器测试更新。

## Task 3: Editor
- [ ] `CardFaceFields` 删除前图/法线/面级效果/面级画笔；保留底色/形状/表面/图层。
- [ ] 「添加底图」：创建 image 图层并插入最底部；现有「添加图片图层」保留。
- [ ] store 删除 front/faceNormal 导入目标、followFront 同步、面级 EffectTarget；画笔只保留图层目标。
- [ ] 吸管取色改用背景 image 图层；无背景图回退 `baseColor`。
- [ ] assets / hash / flatten / bundle / preview / i18n 更新。
- [ ] 编辑器测试更新。

## Task 4: 小程序 + 全量验证
- [ ] `build:lib` 重建；969 测试。
- [ ] schema/renderer/editor 全量 typecheck/test/build。
- [ ] 手工验收：旧包打开、背景图、颜色蒙版、shadow、画笔、导出。
