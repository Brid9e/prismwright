/**
 * 面板内颜色取色器：色块触发器 + 弹层里的 HSV / 色相 / 透明度 / hex。
 *
 * 不再使用系统 `<input type="color">`：它弹系统面板、样式不可控，也不支持透明度。
 * 透明度仍存在色值本身（`#rrggbbaa`），100% 时输出 6 位，与 schema 的 `withAlpha` 一致。
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { useTranslation } from "react-i18next"
import * as Popover from "@radix-ui/react-popover"
import * as RadixSlider from "@radix-ui/react-slider"
import { alphaOf } from "@prismwright/schema"
import {
  hexToHsv,
  hsvToHex,
  normalizeHexInput,
  type Hsv,
} from "./color-picker-math"

export interface ColorPickerProps {
  /** `#rrggbb` / `#rrggbbaa`；空串 = 未设置。 */
  value: string
  onChange: (hex: string) => void
  /** 可访问名（所在字段的文案）。 */
  ariaLabel: string
  /** 色块尺寸：效果栈 / 卡面面板用 `sm`，文字面板用 `md`。 */
  size?: "sm" | "md"
  /** 是否在触发器里显示十六进制文本；渐变色标行空间窄，关掉只留色块。 */
  showHex?: boolean
}

/** 无有效色值时的种子：白色（HSV 表达，避免在组件里写 hex 字面量）。 */
const FALLBACK_HSV: Hsv = { h: 0, s: 0, v: 1 }

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 取色器的内部状态：无有效色值时从一个白色种子开始，但触发器仍显示为空。 */
function seed(value: string): { hsv: Hsv; alpha: number } {
  const normalized = normalizeHexInput(value)
  if (!normalized) return { hsv: FALLBACK_HSV, alpha: 1 }
  return { hsv: hexToHsv(normalized), alpha: alphaOf(normalized) }
}

export function ColorPicker({
  value,
  onChange,
  ariaLabel,
  size = "sm",
  showHex = false,
}: ColorPickerProps) {
  const { t } = useTranslation("common")
  const initial = seed(value)
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<Hsv>(initial.hsv)
  const [alpha, setAlpha] = useState(initial.alpha)
  const [draft, setDraft] = useState(() => normalizeHexInput(value) ?? "")
  const dragging = useRef(false)
  const svRef = useRef<HTMLDivElement>(null)

  // 外部值变化（拾色、撤销、换图层）时把内部状态拉回来；拖动期间不覆盖，避免回弹。
  useEffect(() => {
    if (dragging.current) return
    const next = seed(value)
    setHsv(next.hsv)
    setAlpha(next.alpha)
    setDraft(normalizeHexInput(value) ?? "")
  }, [value])

  function commit(nextHsv: Hsv, nextAlpha: number) {
    setHsv(nextHsv)
    setAlpha(nextAlpha)
    onChange(hsvToHex(nextHsv, nextAlpha))
  }

  function updateSv(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const s = clamp01((event.clientX - rect.left) / rect.width)
    const v = 1 - clamp01((event.clientY - rect.top) / rect.height)
    commit({ ...hsv, s, v }, alpha)
  }

  function onSvPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    updateSv(event)
  }

  function onSvPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    updateSv(event)
  }

  function endSvDrag() {
    dragging.current = false
  }

  function onSvKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.01
    let next: Hsv | null = null
    if (event.key === "ArrowLeft") next = { ...hsv, s: clamp01(hsv.s - step) }
    else if (event.key === "ArrowRight") next = { ...hsv, s: clamp01(hsv.s + step) }
    else if (event.key === "ArrowDown") next = { ...hsv, v: clamp01(hsv.v - step) }
    else if (event.key === "ArrowUp") next = { ...hsv, v: clamp01(hsv.v + step) }
    if (!next) return
    event.preventDefault()
    commit(next, alpha)
  }

  function onHexChange(input: string) {
    setDraft(input)
    const normalized = normalizeHexInput(input)
    if (!normalized) return
    const next = seed(normalized)
    setHsv(next.hsv)
    setAlpha(next.alpha)
    onChange(normalized)
  }

  const displayHex = normalizeHexInput(value) ?? ""
  const swatchSize = size === "md" ? "h-7 w-9" : "h-6 w-7"
  const pickerStyle = { "--picker-hue": `${hsv.h}` } as CSSProperties
  const alphaStyle = { "--picker-color": hsvToHex(hsv, 1) } as CSSProperties

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          className={`flex shrink-0 items-center gap-2 rounded-control border border-line-soft bg-sunken px-1 outline-none hover:border-line focus-visible:ring-2 focus-visible:ring-accent/50 ${
            showHex ? "h-control" : "h-7"
          }`}
        >
          <span
            className={`checkerboard relative block shrink-0 overflow-hidden rounded-chip border border-line-soft ${swatchSize}`}
          >
            <span
              className="absolute inset-0 rounded-chip"
              style={{ backgroundColor: displayHex || "transparent" }}
            />
          </span>
          {showHex && (
            <span className="min-w-0 truncate font-mono text-num text-muted">
              {displayHex || "—"}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-56 rounded-card border border-line-soft bg-elevated p-3 outline-none popover-shadow"
        >
          <div className="flex flex-col gap-2">
            <div
              ref={svRef}
              role="slider"
              tabIndex={0}
              aria-label={t("colorPicker.saturationValue")}
              aria-valuetext={`S ${Math.round(hsv.s * 100)}% · V ${Math.round(hsv.v * 100)}%`}
              style={pickerStyle}
              onPointerDown={onSvPointerDown}
              onPointerMove={onSvPointerMove}
              onPointerUp={endSvDrag}
              onPointerCancel={endSvDrag}
              onKeyDown={onSvKeyDown}
              className="color-sv-field relative h-32 w-full cursor-crosshair touch-none rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <span
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
              />
            </div>

            <RadixSlider.Root
              value={[hsv.h]}
              min={0}
              max={360}
              step={1}
              aria-label={t("colorPicker.hue")}
              onValueChange={([h]) => commit({ ...hsv, h }, alpha)}
              className="relative flex h-control touch-none select-none items-center"
            >
              <RadixSlider.Track className="color-hue-track relative h-control w-full grow overflow-hidden rounded-control">
                <RadixSlider.Thumb className="block h-control w-2 rounded-chip bg-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
              </RadixSlider.Track>
            </RadixSlider.Root>

            <RadixSlider.Root
              value={[alpha]}
              min={0}
              max={1}
              step={0.01}
              aria-label={t("colorPicker.alpha")}
              onValueChange={([a]) => commit(hsv, a)}
              className="relative flex h-control touch-none select-none items-center"
            >
              <RadixSlider.Track
                style={alphaStyle}
                className="color-alpha-track relative h-control w-full grow overflow-hidden rounded-control"
              >
                <RadixSlider.Thumb className="block h-control w-2 rounded-chip bg-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
              </RadixSlider.Track>
            </RadixSlider.Root>

            <div className="flex items-center gap-2">
              <span className="text-label text-muted">HEX</span>
              <input
                value={draft}
                aria-label={t("colorPicker.hex")}
                onChange={(e) => onHexChange(e.target.value)}
                onBlur={() => setDraft(displayHex)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setDraft(displayHex)
                }}
                className="h-control min-w-0 flex-1 rounded-control border border-line-soft bg-sunken px-1.5 font-mono text-num text-foreground outline-none focus:border-accent"
              />
              <span className="w-8 shrink-0 text-right text-num tabular-nums text-muted">
                {Math.round(alpha * 100)}%
              </span>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
