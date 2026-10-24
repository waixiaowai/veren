/**
 * Declarations of the automatic stranger intake: the config with its safety
 * bounds, the one fixed question, the settle verb, the audit-view shapes, and
 * the construction options.
 *
 * Split out of `intake.ts` so the service class stays under the file-size
 * ceiling; the export surface is unchanged — `intake.ts` re-exports every name
 * declared here.
 *
 * 自动陌生人采集的声明面：带安全边界的配置、唯一固定询问、收尾动词、审计视图形状与构造选项。
 *
 * 按职责从 `intake.ts` 拆出，让服务类保持在单文件行数上限内；导出面不变——`intake.ts`
 * 原样再导出这里声明的全部名字。
 *
 * @module @veren/im/intake-types
 */

import type { ImSendResult } from './contract.ts'
import type { ImLogger } from './runtime-seams.ts'
import type { ImPeople } from './people.ts'
import type { ImIntakeStatus } from './store.ts'

/** One switch and its safety bounds. */
export interface ImStrangerIntakeConfig {
  /** The total switch. `false` sends nothing and records nothing. */
  enabled: boolean
  /**
   * Display reference only: how long after the question a reply was once
   * considered an answer. Rows are never moved to `expired` anymore; the
   * conversation model settles them through `im_person_report`.
   * 仅作展示参考：过去认为询问后多久内的回复算回答。行不再被打成 expired 终态；由会话模型
   * 通过 `im_person_report` 收尾。
   */
  replyWindowMs: number
  /** Per-account cap across a sliding hour; 0 is treated as 1. */
  maxAsksPerHour: number
  /** Minimum gap between two questions from one account. */
  minAskIntervalMs: number
}

/** Defaults used by the plugin config and by direct router construction. */
export const STRANGER_INTAKE_DEFAULTS: ImStrangerIntakeConfig = {
  enabled: true,
  replyWindowMs: 120_000,
  maxAsksPerHour: 10,
  minAskIntervalMs: 10_000,
}

/**
 * The one question. It asks only for a form of address and a contact method,
 * states that declining is fine, and makes no promise the host cannot keep.
 * 唯一的一条询问：只问怎么称呼和联系方式，说明不方便也没关系，不承诺做不到的事。
 */
export const STRANGER_INTAKE_ASK = '你好，我们好像还没认识过。请问怎么称呼你？方便的话再留个联系方式，我记一下，以后好找你，不方便也没关系。'

/** What the model settled the open question with. */
export type ImIntakeSettle = 'answered' | 'declined'

/** One intake record as the status tool shows it. */
export interface ImIntakeRecordView {
  personId: string
  personName: string
  claimedName?: string
  status: ImIntakeStatus
  provider: string
  accountId: string
  conversationId: string
  askedAt: number
  askMessageId: string
  askText: string
  /** Display reference computed from the reply window. */
  expiresAt: number
  settledAt?: number
  outcome?: 'name' | 'contact' | 'both'
  replyMessageId?: string
  replyExcerpt?: string
}

/** The switch, counts, and a bounded audit window. */
export interface ImIntakeStatusView {
  enabled: boolean
  askText: string
  replyWindowMs: number
  maxAsksPerHour: number
  minAskIntervalMs: number
  counts: Record<ImIntakeStatus, number>
  recent: ImIntakeRecordView[]
}

/** Construction options; the clock, store, and sender are injectable. */
export interface ImStrangerIntakeOptions {
  people: ImPeople
  logger: ImLogger
  /** Send one text to one explicit target. */
  send: (request: { accountId: string; conversationId: string; text: string }) => Promise<ImSendResult>
  config?: Partial<ImStrangerIntakeConfig>
  now?: () => number
}
