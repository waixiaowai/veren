/**
 * 登录会话状态机（design/states.md §2）：非法转移显式拒绝。
 * The login session state machine (design/states.md §2): illegal
 * transitions are rejected explicitly.
 *
 * 联动约束：进入 failed/expired 且自动恢复耗尽时，采集任务不得保持
 * running——由爬取器失败分支触发进程异常退出。
 * Coupling constraint: once failed/expired with auto-recovery exhausted,
 * the crawl task must not stay running — the crawler failure branch
 * aborts the process.
 *
 * @module @veren/crawler/auth/state
 */
import { CrawlerError } from '../errors.ts'
import type { LoginSessionState } from '../types.ts'

/** 合法转移表 / the legal transition table */
const TRANSITIONS: Record<LoginSessionState, readonly LoginSessionState[]> = {
  unknown: ['logging_in', 'logged_in'],
  logging_in: ['waiting_scan', 'failed'],
  waiting_scan: ['logged_in', 'logging_in', 'failed'],
  logged_in: ['expired'],
  expired: ['logging_in'],
  failed: ['logging_in'],
}

/** 状态机非法转移错误 / the illegal-transition error */
export function illegalLoginTransition(from: LoginSessionState, to: LoginSessionState): CrawlerError {
  return new CrawlerError('INVALID_ARGUMENT', `非法登录状态转移: ${from} -> ${to}`, { from, to })
}

/**
 * 纯转移函数：当前态 + 目标态 → 新状态；非法即抛错。
 * The pure transition function: current plus target yields the next state;
 * illegal pairs throw.
 */
export function transitionLogin(from: LoginSessionState, to: LoginSessionState): LoginSessionState {
  if (!TRANSITIONS[from].includes(to)) throw illegalLoginTransition(from, to)
  return to
}
