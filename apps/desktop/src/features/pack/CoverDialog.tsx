/**
 * 「系列封面」对话框：给当前系列配大封面（5:2）、小封面（1:1）与卡包图。
 *
 * 大 / 小封面选完静态图先进裁剪器：拖动 / 缩放定构图，按封面比例裁好（大 1200×480、
 * 小 384×384）再压成 WebP，透明通道保留。卡包图不限比例、不进裁剪器：整张铺到抽卡页
 * 袋面上，超出袋子的部分由皮肤裁掉，导入时只做等比缩小。GIF 与动图 WebP 不能走画布
 * （动画会被压成静图），仍然只做比例校验（卡包图跳过），不合就整张拒绝并说出实际尺寸。
 * 尺寸 / 体积超限只提示、不拦截，因为那时数据已经落盘了。
 *
 * 导入成功即写回 `pack.coverLarge` / `pack.coverSmall`（裁剪结果走
 * `packStore.importCoverBytes`，原图兜底走 `importCover`，都是一次 `commit` 进撤销栈），
 * 所以对话框没有「保存」步骤：点确定只是关窗。
 * 预览用 object URL 从系列内读字节再解码，换图 / 关窗时立刻释放。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { DEFAULT_PACK_ART_STYLE } from "@prismwright/schema"
import { usePackStore } from "../../store/packStore"
import { useUiStore } from "../../store/uiStore"
import { DialogShell } from "../../ui/Dialog"
import { packFs } from "../../tauri/pack-fs"
import { COVER_EXTENSIONS, coverFieldOf, isCoverOversize, type CoverKind } from "./cover"
import { CoverCrop } from "./CoverCrop"
import { PackArtPreview } from "./PackArtPreview"
import { PackArtStyleFields } from "./PackArtStyleFields"
import { isAnimatedWebp } from "./cover-image"
import { measureCover, mimeOfExt } from "./cover-measure"

/** 相对路径的扩展名（小写、不含前导点）。 */
function extensionOf(rel: string): string {
  const dot = rel.lastIndexOf(".")
  return dot < 0 ? "" : rel.slice(dot + 1).toLowerCase()
}

/** 给 Blob 标注 MIME 类型。 */
function mimeOf(rel: string): string {
  return mimeOfExt(extensionOf(rel))
}

export function CoverDialog() {
  const { t } = useTranslation("editor")
  const open = useUiStore((s) => s.coverOpen)
  const setCoverOpen = useUiStore((s) => s.setCoverOpen)
  const rootDir = usePackStore((s) => s.rootDir)

  // 比两张封面的槽位宽一截：卡包图那一格右边跟着一整列合成参数。
  return (
    <DialogShell
      open={open}
      title={t("pack.coverTitle")}
      onClose={() => setCoverOpen(false)}
      className="w-[600px] max-w-[calc(100vw-32px)] p-3"
    >
      <div className="flex flex-col gap-2">
        <CoverSlot kind="large" rootDir={rootDir ?? ""} />
        <CoverSlot kind="small" rootDir={rootDir ?? ""} />
        <CoverSlot kind="pack" rootDir={rootDir ?? ""} />
        <CoverSlot kind="frame" rootDir={rootDir ?? ""} />
        <CoverSlot kind="seriesAvatar" rootDir={rootDir ?? ""} />
        <CoverSlot kind="achievement" rootDir={rootDir ?? ""} />
      </div>
      {/* 没有「保存」：导入成功时已经写进 pack 并进了撤销栈，这里只负责关窗。 */}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setCoverOpen(false)}
          className="h-6 rounded-sm bg-accent px-3 text-[12px] text-accent-foreground hover:bg-accent-hover"
        >
          {t("common:action.confirm")}
        </button>
      </div>
    </DialogShell>
  )
}

interface CoverSlotProps {
  kind: CoverKind
  /** 系列根目录；空串表示还没绑定（此时没有 rel 可读）。 */
  rootDir: string
}

/** 单个封面槽位：预览、选图 / 更换、清除与错误提示。 */
function CoverSlot({ kind, rootDir }: CoverSlotProps) {
  const { t } = useTranslation("editor")
  const field = coverFieldOf(kind)
  const rel = usePackStore((s) => s.pack?.[field] ?? "")
  // 卡包图的合成参数；两张封面不读它，这里统一取一次，`pack` 未加载时退回默认。
  const packArtStyle = usePackStore((s) => s.pack?.packArtStyle)
  const importCover = usePackStore((s) => s.importCover)
  const importCoverBytes = usePackStore((s) => s.importCoverBytes)
  const commit = usePackStore((s) => s.commit)

  const [preview, setPreview] = useState<string | null>(null)
  /** 正在导入：期间禁止重复点击，免得两次导入争同一个字段。 */
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 超长边 / 超体积提示；只提示不拦截（数据此时已经在盘上了）。 */
  const [oversize, setOversize] = useState(false)
  /** 待裁剪的静态图；非空时槽位换成裁剪器。 */
  const [crop, setCrop] = useState<{
    bytes: Uint8Array
    ext: string
    width: number
    height: number
  } | null>(null)

  // 各种图共用一套槽位，文案按 kind 取。
  const label =
    kind === "large"
      ? t("pack.cover.large")
      : kind === "small"
        ? t("pack.cover.small")
        : kind === "pack"
          ? t("pack.cover.packArt")
          : kind === "frame"
            ? t("pack.cover.frame")
            : kind === "seriesAvatar"
              ? t("pack.cover.seriesAvatar")
              : t("pack.cover.achievement")
  const hint =
    kind === "large"
      ? t("pack.cover.largeHint")
      : kind === "small"
        ? t("pack.cover.smallHint")
        : kind === "pack"
          ? t("pack.cover.packArtHint")
          : kind === "frame"
            ? t("pack.cover.frameHint")
            : kind === "seriesAvatar"
              ? t("pack.cover.seriesAvatarHint")
              : t("pack.cover.achievementHint")
  // 比例文案服务两张封面与头像框；卡包图不限比例，导入时不会报比例错。
  const ratio = kind === "large" ? t("pack.cover.ratioLarge") : t("pack.cover.ratioSmall")

  // rel / 根目录变了就重读字节。每次都在 effect 内新建 object URL，并在 cleanup 里释放：
  // 换图、清除、关窗（组件随 Radix 卸载）都不会留下悬挂的 blob。
  // GIF 在 `<img>` 里照常播放，因为写进去的是原始字节而非重编码后的静帧。
  useEffect(() => {
    setError(null)
    if (!rel || !rootDir) {
      setPreview(null)
      setOversize(false)
      return
    }
    let cancelled = false
    let url: string | null = null
    void (async () => {
      try {
        const bytes = await packFs.readAssetBytes(rootDir, rel)
        if (cancelled) return
        url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(rel) }))
        setPreview(url)
        // 体积提示按磁盘上的实际字节判断——文件已经写进去了，这里只负责提醒。
        try {
          const { width, height } = await measureCover(new Uint8Array(bytes), extensionOf(rel))
          if (!cancelled) setOversize(isCoverOversize(width, height, bytes.byteLength))
        } catch {
          // 读不出尺寸就不提示：比例在导入时已经校验过，这里不该因此打断预览。
          if (!cancelled) setOversize(false)
        }
      } catch {
        if (!cancelled) {
          setPreview(null)
          setOversize(false)
        }
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [rel, rootDir])

  async function pick(): Promise<void> {
    if (busy) return
    // 过滤器名称用「选择图片」而不是固定「图片」：与按钮文案一致，切语言时也跟着走。
    const src = await packFs.pickFile([
      { name: t("pack.cover.pick"), extensions: [...COVER_EXTENSIONS] },
    ])
    if (!src) return
    setBusy(true)
    setError(null)
    try {
      // 卡包图整张铺到袋面上、超出部分由皮肤裁掉，比例不限——没有构图要裁，直接导入。
      if (kind === "pack") {
        const result = await importCover(kind, src)
        if (!result.ok) showImportError(result)
        return
      }
      const ext = extensionOf(src)
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await packFs.readFileBytes(src))
      } catch {
        setError(t("pack.cover.importFailed"))
        return
      }
      // 动图不能过画布：只解首帧，重编码会把动画压成静图。这类图仍走比例校验的老路。
      if (ext === "gif" || (ext === "webp" && isAnimatedWebp(bytes))) {
        const result = await importCover(kind, src)
        if (!result.ok) showImportError(result)
        return
      }
      // 静态图先去裁剪：任何比例都能用，用户自己定构图。
      const size = await measureCover(bytes, ext)
      setCrop({ bytes, ext, width: size.width, height: size.height })
    } catch {
      setError(t("pack.cover.importFailed"))
    } finally {
      setBusy(false)
    }
  }

  /** 导入失败按原因翻译；只剩动图的这几条老分支。 */
  function showImportError(result: {
    reason: string
    width?: number
    height?: number
    aspect?: string
  }): void {
    if (result.reason === "aspect") {
      setError(
        t("pack.cover.aspectError", {
          label,
          ratio,
          width: result.width,
          height: result.height,
          aspect: result.aspect,
        }),
      )
    } else if (result.reason === "unsupported-format") {
      setError(t("pack.cover.formatError"))
    } else {
      setError(t("pack.cover.importFailed"))
    }
  }

  /** 裁剪器确认：字节已经裁好、转好 WebP，直接落盘进撤销栈。 */
  async function applyCrop(bytes: Uint8Array, ext: string): Promise<void> {
    const result = await importCoverBytes(kind, bytes, ext)
    if (!result.ok) {
      setError(t("pack.cover.importFailed"))
      return
    }
    setCrop(null)
  }

  /** 清除只把字段置空（可撤销）；磁盘上的文件保留，与换图不删旧文件同一取舍。 */
  function clear(): void {
    if (busy) return
    setError(null)
    commit((d) => {
      d[coverFieldOf(kind)] = ""
    })
  }

  return (
    <div className="rounded-sm border border-border-subtle p-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="shrink-0 text-[12px] font-medium text-foreground">{label}</span>
        <span className="min-w-0 truncate text-[11px] text-muted" title={hint}>
          {hint}
        </span>
      </div>
      {crop ? (
        <CoverCrop
          kind={kind}
          bytes={crop.bytes}
          ext={crop.ext}
          width={crop.width}
          height={crop.height}
          onCancel={() => setCrop(null)}
          onConfirm={applyCrop}
        />
      ) : kind === "pack" ? (
        // 卡包图槽位多一列合成参数：左边 2:3 的袋面预览随参数即时变化。
        <div className="flex gap-2">
          <div className="flex shrink-0 flex-col gap-1.5">
            <PackArtPreview
              artSrc={preview}
              style={packArtStyle ?? DEFAULT_PACK_ART_STYLE}
              className="h-60 w-40 rounded-sm border border-border"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void pick()}
              className="h-6 w-40 rounded-sm border border-border-subtle text-[12px] text-foreground hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rel ? t("pack.cover.replace") : t("pack.cover.pick")}
            </button>
            <button
              type="button"
              disabled={busy || !rel}
              onClick={clear}
              className="h-6 w-40 rounded-sm border border-border-subtle text-[12px] text-muted hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("pack.cover.clear")}
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <PackArtStyleFields />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-sunken">
            {preview ? (
              <img src={preview} alt={label} className="h-full w-full object-contain" />
            ) : (
              <span className="text-[11px] text-muted">{t("pack.cover.empty")}</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void pick()}
              className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-foreground hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rel ? t("pack.cover.replace") : t("pack.cover.pick")}
            </button>
            <button
              type="button"
              disabled={busy || !rel}
              onClick={clear}
              className="h-6 rounded-sm border border-border-subtle px-3 text-[12px] text-muted hover:bg-elevated hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("pack.cover.clear")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[11px] leading-relaxed text-danger">{error}</p>}
      {oversize && (
        <p className="mt-2 text-[11px] leading-relaxed text-warning">{t("pack.cover.oversize")}</p>
      )}
    </div>
  )
}
