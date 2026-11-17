# @cardbara/renderer

全息卡牌 WebGL 渲染器（基于 [three.js](https://threejs.org/)）。读取
`@cardbara/schema` 的 `CardFace`，把卡面图与可排序、可嵌套的全息图层渲染到 canvas。

渲染器只做「把数据画出来」一件事：它不读文件、不认系列结构，图片从哪来由调用方经
`resolveAsset` 注入。除交互预览外，它还提供一条**离屏逐帧**通路，把同一张卡导出为带
透明通道的 PNG 资产。

## 安装

```bash
pnpm add @cardbara/renderer three
```

`three` 是 **peerDependency**（`>=0.160.0`），由宿主自带、不随本包打包。

本包按版本分入口：当前只导出 `@cardbara/renderer/v1`，裸 `@cardbara/renderer` 不再可用；
将来 v2 以 `/v2` 与 v1 平级并列。

## 两个入口

| 入口 | 服务于 | 输出 |
|---|---|---|
| `createCardView` | 交互预览——「看着它转」 | 挂进容器的常驻 canvas |
| `createCardFrameRenderer` | 后台资产——「把它抠出来」 | 逐帧 `PNG Blob`（透明通道） |

两者共用同一批材质与场景常量，故**导出的卡与预览里的卡是同一张**：相机位置、圆角、图层
栈、效果参数两处一致（详见 `frame-renderer.ts` 的说明）。

## 交互视图：`createCardView`

```ts
import { createCardView } from "@cardbara/renderer/v1";

const view = createCardView({
  container: document.getElementById("preview")!,
  card,                        // CardFace（来自 pack.json）
  resolveAsset: async (rel) => loader.loadAsync(`/packs/${rel}`),
});

view.setZoom(1.5);             // 推拉相机；超出 [MIN_ZOOM, MAX_ZOOM] 会被夹取
view.update(updatedCard);      // 数据变更后增量更新，尽量不整场重建
view.clearTilt();              // 「重置视角」：归位倾斜、清空角速度
view.dispose();                // 卸载：停渲染、释放 GPU 资源与事件监听
```

### 选项（`CardViewOptions`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `container` | `HTMLElement` | — | canvas 的挂载容器；renderer 在其中创建并自适应尺寸 |
| `card` | `CardFace` | — | 初始卡面（正面或背面） |
| `resolveAsset` | `ResolveAsset` | — | 资源解析器（见下） |
| `idleSway` | `boolean` | `true` | 空闲时是否自动摆动 |
| `zoom` | `number` | `1` | 初始缩放倍数；夹到 `[MIN_ZOOM, MAX_ZOOM]` |
| `cornerRadius` | `number` | `0.06` | 卡片圆角半径（相对卡宽的比例） |

### 句柄（`CardView`）

| 方法 | 说明 |
|---|---|
| `update(card)` | 数据变更后就地更新 |
| `clearTilt()` | 复位倾斜角并清空角速度，随后回到空闲摆动 / 静止驱动 |
| `setZoom(zoom)` | 设置缩放倍数（推拉相机），超出范围会被夹取 |
| `resize()` | 重设相机与 viewport 至容器当前尺寸 |
| `dispose()` | 停止渲染、释放 GPU 资源与事件监听 |

### 倾斜交互

**按住拖拽旋转 + 松手惯性回弹**：指针按下拖动时，绕 X / Y 轴的两个角随指针位移就地累积，
松手后由一条**欠阻尼弹簧**把角拉回空闲摆动（或静止）位，残余角速度让它「晃」几下才停。
指针**未按下时不动**——悬停不触发倾斜。`idleSway` 为真时，空闲状态下卡片始终缓缓摆动。

## 离屏帧渲染：`createCardFrameRenderer`

永远从正前方看、**不倾斜、不摆动、不跟随指针**——同一张卡在每一处长得一模一样。构建是
异步的（要解析卡面与各层蒙版纹理）。

```ts
import { createCardFrameRenderer } from "@cardbara/renderer/v1";

const frames = await createCardFrameRenderer({
  card,
  resolveAsset,
  width: 1024,                 // 输出宽（px）；高度由 CARD_ASPECT 推得并取整
});

const still = await frames.renderPng(0);      // 静态帧：逐像素等于预览
const moving = await frames.renderPng(1.2);   // 相位时间 1.2s：全息流动的一帧
frames.dispose();
```

`renderPng(time)` 的 `time` 是**相位时间（秒）**，只喂给图层材质：`0` 即静态（与预览一致），
逐帧递增即得「静卡 · 全息流动」，可直接编成透明 WebM。卡面底图不含相位项，不随时间变化。

| 选项（`CardFrameRendererOptions`） | 类型 | 默认 | 说明 |
|---|---|---|---|
| `card` | `CardFace` | — | 要渲染的卡面 |
| `resolveAsset` | `ResolveAsset` | — | 资源解析器（与交互视图同一份语义） |
| `width` | `number` | — | 输出位图宽度（像素） |
| `cornerRadius` | `number` | `0.06` | 圆角半径，与交互视图一致 |

## 编辑器元数据

效果栈的**单一事实来源**在渲染层：面板据此摊成控件、store 据此取默认值与槽位上限，加一种
效果时 UI 一侧一行不用改。缩放的取值范围同理由渲染层持有，UI 拿它当滑杆的 min/max。

```ts
import {
  EFFECT_REGISTRY, EFFECT_KINDS,
  MASK_PRESETS, materializePreset,
  MIN_ZOOM, MAX_ZOOM,
} from "@cardbara/renderer/v1";

const def = EFFECT_REGISTRY[kind];
def.role;          // "phase" | "color" | "alpha"——决定在渲染管线的哪一步生效
def.scope;         // "both" | "layer" | "face"——该效果能挂到哪种目标
def.maxPerTarget;  // 槽位上限（与着色器定长数组长度一致）
def.fields;        // 字段描述：key / 控件类型 / 范围 / 可见条件 / 字段级 scope

// 选中内置蒙版某档时，物化整组形状参数（只写 id 画面不会变——见 materializePreset 注释）
const params = materializePreset(MASK_PRESETS[0], { arrangement: "regular" });
```

导出的符号：`EFFECT_REGISTRY` `EFFECT_KINDS`、各槽位上限常量（`GRADIENT_MAX` `LATTICE_MAX`
`MOIRE_MAX` `GLOSS_MAX` `MASK_PRESET_MAX` `PALETTE_MAX`）、`MASK_PRESETS` `materializePreset`、
`MIN_ZOOM` `MAX_ZOOM`、`toEffectUniforms`，以及类型 `EffectDef` `EffectScope` `FieldDescriptor`
`FieldOption` `FieldType` `PackedUniforms` `MaskPreset` `EffectUniformArrays`。`CardFace` 与
`Layer` 亦自本包再导出。

> `toEffectUniforms` 把效果列表摊成分档定长 uniform 数组，是材质层把 `effects` 灌进着色器的
> 接缝——编辑器一般不直接用，仅在自建材质时按需取用。

## 资源解析：`ResolveAsset`

```ts
type ResolveAsset = (
  relPath: string,             // 系列内相对路径
  opts?: { signal?: AbortSignal },
) => Promise<Texture>;         // 返回 three 纹理
```

由调用方注入，是 renderer 与运行环境解耦的关键：浏览器可经 URL 直载，Tauri 环境则经文件
系统读字节再建纹理。**渲染器不关心图片来源。**
