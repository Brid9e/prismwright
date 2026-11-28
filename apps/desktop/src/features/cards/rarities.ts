import type { Rarity } from "@prismwright/schema"

/** 稀有度档位，顺序由低到高；展示文案走 `card.rarity.*`。 */
export const RARITIES: readonly Rarity[] = ["common", "rare", "epic", "legendary"]
