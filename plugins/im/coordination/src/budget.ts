/**
 * The low-priority wake budget: a sliding-window counter that stops synthetic
 * fan-out from becoming a storm (design §4.2: 低优先唤醒每进程每分钟 20 次).
 *
 * Budget refusal drops the wake without queueing — the next message re-evaluates
 * anyway. Human-driven wakes (direct rooms, mentions) never touch this budget.
 *
 * 低优先唤醒预算：滑动窗口计数器，防止合成的扇出演变成风暴（设计 §4.2：低优先唤醒每进程
 * 每分钟 20 次）。
 *
 * 预算拒绝直接丢弃唤醒、不排队——下一条消息反正会重新评估。人类驱动的唤醒（私聊、点名）
 * 从不消耗这份预算。
 *
 * @module @veren/im-coordination/budget
 */

/** One sliding-window budget ring. */
/** 一只滑动窗口预算环。 */
export class BudgetRing {
  private readonly hits: number[] = []

  /**
   * @param max - allowed hits inside the window.
   * @param windowMs - the sliding window length.
   * @param now - injectable clock.
   */
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether one more hit fits inside the window; records it when it does. */
  /** 窗口内是否还装得下一次；装得下就记录。 */
  take(): boolean {
    const at = this.now()
    while (this.hits.length > 0 && at - this.hits[0]! >= this.windowMs) {
      this.hits.shift()
    }
    if (this.hits.length >= this.max) return false
    this.hits.push(at)
    return true
  }

  /** Current occupancy (observability). */
  /** 当前占用（观测面）。 */
  occupancy(): number {
    const at = this.now()
    while (this.hits.length > 0 && at - this.hits[0]! >= this.windowMs) {
      this.hits.shift()
    }
    return this.hits.length
  }
}
