/**
 * 全系列共用的默认卡背：数据工厂、目录判定与读取。
 *
 * **为什么是一份独立的系列工程**：卡背的编辑要用整套编辑器（图层、效果、拾色、擦除、
 * 实时预览），这套东西全部长在 `usePackStore` 上。与其为一个全局对象再造一套精简版的
 * 编辑链路，不如把默认卡背做成应用数据目录下的一份**普通系列**（`<appData>/default-back/`），
 * 编辑时按打开系列的方式打开它——所见即所得地复用全部能力，改动天然进撤销栈、走自动保存。
 *
 * 这份工程的 `pack.back` 就是默认卡背；没有自己的卡背的系列在预览与发布时都取它。
 * 数据只此一份，改一次即全体生效（见 `PreviewPanel` 与 `PublishDialog`）。
 *
 * 本文件只放**纯逻辑**：不读盘、不碰 store，IO 由 {@link loadDefaultBack} 注入。
 */
import {
  CardFaceSchema,
  EffectSchema,
  createLayer,
  createTextLayer,
  newId,
  parsePack,
  type CardFace,
  type Pack,
} from "@prismwright/schema"
import { EFFECT_REGISTRY } from "@prismwright/renderer/v1"

/** 应用数据目录下默认卡背工程的末级目录名。 */
export const DEFAULT_BACK_DIR_NAME = "default-back"

/**
 * 内置的默认卡背造型：一层全息底纹 + 一行品牌字。
 *
 * 只作**首次创建时**的种子——之后它只是一份普通数据，用户在编辑器里怎么改都行。
 * 刻意不带任何图片：默认卡背被所有系列共用，引用系列内的素材会在别的系列里全部失效。
 */
export function createDefaultBackFace(): CardFace {
  const holo = createLayer("")
  // `params` 在 schema 里是必填对象（各字段有自己的默认值），故走注册表的 defaultParams。
  holo.effects = [
    EffectSchema.parse({
      kind: "palette",
      id: newId(),
      params: EFFECT_REGISTRY.palette.defaultParams(),
    }),
    EffectSchema.parse({
      kind: "gradient",
      id: newId(),
      params: EFFECT_REGISTRY.gradient.defaultParams(),
    }),
  ]
  const text = createTextLayer("", "PRISMWRIGHT")
  if (text.text) {
    text.text.fontSize = 0.09
    text.text.letterSpacing = 0.08
  }
  return CardFaceSchema.parse({ layers: [holo, text] })
}

/**
 * 两个目录路径是否指向同一处。
 *
 * 盘上取回的路径可能混着 `/` 与 `\`、可能带收尾分隔符；Windows 的路径本身大小写不敏感。
 * 一律规整到 `/` + 小写再比，避免「明明是同一个目录却被当成两个系列」。
 */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  return normalize(a) === normalize(b)
}

/** 当前打开的系列是否就是默认卡背工程。 */
export function isDefaultBackPack(
  rootDir: string | null | undefined,
  defaultRoot: string | null | undefined,
): boolean {
  return samePath(rootDir, defaultRoot)
}

/**
 * 发布前把默认卡背「装进」系列副本。
 *
 * 系列有自己的卡背就原样返回；没有且存在默认卡背时，返回一个 `back` 被填上的浅拷贝。
 * 只改副本——本地 `pack.json` 保持 `back: null`，默认卡背始终只有全局一份，改了它
 * 下次发布自然带上新的。
 *
 * @param pack - 当前系列。
 * @param defaultFace - 默认卡背；没有时 `null`。
 * @returns 可交给发布管线的系列。
 */
export function withDefaultBack(pack: Pack, defaultFace: CardFace | null): Pack {
  if (pack.back || !defaultFace) return pack
  return { ...pack, back: defaultFace }
}

/** {@link loadDefaultBack} 的外部依赖（生产环境接 `packFs` / `join`）。 */
export interface DefaultBackIoDeps {
  /** 默认卡背工程的绝对目录。 */
  defaultRoot: string
  /** 该目录是否是一份系列（含 `pack.json`）。 */
  isPackDir: (dir: string) => Promise<boolean>
  /** 读文本文件。 */
  readText: (path: string) => Promise<string>
  /** 拼接绝对路径。 */
  join: (...parts: string[]) => string
}

/**
 * 读回默认卡背。
 *
 * 工程不存在、还没做卡背、文件读不动或数据不合法，一律返回 `null`——启动与预览都不该
 * 因为一份坏了 / 还没建的偏好数据而报错。
 *
 * @param deps - 目录与 IO（见 {@link DefaultBackIoDeps}）。
 * @returns 默认卡背；没有时 `null`。
 */
export async function loadDefaultBack(deps: DefaultBackIoDeps): Promise<CardFace | null> {
  try {
    if (!(await deps.isPackDir(deps.defaultRoot))) return null
    const text = await deps.readText(deps.join(deps.defaultRoot, "pack.json"))
    return parsePack(JSON.parse(text)).back ?? null
  } catch {
    // 读不动 / 解析失败都按「没有默认卡背」处理，交给内置造型的兜底（见调用方）。
    return null
  }
}
