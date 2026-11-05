/**
 * The panel's pure presentation functions: state-to-badge mappings, time and
 * duration bucketing, and the inbox filter. No React, no I/O — everything
 * here is a unit-testable table or a one-line derivation.
 *
 * 面板的纯呈现函数：状态到徽标的映射、时间与耗时分桶、收件箱筛选。无 React、无 I/O——
 * 这里的每一样都是可单测的映射表或一行推导。
 *
 * The design language is Novu's: a status is always word + icon + color
 * together, timestamps may be quiet, and an archived record stays visible
 * under the "all" filter.
 *
 * 设计语言是 Novu 的：状态永远是词 + 图标 + 颜色三重表达，时间戳可以用弱色，
 * 已归档记录在「全部」口径下仍然可见。
 *
 * @module @veren/mail-ui/client/format
 */

import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MailKey } from './locales.ts'
import type { MessageView, RunView, StepView } from './remote.ts'

/** Which inbox slice the filter shows. / 筛选器当前显示的收件箱切片。 */
export type InboxFilter = 'all' | 'unread' | 'archived'

/** One badge's full triple: the localized word, its palette, and its dot. / 一个徽标的完整三元组：本地化词、色板与状态点。 */
export interface StatusBadge {
  /** The dictionary key of the status word. / 状态词的词典键。 */
  readonly key: MailKey
  /** The tag palette. / 徽标色板。 */
  readonly tone: TagTone
  /** The dot beside the word, when the status earns one. / 词旁的状态点，值得给时才有。 */
  readonly dot: StateDotState
}

/**
 * The visible-state badge of one message: archived dimmed, unread loud,
 * read quiet (no badge — the absence of "unread" is the signal).
 *
 * 一条消息的可见状态徽标：归档弱化、未读响亮、已读安静（不给徽标——「未读」的缺席即信号）。
 *
 * @param message - the message / 消息
 * @returns the badge, when the state earns one / 徽标，状态值得给时才有
 */
export function messageBadgeOf(message: MessageView): StatusBadge | undefined {
  if (message.archived) return { key: 'archived', tone: 'neutral', dot: 'idle' }
  if (!message.read) return { key: 'unread', tone: 'info', dot: 'ongoing' }
  return undefined
}

/**
 * The delivery badge of one message: only a troubled delivery earns a badge.
 *
 * 一条消息的投递徽标：只有出问题的投递才值得徽标。
 *
 * @param message - the message / 消息
 * @returns the badge, when the delivery was not clean / 投递不干净时的徽标
 */
export function deliveryBadgeOf(message: MessageView): StatusBadge | undefined {
  if (message.status === 'error') return { key: 'deliveryError', tone: 'danger', dot: 'error' }
  if (message.status === 'warning') return { key: 'deliveryWarning', tone: 'warning', dot: 'warning' }
  return undefined
}

/**
 * The outcome badge of one execution chain, over the chain's full status set.
 *
 * 一条执行链的结果徽标，覆盖执行链的完整状态集。
 *
 * @param run - the execution chain / 执行链
 * @returns the badge / 徽标
 */
export function runBadgeOf(run: RunView): StatusBadge {
  switch (run.status) {
    case 'delivered': return { key: 'deliveredChain', tone: 'success', dot: 'done' }
    case 'sent': return { key: 'sent', tone: 'success', dot: 'done' }
    case 'interacted': return { key: 'chainInteracted', tone: 'success', dot: 'done' }
    case 'errored': return { key: 'erroredChain', tone: 'danger', dot: 'error' }
    case 'skipped': return { key: 'skippedChain', tone: 'warning', dot: 'warning' }
    case 'pending': return { key: 'pending', tone: 'info', dot: 'ongoing' }
    case 'canceled': return { key: 'chainCanceled', tone: 'neutral', dot: 'idle' }
    case 'merged': return { key: 'chainMerged', tone: 'neutral', dot: 'idle' }
  }
}

/**
 * The badge of one step instance, over the nine job states.
 *
 * 一个步骤实例的徽标，覆盖九种步骤状态。
 *
 * @param step - the step instance / 步骤实例
 * @returns the badge / 徽标
 */
export function stepBadgeOf(step: StepView): StatusBadge {
  switch (step.state) {
    case 'completed': return { key: 'stepCompleted', tone: 'success', dot: 'done' }
    case 'failed': return { key: 'failed', tone: 'danger', dot: 'error' }
    case 'skipped': return { key: 'skipped', tone: 'warning', dot: 'warning' }
    case 'delayed': return { key: 'stepDelayed', tone: 'warning', dot: 'warning' }
    case 'queued': return { key: 'stepQueued', tone: 'info', dot: 'ongoing' }
    case 'running': return { key: 'running', tone: 'info', dot: 'ongoing' }
    case 'pending': return { key: 'pending', tone: 'neutral', dot: 'idle' }
    case 'canceled': return { key: 'stepCanceled', tone: 'neutral', dot: 'idle' }
    case 'merged': return { key: 'stepMerged', tone: 'neutral', dot: 'idle' }
  }
}

/**
 * The reason a step was skipped, as a dictionary key.
 *
 * 一步被跳过的原因，作为词典键。
 *
 * @param step - the step instance / 步骤实例
 * @returns the reason's key, when there is one / 原因的键，存在时才有
 */
export function skipReasonKeyOf(step: StepView): MailKey | undefined {
  switch (step.skipReason) {
    case 'step_condition': return 'skipStepCondition'
    case 'preference': return 'skipPreference'
    case 'missing_email': return 'skipMissingEmail'
    case 'missing_phone': return 'skipMissingPhone'
    case 'missing_push_token': return 'skipMissingPushToken'
    case 'missing_webhook_url': return 'skipMissingWebhookUrl'
    case undefined: return undefined
  }
}

/**
 * The channel badge word's key.
 *
 * 渠道徽标词的键。
 *
 * @param channel - the delivery channel / 投递渠道
 * @returns the channel's key / 渠道的键
 */
export function channelKeyOf(channel: MessageView['channel']): MailKey {
  switch (channel) {
    case 'in_app': return 'channelInApp'
    case 'email': return 'channelEmail'
    case 'sms': return 'channelSms'
    case 'chat': return 'channelChat'
    case 'push': return 'channelPush'
    case 'tool': return 'channelTool'
  }
}

/**
 * Whether one message survives the current inbox filter. Archived records
 * stay visible under "all" — archiving never deletes.
 *
 * 一条消息是否留在当前收件箱筛选里。已归档记录在「全部」下仍然可见——归档从不删除。
 *
 * @param message - the message / 消息
 * @param filter - the active slice / 当前切片
 * @returns whether it shows / 是否显示
 */
export function matchesFilter(message: MessageView, filter: InboxFilter): boolean {
  if (filter === 'archived') return message.archived
  if (filter === 'unread') return !message.read && !message.archived
  return true
}

/**
 * The three slice counts the filter tabs show, from one pass.
 *
 * 筛选页签展示的三个切片计数，一趟算完。
 *
 * @param messages - every message in the snapshot / 快照里的全部消息
 * @returns the counts / 计数
 */
export function inboxCounts(messages: readonly MessageView[]): {
  readonly all: number
  readonly unread: number
  readonly archived: number
} {
  let unread = 0
  let archived = 0
  for (const message of messages) {
    if (message.archived) archived += 1
    else if (!message.read) unread += 1
  }
  return { all: messages.length, unread, archived }
}

/**
 * Fill a copy template's `{n}` placeholder with a count.
 *
 * 用计数填掉文案模板里的 `{n}` 占位符。
 *
 * @param template - the localized template / 本地化模板
 * @param n - the count / 计数
 * @returns the finished copy / 成品文案
 */
export function fillCount(template: string, n: number): string {
  return template.replace('{n}', String(n))
}

/**
 * The relative-time bucket of a timestamp, as a dictionary key plus count.
 * Reuses the shell's shared bucketing so every surface ages a row alike.
 *
 * 一个时间戳的相对时间分桶，作为词典键加计数。复用外壳的共享分桶，让每处界面对同一行的
 * 时间口径一致。
 *
 * @param at - epoch ms of the moment / 时刻的 epoch 毫秒
 * @param now - epoch ms of the current time / 当前时间的 epoch 毫秒
 * @returns the label key and its count / 标签键与计数
 */
export function relativeTimeLabel(at: number, now: number): { readonly key: MailKey; readonly n: number } {
  const bucket = relativeTime(at, now)
  switch (bucket.unit) {
    case 'now': return { key: 'timeNow', n: 0 }
    case 'minutes': return { key: 'timeMinutes', n: bucket.n }
    case 'hours': return { key: 'timeHours', n: bucket.n }
    case 'days': return { key: 'timeDays', n: bucket.n }
    case 'months': return { key: 'timeMonths', n: bucket.n }
    case 'years': return { key: 'timeYears', n: bucket.n }
  }
}

/**
 * How long one execution chain took, as a dictionary key plus count; a chain
 * without a finish time is still running and earns no duration.
 *
 * 一条执行链耗时多久，作为词典键加计数；没有结束时刻的链仍在执行，不给耗时。
 *
 * @param startedAt - epoch ms of the start / 开始的 epoch 毫秒
 * @param finishedAt - epoch ms of the finish, when it finished / 结束的 epoch 毫秒，已结束时才有
 * @returns the label key and its count / 标签键与计数
 */
export function durationLabel(startedAt: number, finishedAt: number | undefined): {
  readonly key: MailKey
  readonly n: number
} | undefined {
  if (finishedAt === undefined) return undefined
  const seconds = Math.max(1, Math.round((finishedAt - startedAt) / 1000))
  if (seconds < 60) return { key: 'durationSeconds', n: seconds }
  return { key: 'durationMinutes', n: Math.round(seconds / 60) }
}
