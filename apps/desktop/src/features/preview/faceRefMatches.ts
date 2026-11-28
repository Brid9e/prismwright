/**
 * 预览交互请求的目标卡面是否正是当前显示的那一面。
 *
 * 擦除画笔等请求是在检查器里发起的（记下「写回哪个卡面」），而预览同一时刻只显示一张。
 * 两边对不上时不能落点：否则在背面视图里画正面的效果，笔迹会写到看不见的那一面。
 */
import type { FaceRef } from "../../store/packStore"

export function faceRefMatches(
  ref: FaceRef,
  side: "front" | "back",
  selectedCardId: string | null,
): boolean {
  if (ref.kind === "back") return side === "back"
  return side === "front" && ref.cardId === selectedCardId
}
