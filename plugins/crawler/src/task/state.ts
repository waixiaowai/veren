/**
 * 采集任务状态机（design/states.md §1）：非法转移显式拒绝。
 * The crawler task state machine (design/states.md §1): illegal transitions
 * are rejected explicitly with their failure codes.
 *
 * @module @veren/crawler/task/state
 */
import { CrawlerError } from '../errors.ts'
import type { CrawlerTaskState } from '../types.ts'

/** 合法转移表 / the legal transition table */
const TRANSITIONS: Record<CrawlerTaskState, readonly CrawlerTaskState[]> = {
  idle: ['starting'],
  starting: ['running', 'idle'],
  running: ['stopping', 'idle', 'error'],
  stopping: ['idle'],
  error: ['idle'],
}

/** 状态机非法转移错误 / the illegal-transition error */
export function illegalTransition(from: CrawlerTaskState, to: CrawlerTaskState): CrawlerError {
  return new CrawlerError('CRAWLER_NOT_RUNNING', `非法状态转移: ${from} -> ${to}`, { from, to })
}

/**
 * 纯转移函数：当前态 + 目标态 → 新状态；非法即抛错。
 * The pure transition function: current plus target yields the next state;
 * illegal pairs throw.
 */
export function transition(from: CrawlerTaskState, to: CrawlerTaskState): CrawlerTaskState {
  if (!TRANSITIONS[from].includes(to)) throw illegalTransition(from, to)
  return to
}
