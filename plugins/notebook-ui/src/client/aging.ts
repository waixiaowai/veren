/**
 * The aging labels: turning one derived `expiresAt` into the countdown text
 * the list rows, the canvas nodes, and the intake dock all share. Pure and
 * time-explicit — `nowMs` is a parameter, so a render never hides a clock read
 * and the labels stay trivially testable.
 *
 * 老化文案：把一个派生的 `expiresAt` 变成列表行、画布节点与进料口共用的倒计时
 * 文本。纯函数、时间显式——`nowMs` 是参数，渲染不藏时钟读取，文案也因此易测。
 *
 * @module @veren/notebook-ui/client/aging
 */

/** One day in milliseconds; keep in step with the Host's `DAY_MS`. 一天的毫秒数；与宿主的 `DAY_MS` 保持一致。 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** Which label to render, and the day count it names. 渲染哪条文案，以及它说的天数。 */
export interface AgingLabel {
  readonly key: 'dueIn' | 'overdueFor'
  readonly days: number
}

/**
 * Derive the aging label for one deadline relative to `nowMs`.
 * @param expiresAt - the derived deadline (ISO), from the graph face.
 * @param nowMs - the render time in epoch milliseconds.
 * @returns within the window: `dueIn` with ≥1 whole days left; past it:
 *   `overdueFor` with ≥1 whole days overdue.
 *
 * 相对 `nowMs` 派生某到期时刻的老化文案。窗内：`dueIn` 带剩余整天数（≥1）；
 * 过窗：`overdueFor` 带已过整天数（≥1）。
 */
export function agingLabelOf(expiresAt: string, nowMs: number): AgingLabel {
  const diffMs = Date.parse(expiresAt) - nowMs
  if (diffMs > 0) {
    return { key: 'dueIn', days: Math.max(1, Math.ceil(diffMs / DAY_MS)) }
  }
  return { key: 'overdueFor', days: Math.max(1, Math.ceil(-diffMs / DAY_MS)) }
}

/**
 * Render the label through the page dictionary — the templates carry a `{d}`
 * placeholder the day count replaces.
 * @param label - the derived label.
 * @param t - the page dictionary.
 * @returns the finished text, e.g. 「剩 2 天」 / "2d left".
 *
 * 经页面词典渲染文案——模板带 `{d}` 占位，由天数替换。
 */
export function agingText(label: AgingLabel, t: (key: 'dueIn' | 'overdueFor') => string): string {
  return t(label.key).replace('{d}', String(label.days))
}
