/**
 * The presentation functions' acceptance: badge triples over every status,
 * the inbox filter's slices, and the time and duration bucketing.
 *
 * 呈现函数的验收：覆盖每个状态的徽标三元组、收件箱筛选切片、时间与耗时分桶。
 */
import { describe, expect, it } from 'vitest'
import {
  channelKeyOf,
  deliveryBadgeOf,
  durationLabel,
  fillCount,
  inboxCounts,
  matchesFilter,
  messageBadgeOf,
  relativeTimeLabel,
  runBadgeOf,
  skipReasonKeyOf,
  stepBadgeOf,
} from '../src/client/format.ts'
import type { MailSnapshot, MessageView, RunView, StepView } from '../src/client/remote.ts'

/** One delivered, unread, unarchived in-app message. / 一条已投递、未读、未归档的站内消息。 */
function message(overrides: Partial<MessageView> = {}): MessageView {
  return {
    messageId: 'm-1',
    subscriberId: 'host',
    channel: 'in_app',
    subject: '标题',
    content: '正文',
    status: 'sent',
    seen: false,
    read: false,
    archived: false,
    createdAt: 1,
    ...overrides,
  } as MessageView
}

/** One delivered chain with one completed step. / 一条已送达链带一个已完成步骤。 */
function run(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: 'r-1',
    transactionId: 'tx-1',
    workflowName: '站内通知',
    status: 'delivered',
    recipientCount: 1,
    startedAt: 0,
    steps: [],
    ...overrides,
  } as RunView
}

/** One step of the given state. / 给定状态的一个步骤。 */
function step(state: StepView['state'], skipReason?: StepView['skipReason']): StepView {
  return { jobId: 'j-1', subscriberId: 'host', stepId: 'notice', state, skipReason } as StepView
}

describe('messageBadgeOf', () => {
  it('未读行拿 info 徽标，已读行安静，归档行中性 / unread earns info, read stays quiet, archived goes neutral', () => {
    expect(messageBadgeOf(message())).toMatchObject({ key: 'unread', tone: 'info' })
    expect(messageBadgeOf(message({ read: true }))).toBeUndefined()
    expect(messageBadgeOf(message({ archived: true }))).toMatchObject({ key: 'archived', tone: 'neutral' })
  })

  it('投递出问题才给投递徽标 / only a troubled delivery earns a delivery badge', () => {
    expect(deliveryBadgeOf(message({ status: 'sent' }))).toBeUndefined()
    expect(deliveryBadgeOf(message({ status: 'error' }))).toMatchObject({ key: 'deliveryError', tone: 'danger' })
    expect(deliveryBadgeOf(message({ status: 'warning' }))).toMatchObject({ key: 'deliveryWarning', tone: 'warning' })
  })
})

describe('runBadgeOf', () => {
  it('八种执行链状态各有词与色 / all eight chain statuses map to a word and a palette', () => {
    expect(runBadgeOf(run({ status: 'delivered' }))).toMatchObject({ key: 'deliveredChain', tone: 'success' })
    expect(runBadgeOf(run({ status: 'sent' }))).toMatchObject({ key: 'sent', tone: 'success' })
    expect(runBadgeOf(run({ status: 'interacted' }))).toMatchObject({ key: 'chainInteracted', tone: 'success' })
    expect(runBadgeOf(run({ status: 'errored' }))).toMatchObject({ key: 'erroredChain', tone: 'danger' })
    expect(runBadgeOf(run({ status: 'skipped' }))).toMatchObject({ key: 'skippedChain', tone: 'warning' })
    expect(runBadgeOf(run({ status: 'pending' }))).toMatchObject({ key: 'pending', tone: 'info' })
    expect(runBadgeOf(run({ status: 'canceled' }))).toMatchObject({ key: 'chainCanceled', tone: 'neutral' })
    expect(runBadgeOf(run({ status: 'merged' }))).toMatchObject({ key: 'chainMerged', tone: 'neutral' })
  })
})

describe('stepBadgeOf / skipReasonKeyOf', () => {
  it('九种步骤状态各有词与点 / all nine step states map to a word and a dot', () => {
    for (const state of ['pending', 'queued', 'running', 'completed', 'failed', 'delayed', 'canceled', 'merged', 'skipped'] as const) {
      expect(stepBadgeOf(step(state))).toBeDefined()
    }
    expect(stepBadgeOf(step('completed'))).toMatchObject({ key: 'stepCompleted' })
    expect(stepBadgeOf(step('failed'))).toMatchObject({ key: 'failed' })
  })

  it('六种跳过原因各有键 / all six skip reasons map to a key', () => {
    expect(skipReasonKeyOf(step('skipped', 'preference'))).toBe('skipPreference')
    expect(skipReasonKeyOf(step('skipped', 'missing_email'))).toBe('skipMissingEmail')
    expect(skipReasonKeyOf(step('skipped', 'missing_webhook_url'))).toBe('skipMissingWebhookUrl')
    expect(skipReasonKeyOf(step('completed'))).toBeUndefined()
  })
})

describe('matchesFilter / inboxCounts', () => {
  const rows = [
    message({ messageId: 'a' }),
    message({ messageId: 'b', read: true }),
    message({ messageId: 'c', archived: true }),
    message({ messageId: 'd', read: true, archived: true }),
  ]

  it('未读切片排除已读与归档 / the unread slice excludes read and archived', () => {
    expect(rows.filter((row) => matchesFilter(row, 'unread')).map((row) => row.messageId)).toEqual(['a'])
    expect(rows.filter((row) => matchesFilter(row, 'archived')).map((row) => row.messageId)).toEqual(['c', 'd'])
    expect(rows.filter((row) => matchesFilter(row, 'all'))).toHaveLength(4)
  })

  it('计数一趟算完，已读归档只进归档桶 / counts come from one pass; a read archive only feeds the archive bucket', () => {
    expect(inboxCounts(rows)).toEqual({ all: 4, unread: 1, archived: 2 })
    expect(inboxCounts([])).toEqual({ all: 0, unread: 0, archived: 0 })
  })
})

describe('time and duration buckets', () => {
  it('相对时间按共享分桶落词典键 / relative time lands on dictionary keys via the shared buckets', () => {
    const now = 1_000_000_000_000
    expect(relativeTimeLabel(now - 10_000, now)).toMatchObject({ key: 'timeNow' })
    expect(relativeTimeLabel(now - 5 * 60_000, now)).toMatchObject({ key: 'timeMinutes', n: 5 })
    expect(relativeTimeLabel(now - 3 * 3_600_000, now)).toMatchObject({ key: 'timeHours', n: 3 })
    expect(relativeTimeLabel(now - 2 * 86_400_000, now)).toMatchObject({ key: 'timeDays', n: 2 })
  })

  it('耗时按秒分落地，未结束的链没有耗时 / durations floor at seconds; a running chain earns none', () => {
    expect(durationLabel(0, undefined)).toBeUndefined()
    expect(durationLabel(0, 4_000)).toMatchObject({ key: 'durationSeconds', n: 4 })
    expect(durationLabel(0, 130_000)).toMatchObject({ key: 'durationMinutes', n: 2 })
  })
})

describe('channel keys and templates', () => {
  it('六种渠道各有键 / all six channels map to a key', () => {
    for (const channel of ['in_app', 'email', 'sms', 'chat', 'push', 'tool'] as const) {
      expect(channelKeyOf(channel)).toBeDefined()
    }
    expect(channelKeyOf('in_app')).toBe('channelInApp')
  })

  it('模板占位符被计数替换 / the template placeholder is replaced by the count', () => {
    expect(fillCount('耗时 {n} 秒', 4)).toBe('耗时 4 秒')
    expect(fillCount('{n} 位收件人', 12)).toBe('12 位收件人')
  })
})

describe('snapshot types', () => {
  it('快照形状保持稳定 / the snapshot shape stays stable', () => {
    const snapshot: MailSnapshot = {
      messages: [message()],
      runs: [run()],
      settled: true,
      status: 'ready',
      error: '',
    }
    expect(snapshot.messages).toHaveLength(1)
  })
})
