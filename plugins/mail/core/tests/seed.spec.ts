/**
 * The station seed: first-install usability, write-if-absent discipline,
 * and the end-to-end trigger the seed is supposed to unlock.
 *
 * 站点种子：首次安装即可用、缺省才写的纪律，以及种子要解锁的那次端到端触发。
 */

import { describe, expect, it } from 'vitest'
import { MailService } from '../src/service.ts'
import { inAppProvider } from '../src/providers.ts'
import { ensureStationSeed, STATION_SUBSCRIBER, STATION_TRIGGER } from '../src/seed.ts'
import { fakeDomain, fakeStore, workflowFixture } from './fixtures.ts'
import type { ChannelKind } from '../src/types.ts'
import type { ChannelProvider } from '../src/deliver.ts'

/** A service over an in-memory store, with the station inbox as its only provider. / 一个跑在内存存储上的服务，只有站内收件箱一个提供方。 */
function service(domain = fakeDomain()): MailService {
  const providers = new Map<ChannelKind, ChannelProvider>([['in_app', inAppProvider]])
  return new MailService(fakeStore(domain), providers)
}

describe('station seed', () => {
  it('writes the workflow and the host recipient on first call', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await ensureStationSeed(store)
    const workflow = store.workflows().find((candidate) => candidate.triggerIdentifier === STATION_TRIGGER)
    expect(workflow).toBeDefined()
    expect(workflow?.status).toBe('ACTIVE')
    expect(workflow?.steps.length).toBeGreaterThan(0)
    const host = store.getSubscriber(STATION_SUBSCRIBER)
    expect(host?.deleted).toBe(false)
  })

  it('is idempotent: a re-activation writes nothing new', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await ensureStationSeed(store)
    const afterFirst = store.workflows().map((workflow) => workflow.updatedAt)
    await ensureStationSeed(store)
    expect(store.workflows()).toHaveLength(1)
    expect(store.workflows().map((workflow) => workflow.updatedAt)).toEqual(afterFirst)
  })

  it('never clobbers an operator-edited station workflow', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putWorkflow(workflowFixture({
      workflowId: 'wf-station-notice' as never,
      triggerIdentifier: STATION_TRIGGER,
      name: '运营者改名后的工作流',
      status: 'INACTIVE',
    }))
    await ensureStationSeed(store)
    const workflow = store.workflows().find((candidate) => candidate.triggerIdentifier === STATION_TRIGGER)
    expect(workflow?.name).toBe('运营者改名后的工作流')
    expect(workflow?.status).toBe('INACTIVE')
  })

  it('leaves an existing host subscriber untouched', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    store.putSubscriber({
      subscriberId: STATION_SUBSCRIBER as never,
      name: '自定义站主',
      deleted: false,
      updatedAt: 1,
    })
    await ensureStationSeed(store)
    expect(store.getSubscriber(STATION_SUBSCRIBER)?.name).toBe('自定义站主')
  })

  it('makes a station notice deliverable end to end', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await ensureStationSeed(store)
    const mail = service(domain)
    const result = await mail.trigger({
      name: STATION_TRIGGER,
      payload: { title: '明天三点开会', body: '请准时参加。' },
      to: [{ kind: 'subscriber', subscriberId: STATION_SUBSCRIBER }],
    })
    expect(result.acceptance).toBe('PROCESSED')
    expect(result.recipientCount).toBe(1)
    const messages = store.messages()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.subject).toBe('明天三点开会')
    expect(messages[0]?.content).toContain('请准时参加。')
  })
})
