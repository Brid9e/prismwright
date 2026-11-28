# 卡面降级为纯图层 — 设计

**目标：** 删除 `CardFace` 上特殊的「前景图」与面级效果，卡片变成「底色 + 图层列表」。图片就是普通图层的 `image` 效果；旧工程自动迁移，外观尽量不变。

## 终态模型

```ts
CardFace {
  baseColor: string          // 卡片画布底色
  cornerRadius: number
  finish / glass*            // 表面材质，保留在面级
  layers: Layer[]            // 唯一的内容与效果来源
}
```

删除：

- `front` / `frontFit` / `frontOffsetX/Y` / `frontScale` / `frontRotation`
- `frontBump*` / `frontNormalPath` / `frontNormalFlipY`
- `CardFace.effects`（面级效果栈）
- `ImageParams.followFront` / `MaskImageParams.followFront`
- `MoireParams.faceStrength`（改为图层可用的 `contentRelief`）

## 背景图层的约定

- 图层列表里**最靠下的、带 `image` 效果的可见图层**视为整卡背景图。
- 它只作为以下功能的取样源，不再是一个特殊字段：
  - 颜色源蒙版（`imageMask.source = "color"`）与吸管取色
  - `shadow` 混合 / 调色板 `tint` 的底图亮度回退
  - 其他图层没有自带 bump 时的法线继承
  - 其他图层没有自带 moire 时的摩尔纹继承（用于光泽切带）
- 没有背景图时，以上回退到 `baseColor`，不再采样 1×1 占位纹理。
- 背景图层的 bump / moire / 蒙版参数搬进该图层自己的 `image` / 效果列表；不再有面级 bump / moire。

## 迁移（schemaVersion 9）

对每个 `CardFace`：

1. 若 `front` 非空：在图层数组**最前面**插入一个普通图层：
   - `effects = [image 效果, ...旧面级效果]`
   - image 参数：`path = front`、`fit = frontFit`、`x/y = frontOffsetX/Y`、`scale = frontScale`、`rotation = frontRotation`、bump/normal 字段一一对应
   - `layer.blend = "normal"`、`opacity = 1`
2. 旧面级 `maskErase` 是**整卡擦除**：迁移成一个父级 group 图层，`effects = [maskErase]`，把所有内容图层放进 `children`。这样祖先擦除继续裁切整棵子树。
3. 旧面级 `moire` 的 `faceStrength` 映射为新图层 moire 的 `contentRelief`；旧图层 moire 的 `contentRelief` 默认 1（保持现有图层浮雕行为）。
4. 删除 `front*`、面级 `effects`、`followFront`、`faceStrength`。
5. 没有 `front` 但有面级效果：保留为一个没有内容的普通图层（等待用户加图片），不让数据丢失；整卡擦除仍走 group。

旧 `.card` 单卡包绕过 `parsePack`，需要单独调用同一份 card/face 迁移 helper。

## 渲染

- 基材只画 `baseColor` + 圆角遮罩；删除前图/面级效果/面级蒙版/面级擦除。
- 图层材质继续使用现有 image / text / 效果 / 祖先蒙版。
- 背景图层的 image 纹理与变换作为 `uFrontMap` 的来源；无背景图时用 `baseColor`。
- bump / moire 继承源改为背景图层；没有背景图层就没有继承。
- 画笔/擦除只作用于图层；整卡擦除用带 `maskErase` 的 group。
- 吸管取色使用背景图层的图片与变换；无背景图时回退到 `baseColor`。

## UI

- 卡面检查器只保留：底色、形状、表面材质、图层列表。
- 删除「卡面图」上传、填充/偏移/缩放/旋转、面级法线、面级效果栈、面级画笔。
- 图层列表保留现有「添加图片图层」；新增「添加底图」动作：创建图片图层并插入到最底部。
- 图层效果里的 `followFront` 删除；图片的填充/位移/缩放/旋转/法线都在图层详情里调。
- 吸管/画笔目标只保留图层目标；提示文案从「卡面」改为「图层 / 卡片」。

## 兼容与测试

- schemaVersion 8 → 9；旧包打开时迁移，保存后写 9。
- 迁移测试覆盖：front 映射、面级效果、整卡擦除 group、faceStrength→contentRelief、无 front 的情况。
- 更新 assets / hash / flatten / bundle / preview / 渲染器 / 编辑器测试。
- 小程序 bundle 重新构建；旧云包读入时同样迁移。

## 已知取舍

- 旧面级 `moire.faceStrength` 的浮雕改由 `contentRelief` 表示；默认 0 的旧面级 moire 不会在迁移后的图片层上突然出现浮雕。
- 没有背景图时，`shadow` / 颜色源蒙版 / 调色板 tint 用 `baseColor`，不再有前图像素。
- 整卡擦除从「面级效果」变成「带 maskErase 的 group 图层」；绘制目标随之变成该 group。
