/**
 * 结构化错误：稳定 code + 机器可读字段（misconfiguration fails loud）。
 * Structured errors: stable codes plus machine-readable fields.
 *
 * 登录域的闭集两态（pending/expired）是给授权流 UI 用的判别面："等待"与
 * "重来"是两种完全不同的用户动作，绝不能混成一个错误字符串。
 * The login domain's closed two-state set (pending/expired) is the UI's
 * discriminated face: "keep waiting" and "start over" are different user
 * actions and must never collapse into one error string.
 *
 * @module @veren/workbuddy-protocol/errors
 */

/** 未完成——可重试，不是故障。Not finished yet — retryable, not a fault. */
export const LOGIN_PENDING_CODE = 'LOGIN_PENDING' as const

/** 未开始或已过期——调用方必须重新发起。Not started or expired — the caller must restart. */
export const LOGIN_EXPIRED_CODE = 'LOGIN_EXPIRED' as const

/** 池中没有任何可用账号。No usable account exists in the pool. */
export const NOT_SIGNED_IN_CODE = 'NOT_SIGNED_IN' as const

/** 授权尚未完成：上游明说用户还没在浏览器完成（含轮询过频的软拒绝）。 */
/** Authorization not complete yet: the upstream says the user has not finished (including the poll-cadence soft refusal). */
export class LoginPendingError extends Error {
  readonly code = LOGIN_PENDING_CODE
  constructor(message = '登录尚未完成：请先在浏览器里完成授权，再重试。') {
    super(message)
    this.name = 'LoginPendingError'
  }
}

/** 登录未开始或 state 已过期：必须重新发起，不能续用。 */
/** Sign-in not started or the state expired: restart, never resume. */
export class LoginExpiredError extends Error {
  readonly code = LOGIN_EXPIRED_CODE
  constructor(message = '授权状态已失效，请重新发起登录。') {
    super(message)
    this.name = 'LoginExpiredError'
  }
}

/** 池中没有任何可用账号：唯一出路是登录。 */
/** No usable account in the pool: signing in is the only way out. */
export class NotSignedInError extends Error {
  readonly code = NOT_SIGNED_IN_CODE
  constructor(message = '尚未登录 WorkBuddy。请先完成授权登录。') {
    super(message)
    this.name = 'NotSignedInError'
  }
}

/**
 * 上游失败闭集。闭集用 assertNever 收尾——上游新增可观测类别时编译器会
 * 逼着每个消费者表态，而不是静默落进兜底分支。
 * The closed set of upstream failure classes. Closed over with assertNever:
 * when the upstream grows a new observable class, the compiler forces every
 * consumer to take a stance instead of silently landing in a fallback.
 */
export type UpstreamErrorKind = 'hard_credit' | 'soft_rate' | 'session_dead' | 'not_found' | 'server' | 'client'

/** 全部类别，供遍历与穷尽性检查。Every class, for iteration and exhaustiveness. */
export const UPSTREAM_ERROR_KINDS: readonly UpstreamErrorKind[] = [
  'hard_credit', 'soft_rate', 'session_dead', 'not_found', 'server', 'client',
] as const

/** 编译期穷尽性检查助手。Compile-time exhaustiveness helper. */
export function assertNeverKind(kind: never): never {
  throw new Error(`未知的上游失败类别 / unknown upstream failure kind: ${String(kind)}`)
}
