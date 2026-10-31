/**
 * The durable startup-item vocabulary: the stored record's shape, the closed
 * action set, the structured input error, and the small typed helpers every
 * other module of this plugin builds on.
 *
 * There is no debounce here. Every successful start runs every enabled item,
 * because a restart interrupts the sessions the items drive: a run that was
 * suppressed is a run the user never gets back.
 *
 * 启动项的持久化词汇表：存储记录的形状、封闭的动作集合、结构化输入错误，以及本插件
 * 其他模块都会用到的小型类型化助手。
 *
 * 这里没有防抖。每次成功启动都会执行每一条 enabled 的启动项 —— 重启会打断启动项正在
 * 驱动的会话，被压掉的一次执行就是用户永远拿不回来的那一次。
 * @module @veren/startup-autostart/item
 */

import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Durable identity of one startup item; brand keeps it from mixing with other ids. */
export type StartupItemId = Branded<'StartupAutostartItem'>

/**
 * What one startup item does when the trigger fires.
 * `new_session` creates a fresh Session, `resume_session` only brings an existing
 * one live, `message_session` wakes an existing one with a message, and
 * `queue_message` leaves the message in the inbox without waking anything.
 */
export type StartupAction = 'new_session' | 'resume_session' | 'message_session' | 'queue_message'

/** Every action an item may declare, for validation and tool schemas. */
export const STARTUP_ACTIONS: readonly StartupAction[] = [
  'new_session', 'resume_session', 'message_session', 'queue_message',
]

/** Optional model a startup item installs on its target Session. */
export interface StartupModelTarget {
  /** Registered provider route, for example `deepseek-official`. */
  readonly provider: string
  /** Provider-owned model id, for example `deepseek-flash`. */
  readonly model: string
  /** Adapter-owned reasoning effort; the provider default when absent. */
  readonly reasoningEffort?: string
}

/** Outcome of the most recent run, retained for the panel and for the model. */
export interface StartupOutcome {
  /** Whether the action completed. */
  readonly status: 'ok' | 'failed'
  /** One-line account of what happened. */
  readonly detail: string
  /** Instant the run finished, ISO 8601 with milliseconds. */
  readonly at: string
}

/**
 * One durable startup item, independent of any Session or workspace folder.
 *
 * The run history (`lastRunAt`, `lastOutcome`, `runCount`) is a record of what
 * happened, never a gate: nothing here suppresses the next start.
 */
export interface StartupItemRecord {
  /** Stable identity; survives rename and re-targeting. */
  readonly id: StartupItemId
  /** Human-readable name shown in lists and quoted back in the delivered message. */
  readonly name: string
  /** Whether the next start runs this item. The only gate there is. */
  readonly enabled: boolean
  /** What the item does. */
  readonly action: StartupAction
  /** Working directory for a new Session; exclusive with `workspaceId`. */
  readonly cwd?: string
  /** Workspace the new Session joins; exclusive with `cwd`. */
  readonly workspaceId?: string
  /** Target Session of every action except `new_session`. */
  readonly sessionId?: SessionId
  /** Agent preset a new Session runs. */
  readonly preset?: string
  /** Model installed on the target Session after it becomes live. */
  readonly model?: StartupModelTarget
  /** Message delivered by the action. */
  readonly message?: string
  /** Creation instant, ISO 8601 with milliseconds. */
  readonly createdAt: string
  /** Instant of the last edit, ISO 8601 with milliseconds. */
  readonly updatedAt: string
  /** Instant the last run started, absent before the first run. */
  readonly lastRunAt?: string
  /** Result of the last run, absent before the first run. */
  readonly lastOutcome?: StartupOutcome
  /** Total runs attempted, including failed ones. */
  readonly runCount: number
}

/** Stable failure codes the tools and the panel switch on. */
export type StartupErrorCode =
  | 'invalid_name'
  | 'invalid_id'
  | 'invalid_action'
  | 'invalid_target'
  | 'invalid_message'
  | 'item_disabled'
  | 'storage_unavailable'
  | 'item_not_found'

/**
 * Rejected management input. The trigger path never throws this: a startup item
 * that cannot be delivered records a failed outcome instead of failing boot.
 */
export class StartupInputError extends Error {
  /**
   * @param code - stable machine-readable code.
   * @param message - actionable English text for the model and the panel.
   */
  constructor(readonly code: StartupErrorCode, message: string) {
    super(message)
    this.name = 'StartupInputError'
  }
}

/** Longest accepted name, in characters. */
export const MAX_NAME_LENGTH = 120

/** Longest accepted message, in characters. */
export const MAX_MESSAGE_LENGTH = 8_000

/** The item fields a create or update request may carry. */
export interface StartupItemInput {
  readonly name?: string
  readonly enabled?: boolean
  readonly action?: StartupAction
  readonly model?: StartupModelTarget
  readonly message?: string
  readonly sessionId?: string
  readonly cwd?: string
  readonly workspaceId?: string
  readonly preset?: string
}

/** Mint one fresh item identity. */
export function newStartupItemId(): StartupItemId {
  return `startup-${randomUUID()}` as StartupItemId
}

/**
 * Copy every defined member of `values` onto `target`.
 *
 * The record and view types declare their optional members without
 * `| undefined`, which `exactOptionalPropertyTypes` requires. Assembling them
 * from a conditional spread would widen every optional member to
 * `T | undefined`, so optional data is attached through this one typed helper.
 * @param target - the fully required base object to extend.
 * @param values - optional members; a member that is `undefined` is skipped.
 * @returns the same target object.
 */
export function withDefined<T extends object>(
  target: T,
  values: { readonly [K in keyof T]?: T[K] | undefined },
): T {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) Object.assign(target, { [key]: value })
  }
  return target
}
