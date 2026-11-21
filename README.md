# Prismwright Editor

Prismwright（棱匠）是一款本地优先的开源卡牌系列编辑器：导入卡面素材、在 3D 预览里组合
效果、编辑系列封面，并导出卡牌图片、GIF、WebM 与可导入的卡包文件。

这个仓库只包含桌面编辑器与它依赖的共享包，不包含微信小程序、云函数或任何云端发布功能。

## 组成

| 路径 | 说明 |
| --- | --- |
| `apps/desktop` | Tauri 2 + React 19 桌面编辑器 |
| `packages/card-renderer` | 基于 three.js 的 WebGL 卡牌渲染器（MIT） |
| `packages/card-schema` | `pack.json` 的 zod schema 与资产收集 |
| `scripts` | 构建与 ffmpeg 下载脚本 |

## 开发

需要 Node.js 20+、pnpm 11、Rust stable（构建 Tauri）。Windows 还需要 WebView2
（Windows 10/11 自带）。

```bash
pnpm install
pnpm dev          # 启动 Tauri 桌面端
pnpm dev:web      # 只在浏览器里跑前端
pnpm test         # 全部单元测试
pnpm lint
pnpm typecheck
```

## 构建

```bash
pnpm build                       # 前端产物（apps/desktop/dist）
pnpm -F @prismwright/desktop tauri build     # 桌面安装包
```

导出 WebM 需要 ffmpeg：程序优先使用打包进资源的 ffmpeg（本地构建时放在
`apps/desktop/src-tauri/binaries/ffmpeg/`），找不到时回退到 `PATH` 上的 `ffmpeg`。
可以用 `pnpm fetch:ffmpeg` 下载构建辅助脚本使用的版本。

## 数据

系列数据完全保存在本地目录里，由 `pack.json` 描述。编辑器不会上传任何数据，也不依赖
云端账号或密钥。

## 许可

MIT，见 [LICENSE](LICENSE)。
