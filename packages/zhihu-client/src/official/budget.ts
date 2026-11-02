/**
 * 本地日调用预算：官方免费额度之外的一层保险。
 *
 * 平台的额度是它说了算的（`/quota` 读数随时可能变），本地的日上限是**我们**
 * 说了算的：一天最多发 N 次请求，超了就响亮地停。这样即便平台额度读数失灵，
 * 也不会把额度一天烧光。
 *
 * The local daily call budget: one insurance layer above the platform's own
 * allowance.
 *
 * The platform's allowance is its call (the `/quota` reading may change at any
 * moment); the local daily cap is *ours*: at most N requests a day, then a
 * loud stop. So even if the platform's reading misbehaves, the allowance is
 * not burned through in one day.
 *
 * @module @veren/zhihu-client/official/budget
 */
import { ZhihuError, ZhihuErrorCode } from '../errors.ts'

/** 预算的钟面来源（注入以便测试）/ the budget's clock source (injected for tests) */
export type Clock = () => number

/**
 * 一个按自然日重置的调用计数上限。
 * A call counter that resets on each calendar day.
 */
export class DailyCallBudget {
  private readonly limit: number
  private readonly clock: Clock
  private day = ''
  private used = 0

  /**
   * @param limit - the daily cap; a non-positive cap means "no cap" / 每日上限；非正数表示不限
   * @param clock - the clock source / 钟面来源
   */
  constructor(limit: number, clock: Clock = () => Date.now()) {
    this.limit = limit
    this.clock = clock
  }

  /** 今天已用的调用数 / how many calls were made today */
  usedToday(): number {
    this.rollIfNewDay()
    return this.used
  }

  /**
   * 记一次调用；超上限就抛 ZHIHU_DAILY_CAP_REACHED。
   * Records one call; over the cap throws ZHIHU_DAILY_CAP_REACHED.
   *
   * @param endpoint - the endpoint being called / 调用中的端点名
   * @throws ZhihuError when the daily cap is reached / 日上限到了
   */
  consume(endpoint: string): void {
    this.rollIfNewDay()
    if (this.limit > 0 && this.used >= this.limit) {
      throw new ZhihuError(
        ZhihuErrorCode.DailyCapReached,
        `the local daily call cap (${this.limit}) is reached; the pull stops here`,
        { endpoint, dailyCap: this.limit, usedToday: this.used },
      )
    }
    this.used += 1
  }

  /** 跨日则重置计数 / reset the counter when the day rolled over */
  private rollIfNewDay(): void {
    const today = this.todayKey()
    if (today !== this.day) {
      this.day = today
      this.used = 0
    }
  }

  /** 今天的日期键（本地时区）/ today's date key (local time) */
  private todayKey(): string {
    const now = new Date(this.clock())
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
  }
}
