/**
 * The trigger and the dispatch chain, against the design's acceptance rules.
 *
 * 触发与编排链，对照设计的验收规则。
 */

import { describe, expect, it } from 'vitest'
import { claimJob, commitJob, MAX_ATTEMPTS } from '../src/dispatch.ts'
import { MailError } from '../src/errors.ts'
import { MailService } from '../src/service.ts'
import { inAppProvider } from '../src/providers.ts'
import {
  assertTransactionUnused,
  findWorkflow,
  resolveRecipients,
  validatePayload,
  workflowAcceptance,
} from '../src/trigger.ts'
import {
  fakeDomain,
  fakeStore,
  subscriberFixture,
  subscriptionFixture,
  topicFixture,
  workflowFixture,
} from './fixtures.ts'
import type { ChannelKind } from '../src/types.ts'
import type { ChannelProvider } from '../src/deliver.ts'

/** A service over an in-memory store, with the station inbox as its only provider. / 一个跑在内存存储上的服务，只有站内收件箱一个提供方。 */
function service(domain = fakeDomain()): MailService {
  const providers = new Map<ChannelKind, ChannelProvider>([['in_app', inAppProvider]])
  return new MailService(fakeStore(domain), providers)
}

describe('mail trigger', () => {
  it('refuses a trigger that names no workflow', () => {
    const store = fakeStore(fakeDomain())
    expect(() => findWorkflow(store, 'missing')).toThrowError(
      expect.objectContaining({ code: 'MAIL_TRIGGER_WORKFLOW_NOT_FOUND' }),
    )
  })

  it('refuses a draft workflow without writing a record', () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putWorkflow(workflowFixture({ draft: true }))
    expect(workflowAcceptance(store.workflows()[0]!)).toBe('NOT_ACTIVE')
    expect(store.runs()).toHaveLength(0)
  })

  it('reports an empty step chain separately from an inactive workflow', () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putWorkflow(workflowFixture({ steps: [] }))
    expect(workflowAcceptance(store.workflows()[0]!)).toBe('NO_WORKFLOW_STEPS')
  })

  it('rejects a repeated transaction identifier', () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putWorkflow(workflowFixture())
    store.putRun({
      runId: 'run-1' as never,
      transactionId: 'tx-1' as never,
      workflowId: 'wf-1' as never,
      recipientCount: 1,
      status: 'pending',
      startedAt: 1,
    })
    expect(() => assertTransactionUnused(store, 'tx-1')).toThrowError(
      expect.objectContaining({ code: 'MAIL_TRIGGER_TRANSACTION_CONFLICT' }),
    )
  })

  it('rejects a payload that does not match the workflow schema', () => {
    const workflow = workflowFixture({
      payloadSchema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } },
    })
    expect(() => validatePayload(workflow, {})).toThrowError(
      expect.objectContaining({ code: 'MAIL_TRIGGER_PAYLOAD_INVALID' }),
    )
  })

  it('accepts a payload that matches the workflow schema', () => {
    const workflow = workflowFixture({
      payloadSchema: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } },
    })
    expect(validatePayload(workflow, { orderId: 'o-1' })).toEqual({ orderId: 'o-1' })
  })

  it('refuses a recipient that does not exist', () => {
    const store = fakeStore(fakeDomain())
    expect(() => resolveRecipients(store, {
      name: 'order-paid',
      payload: {},
      to: [{ kind: 'subscriber', subscriberId: 'nobody' }],
    })).toThrowError(expect.objectContaining({ code: 'MAIL_TRIGGER_RECIPIENT_INVALID' }))
  })

  it('fans a group out to its subscribers and warns about an unknown group', () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putSubscriber(subscriberFixture())
    store.putTopic(topicFixture())
    store.putSubscription(subscriptionFixture())
    const resolved = resolveRecipients(store, {
      name: 'order-paid',
      payload: {},
      to: [
        { kind: 'topic', topicKey: 'buyers' },
        { kind: 'topic', topicKey: 'ghost' },
      ],
    })
    expect(resolved.subscribers.map((subscriber) => subscriber.subscriberId)).toEqual(['user-1'])
    expect(resolved.warnings).toEqual(['ghost'])
  })

  it('excludes the actor and deduplicates a repeated recipient', () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putSubscriber(subscriberFixture())
    store.putSubscriber(subscriberFixture({ subscriberId: 'user-2' as never }))
    const resolved = resolveRecipients(store, {
      name: 'order-paid',
      payload: {},
      actor: 'user-2',
      to: [
        { kind: 'subscriber', subscriberId: 'user-1' },
        { kind: 'subscriber', subscriberId: 'user-1' },
        { kind: 'subscriber', subscriberId: 'user-2' },
      ],
    })
    expect(resolved.subscribers.map((subscriber) => subscriber.subscriberId)).toEqual(['user-1'])
  })
})

describe('mail trigger chain', () => {
  it('accepts a trigger and delivers one message per recipient', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putWorkflow(workflowFixture({
      steps: [{ stepId: 'notify', type: 'in_app', content: { body: 'Order {{orderId}} paid' } }],
    }))
    await store.putSubscriber(subscriberFixture())
    const mail = service(domain)
    const result = await mail.trigger({
      name: 'order-paid',
      payload: { orderId: 'o-1' },
      to: [{ kind: 'subscriber', subscriberId: 'user-1' }],
      transactionId: 'tx-1',
    })
    expect(result.acceptance).toBe('PROCESSED')
    expect(result.recipientCount).toBe(1)
    const messages = store.messages()
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content).toContain('o-1')
  })

  it('writes the message before the provider is called', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putWorkflow(workflowFixture())
    await store.putSubscriber(subscriberFixture())
    const observed: { messagesAtCall: number } = { messagesAtCall: -1 }
    const provider: ChannelProvider = {
      providerId: 'probe',
      channels: ['in_app'],
      send: async () => {
        observed.messagesAtCall = store.messages().length
        return { accepted: true }
      },
    }
    const mail = new MailService(store, new Map<ChannelKind, ChannelProvider>([['in_app', provider]]))
    await mail.trigger({
      name: 'order-paid',
      payload: { orderId: 'o-1' },
      to: [{ kind: 'subscriber', subscriberId: 'user-1' }],
      transactionId: 'tx-1',
    })
    expect(observed.messagesAtCall).toBe(1)
  })

  it('delivers one message per step and keeps the chain in order', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putWorkflow(workflowFixture({
      steps: [
        { stepId: 'first', type: 'in_app', content: { body: 'first' } },
        { stepId: 'second', type: 'in_app', content: { body: 'second' } },
      ],
    }))
    await store.putSubscriber(subscriberFixture())
    const mail = service(domain)
    await mail.trigger({
      name: 'order-paid',
      payload: { orderId: 'o-1' },
      to: [{ kind: 'subscriber', subscriberId: 'user-1' }],
      transactionId: 'tx-1',
    })
    const jobs = store.jobs().sort((left, right) => left.sequence - right.sequence)
    expect(jobs.map((job) => job.state)).toEqual(['completed', 'completed'])
    expect(store.messages().map((message) => message.content)).toEqual(['first', 'second'])
  })

  it('skips a step whose condition does not pass, naming the reason', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putWorkflow(workflowFixture({
      steps: [{
        stepId: 'vip',
        type: 'in_app',
        content: { body: 'vip' },
        filters: [{ source: 'payload', field: 'vip', operator: 'equals', value: true }],
      }],
    }))
    await store.putSubscriber(subscriberFixture())
    const mail = service(domain)
    await mail.trigger({
      name: 'order-paid',
      payload: { vip: false },
      to: [{ kind: 'subscriber', subscriberId: 'user-1' }],
      transactionId: 'tx-1',
    })
    const jobs = store.jobs()
    expect(jobs[0]!.state).toBe('skipped')
    expect(jobs[0]!.skipReason).toBe('step_condition')
    expect(store.messages()).toHaveLength(0)
  })

  it('refuses a second trigger under the same transaction identifier', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putWorkflow(workflowFixture())
    await store.putSubscriber(subscriberFixture())
    const mail = service(domain)
    const request = {
      name: 'order-paid',
      payload: { orderId: 'o-1' },
      to: [{ kind: 'subscriber' as const, subscriberId: 'user-1' }],
      transactionId: 'tx-1',
    }
    await mail.trigger(request)
    await expect(mail.trigger(request)).rejects.toThrowError(
      expect.objectContaining({ code: 'MAIL_TRIGGER_TRANSACTION_CONFLICT' }),
    )
  })
})

describe('mail job claiming', () => {
  it('lets exactly one worker claim a queued step', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putJob({
      jobId: 'job-1' as never,
      runId: 'run-1' as never,
      transactionId: 'tx-1' as never,
      workflowId: 'wf-1' as never,
      subscriberId: 'user-1' as never,
      stepId: 'notify',
      stepType: 'in_app' as const,
      state: 'queued',
      attempts: 0,
      deferredCount: 0,
      payload: {},
      sequence: 0,
      createdAt: 1,
    })
    const first = await claimJob(store, 'job-1', 'worker-a', 100)
    const second = await claimJob(store, 'job-1', 'worker-b', 100)
    expect(first?.leaseOwner).toBe('worker-a')
    expect(second).toBeUndefined()
  })

  it('refuses to claim a step that already finished', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putJob({
      jobId: 'job-1' as never,
      runId: 'run-1' as never,
      transactionId: 'tx-1' as never,
      workflowId: 'wf-1' as never,
      subscriberId: 'user-1' as never,
      stepId: 'notify',
      stepType: 'in_app' as const,
      state: 'completed',
      attempts: 1,
      deferredCount: 0,
      payload: {},
      sequence: 0,
      createdAt: 1,
    })
    expect(await claimJob(store, 'job-1', 'worker-a', 100)).toBeUndefined()
  })

  it('keeps the attempt count inside the retry budget', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    const job = {
      jobId: 'job-1' as never,
      runId: 'run-1' as never,
      transactionId: 'tx-1' as never,
      workflowId: 'wf-1' as never,
      subscriberId: 'user-1' as never,
      stepId: 'notify',
      stepType: 'in_app' as const,
      state: 'queued' as const,
      attempts: MAX_ATTEMPTS - 1,
      deferredCount: 0,
      payload: {},
      sequence: 0,
      createdAt: 1,
    }
    await store.putJob(job)
    const claimed = await claimJob(store, 'job-1', 'worker-a', 100)
    expect(claimed?.attempts).toBe(MAX_ATTEMPTS)
    const committed = await commitJob(store, claimed!, { jobId: 'job-1', state: 'failed', retryable: true })
    expect(committed.state).toBe('failed')
  })

  it('refuses to claim a step another worker already holds', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putJob({
      jobId: 'job-1' as never,
      runId: 'run-1' as never,
      transactionId: 'tx-1' as never,
      workflowId: 'wf-1' as never,
      subscriberId: 'user-1' as never,
      stepId: 'notify',
      stepType: 'in_app' as const,
      state: 'running',
      attempts: 1,
      deferredCount: 0,
      payload: {},
      sequence: 0,
      leaseOwner: 'worker-a',
      leaseExpiresAt: 10_000,
      createdAt: 1,
    })
    expect(await claimJob(store, 'job-1', 'worker-b', 100)).toBeUndefined()
  })
})

describe('mail errors', () => {
  it('carries a stable code and the retryability that goes with it', () => {
    const timeout = new MailError('MAIL_DELIVER_PROVIDER_TIMEOUT', 'timed out')
    const rejected = new MailError('MAIL_DELIVER_PROVIDER_REJECTED', 'rejected')
    expect(timeout.retryable).toBe(true)
    expect(rejected.retryable).toBe(false)
  })
})
