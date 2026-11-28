/**
 * 检查器的页签定义（顺序即展示顺序）。
 *
 * 单独成模块而不是写在 `InspectorPanel` 里：UI store 要存当前页签、测试要钉顺序，
 * 两边都消费同一份常量，避免各写一套字符串。
 */
export const INSPECTOR_TABS = ["design", "layers", "effects"] as const

export type InspectorTab = (typeof INSPECTOR_TABS)[number]

/** 校验任意字符串是否为合法页签。 */
export function isInspectorTab(value: string): value is InspectorTab {
  return (INSPECTOR_TABS as readonly string[]).includes(value)
}

/**
 * 结合「当前有没有可编辑的卡面」解析最终页签。
 *
 * 没有卡面时停在「效果」或「图层」只会是一块空态，用户还找不到返回路径；统一回落
 * 「设计」页，那里至少能解释当前为什么没有内容。
 */
export function resolveInspectorTab(tab: InspectorTab, hasFace: boolean): InspectorTab {
  return hasFace ? tab : "design"
}
