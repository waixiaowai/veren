/**
 * Fixed-window rate limiting for the API gateway.
 *
 * Buckets are keyed by caller and route, so one flooded endpoint cannot spend
 * another endpoint's budget, and a window restarts on the first hit after it
 * expires.
 *
 * API 网关的固定窗口限流。桶按调用方与路由索引，因此刷爆一个端点不会花掉另一个端点
 * 的预算；窗口过期后的第一次命中会重开窗口。
 *
 * @module @veren/admin-api-kernel/limiter
 */

import { AdminError, type AdminRoute } from '@veren/admin-contract'
import type { RequestFacts } from './http.ts'

/** One bucket of the fixed-window limiter. 固定窗口限流器的单个桶。 */
interface Bucket {
  /** Window start, epoch milliseconds. 窗口起点（毫秒）。 */
  start: number
  /** Hits inside the window. 窗口内命中次数。 */
  count: number
}

/** The budget one limiter enforces. 单个限流器执行的预算。 */
export interface RateLimitBudget {
  /** Window length in seconds. 窗口长度（秒）。 */
  readonly window: number
  /** Maximum hits inside one window. 单窗口最大命中数。 */
  readonly max: number
}

/** Consumes rate-limit tokens per caller and route. 按调用方与路由消耗限流令牌。 */
export class FixedWindowLimiter {
  /** Buckets keyed by caller and route. 按调用方与路由索引的桶。 */
  private readonly buckets = new Map<string, Bucket>()

  /**
   * @param budget - the enforced budget 执行的预算
   */
  constructor(private readonly budget: RateLimitBudget) {}

  /**
   * Consume one rate-limit token.
   *
   * @param facts - request facts 请求事实
   * @param route - matched route 匹配路由
   */
  consume(facts: RequestFacts, route: AdminRoute): void {
    const key = `${facts.ip}|${route.audience}|${route.method}|${route.path}`
    const now = Date.now()
    const windowMs = this.budget.window * 1000
    const bucket = this.buckets.get(key)
    if (bucket === undefined || now - bucket.start >= windowMs) {
      this.buckets.set(key, { start: now, count: 1 })
      return
    }
    bucket.count += 1
    if (bucket.count > this.budget.max) {
      throw new AdminError('RATE_LIMITED', 'too many requests', { window: this.budget.window })
    }
  }
}
