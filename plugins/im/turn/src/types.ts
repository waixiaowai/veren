/**
 * The turn domain's public types: run records and their terminal states
 * (design §3, states per the design's run state machine §20.4.1).
 *
 * 回合域的公开类型：运行记录及其终态（设计 §3，状态机见设计 §20.4.1）。
 *
 * @module @veren/im-turn/types
 */

import type { WakeReason } from '@veren/im-coordination'

/** The four run states; terminal states never re-enter running. */
/** 四个运行状态；终态绝不回到 running。 */
export type RunStatus = 'running' | 'completed' | 'failed' | 'skipped'

/** Why a run ended without producing a reply. */
/** 一次运行没有产出回复而结束的原因。 */
export type SkipCause =
  | 'nothing-to-read'
  | 'fingerprint-hit'
  | 'budget'
  | 'held-out'
  | 'model-rate-limited'
  | 'model-quota'

/** One run as the observability face sees it. */
/** 观测面看到的一次运行。 */
export interface RunView {
  readonly id: string
  readonly agentParticipantId: string
  readonly roomId: string
  readonly reason: WakeReason
  readonly status: RunStatus
  /** The skip cause, present exactly when status is `skipped`. */
  /** 恰在状态为 `skipped` 时出现的原因。 */
  readonly skipCause?: SkipCause
  /** The failure reason, present exactly when status is `failed`. */
  /** 恰在状态为 `failed` 时出现的原因。 */
  readonly error?: string
  /** The id of the reply this run posted, when it did. */
  /** 本运行发出的回复消息 id（发过才有）。 */
  readonly replyMessageId?: string
  readonly fingerprint?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

/** One event line on a run's timeline. */
/** 一条运行时间线上的事件。 */
export interface RunEventView {
  readonly runId: string
  readonly kind: string
  readonly data?: unknown
  readonly createdAt: number
}

export type { WakeReason } from '@veren/im-coordination'
