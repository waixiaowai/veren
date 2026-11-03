/**
 * The intake dock's fold rule, kept React-free so the O7 contract is testable
 * without a browser or a component runtime.
 *
 * Up to three overdue cards the dock keeps its full list; from four it folds
 * to one count line until the reader expands it, so the canvas keeps its
 * height until the queue is asked for.
 *
 * 进料口的折叠规则，保持无 React，于是 O7 约定无需浏览器或组件运行时即可测试。
 *
 * 过期卡不超过三张时进料口保持完整列表；四张起收成一行计数，读者展开才让出画布
 * 高度，直到队列被要看。
 *
 * @module @veren/notebook-ui/client/canvas-dock-fold
 */

/** Up to this many overdue cards the dock keeps its full list. 过期卡不超过此数时进料口保持完整列表。 */
export const DOCK_VISIBLE_LIMIT = 3

/**
 * Whether the queue folds, and whether its rows show right now.
 * @param count - overdue cards in the queue.
 * @param expanded - whether the reader opened the folded queue.
 * @returns the fold state and whether rows render.
 *
 * 队列是否折叠、此刻是否显示各行。
 */
export function dockView(count: number, expanded: boolean): { readonly folded: boolean; readonly showRows: boolean } {
  const folded = count > DOCK_VISIBLE_LIMIT
  return { folded, showRows: expanded || !folded }
}
