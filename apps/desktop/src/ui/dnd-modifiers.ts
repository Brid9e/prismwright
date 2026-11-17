/**
 * dnd-kit 拖拽修饰器：把拖拽限制在竖直轴。
 *
 * 编辑器里两个可拖拽列表（图层树、卡片树）都是竖向排列，条目只该上下换位。dnd-kit 默认让
 * 被拖行跟着指针自由移动，于是它会左右飘——既不像「换位」，落点高亮也跟着晃。这里把
 * transform 的水平分量归零，只保留竖直位移。
 *
 * 不引 `@dnd-kit/modifiers`：它的同名实现捆绑了一整包修饰器，本处只用一个，不值得为它加依赖。
 */
import type { Modifier } from "@dnd-kit/core"

/** 把水平位移归零、其余分量原样透传。 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 })
