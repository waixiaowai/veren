/**
 * Fixed-window rate limiting of sign-in attempts.
 *
 * Counters are keyed by email and peer address, so one flooded account cannot
 * lock out another, and the window restarts on the first attempt after expiry.
 *
 * 登录尝试的固定窗口限流。计数按邮箱与对端地址索引，因此刷爆一个账号不会锁死另一个；
 * 窗口过期后的第一次尝试会重开窗口。
 *
 * @module @veren/admin-auth-local/login-limit
 */

import { AdminError } from '@veren/admin-contract'
import { normalizeEmail } from './store.ts'
import type { ResolvedAuthConfig } from './config.ts'

/** Fixed-window counters for sign-in attempts. 登录尝试的固定窗口计数。 */
interface AttemptBucket {
  /** Window start, epoch milliseconds. 窗口起点（毫秒）。 */
  start: number
  /** Attempts inside the window. 窗口内尝试次数。 */
  count: number
}

/** Consumes sign-in attempts and refuses once the budget is spent. 消耗登录尝试预算，超支即拒绝。 */
export class LoginRateLimiter {
  /** Sign-in attempt counters keyed by email and peer address. 按邮箱与对端地址索引的登录计数。 */
  private readonly attempts = new Map<string, AttemptBucket>()

  /**
   * @param config - resolved auth config 解析后的认证配置
   */
  constructor(private readonly config: ResolvedAuthConfig) {}

  /**
   * Consume one sign-in attempt, refusing when the budget is spent.
   *
   * @param email - attempted email 尝试的邮箱
   * @param ip - peer address 对端地址
   */
  assertAllowed(email: string, ip: string | undefined): void {
    const key = `${normalizeEmail(email)}|${ip ?? 'unknown'}`
    const now = Date.now()
    const windowMs = this.config.loginRateLimit.window * 1000
    const bucket = this.attempts.get(key)
    if (bucket === undefined || now - bucket.start >= windowMs) {
      this.attempts.set(key, { start: now, count: 1 })
      return
    }
    bucket.count += 1
    if (bucket.count > this.config.loginRateLimit.max) {
      throw new AdminError('RATE_LIMITED', 'too many sign-in attempts', { window: this.config.loginRateLimit.window })
    }
  }
}
