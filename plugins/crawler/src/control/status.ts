/**
 * 任务状态快照类型（design/modules/api.md §2 契约）。
 * The task status snapshot types (the contract in design api.md §2).
 *
 * @module @veren/crawler/control/status
 */
import type { CrawlerTaskState, CrawlerType, Platform } from '../types.ts'

/** 运行状态 = 任务状态机四态 + 异常态（即任务状态机全集）/ run status equals the task state machine's full set */
export type CrawlerRunStatus = CrawlerTaskState

/** 状态快照 / the status snapshot */
export interface CrawlerStatus {
  status: CrawlerRunStatus
  platform: Platform | null
  crawlerType: CrawlerType | null
  startedAt: string | null
  errorMessage: string | null
}

/** 初始空闲态 / the initial idle status */
export function initialStatus(): CrawlerStatus {
  return { status: 'idle', platform: null, crawlerType: null, startedAt: null, errorMessage: null }
}
