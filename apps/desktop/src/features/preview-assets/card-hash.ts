/**
 * 卡面「渲染相关内容」的哈希——用于判断一张卡自上次生成预览以来是否变过。
 *
 * 只取影响画面的字段：卡面图 `front`、卡面效果 `effects`、图层 `layers`。**不取**卡名 / 备注 /
 * 稀有度 / 序号——它们不进渲染，改它们不该白白重渲染一张卡（一张卡要渲 60 帧）。
 *
 * 序列化用 `JSON.stringify` 即足够确定：字段顺序由 zod schema 的解析顺序固定，同一份数据在
 * 会话之间必然产出同一串文本，故哈希可跨会话比较、写进清单文件。
 */
import type { Card } from "@prismwright/schema"

/**
 * 渲染规格版本：帧尺寸 / 帧率 / 帧数这类**规格**变化时升一档。
 *
 * 折进哈希，于是改规格会让所有卡的重算哈希失配、自动重生成——不必手动清缓存。
 */
export const RENDER_SPEC_VERSION = 1

/**
 * 是否生成视频预览（WebM）。
 *
 * 关掉时流水线只产出静态正视角 PNG，跳过 60 帧渲染与 ffmpeg 编码——「先不存视频」的开关。
 *
 * **必须折进哈希**（见 {@link cardRenderHash}）：切到 `false` 会让所有既有卡失配、下次落盘时重算
 * 一遍（只补 PNG）；日后切回 `true` 又会再次失配，从而为缺视频的卡补出 WebM。若只跳过编码而不折进
 * 哈希，重新开启时这些卡会被判为「没变过」，视频将永远补不出来。
 *
 * 关闭视频**不会**删除磁盘上既有的 `.webm`——那是对用户数据的破坏性动作，不做自动清理。
 */
export const GENERATE_VIDEO_PREVIEW = false

/**
 * cyrb53：紧凑、无依赖、同步的 53 位字符串哈希。
 *
 * 这里只需要「一致 + 极少碰撞」两个性质：同输入必同输出、不同输入几乎不撞（53 位 ≈ 9e15，
 * 对「一个系列里几十上百张卡」远超所需）。故不引 `crypto.subtle`——那会把纯函数变成异步，
 * 也让单元测试多一层等待，得不偿失。算法见 https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js。
 */
export function hash53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/**
 * 一张卡「渲染相关内容」的哈希。
 *
 * 除内容三件套外，还折入 {@link RENDER_SPEC_VERSION} 与 {@link GENERATE_VIDEO_PREVIEW}——
 * 二者任一变动都会让全体卡失配、触发重算，无需手动清缓存。
 *
 * @param card - 卡片内容。
 * @param aspect - 所属系列的宽高比；它不在卡上（系列级），但直接决定输出画幅，故显式传入。
 */
export function cardRenderHash(card: Card, aspect: number): string {
  const canonical = JSON.stringify({
    v: RENDER_SPEC_VERSION,
    video: GENERATE_VIDEO_PREVIEW,
    // 卡片底色直接决定没有图层覆盖时的画面。
    baseColor: card.baseColor,
    // 表面材质与玻璃参数直接改画面（反射叠加），漏掉会让预览停在哑光画面。
    finish: card.finish,
    glassStrength: card.glassStrength,
    glassRoughness: card.glassRoughness,
    glassTint: card.glassTint,
    // 卡面形状直接决定输出画幅与圆角，漏掉它换比例后预览 / 缩略图会停在旧画面。
    aspect,
    cornerRadius: card.cornerRadius,
    layers: card.layers,
  })
  return hash53(canonical)
}

/**
 * 从系列的全部卡片里挑出「需要（重新）生成预览」的卡。
 *
 * 判据是清单里的哈希与当前内容哈希不符——也包括清单里根本没有这张卡的情况。纯函数，便于单测。
 *
 * @param cards - 系列的全部卡片（`cards` 与 `hiddenCards` 合并后）。
 * @param manifest - 上次生成时记录的「卡 id → 内容哈希」。
 * @param aspect - 所属系列的宽高比（见 {@link cardRenderHash}）。
 * @returns 需要生成的卡片，顺序与入参一致。
 */
export function staleCards(
  cards: readonly Card[],
  manifest: Readonly<Record<string, string>>,
  aspect: number,
): Card[] {
  return cards.filter((card) => manifest[card.id] !== cardRenderHash(card, aspect))
}
