/**
 * TaskCenterService behavior over the real storage stack: the send/list/get
 * contract with idempotent sends and draft validation, the lease lifecycle
 * (exclusive claim, lazy recycling, tree-level mutex, release), idempotent
 * outcomes and lazy expiry, and the delivery seam.
 *
 * 真实存储栈上的 TaskCenterService 行为：send/list/get 契约（幂等发送与草稿校验）、
 * 租约生命周期（独占接取、懒回收、树级互斥、释放）、幂等结局与懒过期，以及投递接缝。
 */

import { describe, expect, it } from 'vitest'
import type { AppSnapshot } from '../src/service.ts'
import { TaskErrorCode } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'
import { HOUR, boot, draft, errorOf, tempRoot } from './service-helpers.ts'

describe('send / list / get', () => {
  it('persists a task plus a pending inbox notice, and dedups idempotencyKey', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const first = await ctx.taskCenter.send(draft({ idempotencyKey: 'retry-1' }))
    const replay = await ctx.taskCenter.send(draft({ idempotencyKey: 'retry-1' }))
    expect(replay.id).toBe(first.id)
    expect(first.status).toBe('open')
    expect(first.revision).toBe(1)

    const notices = await ctx.taskCenter.pendingDeliveries()
    expect(notices).toHaveLength(1)
    expect(notices[0]!.task.id).toBe(first.id)
    expect(notices[0]!.text).toContain(first.target.url)

    expect((await ctx.taskCenter.list({ status: 'open' })).map(row => row.id)).toEqual([first.id])
    expect((await ctx.taskCenter.get(first.id))?.title).toBe('Review PR #42')
    await dispose()
  })

  it('rejects invalid drafts with task/draft-invalid', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    expect(await errorOf(ctx.taskCenter.send(draft({ title: '   ' })))).toBe(TaskErrorCode.DraftInvalid)
    expect(await errorOf(ctx.taskCenter.send(draft({ body: 'x'.repeat(4001) })))).toBe(TaskErrorCode.DraftInvalid)
    await dispose()
  })

  it('enforces sender state through the lazily wired resolver', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const apps = new Map<string, AppSnapshot>([
      ['review-workbench', { state: 'active', version: '1.0.0' }],
      ['disabled-app', { state: 'disabled', version: '1.0.0' }],
    ])
    ctx.taskCenter.setAppResolver(async appId => apps.get(appId))
    await ctx.taskCenter.send(draft())
    expect(await errorOf(ctx.taskCenter.send(draft({ target: { ...draft().target, appId: 'ghost' } }))))
      .toBe(TaskErrorCode.SendForbidden)
    expect(await errorOf(ctx.taskCenter.send(draft({ target: { ...draft().target, appId: 'disabled-app' } }))))
      .toBe(TaskErrorCode.SendForbidden)
    const [sent] = await ctx.taskCenter.list({})
    expect(sent?.appVersion).toBe('1.0.0')
    await dispose()
  })
})

describe('lease lifecycle', () => {
  it('claims exclusively, refuses others, and recycles an expired lease lazily', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft())
    const past = new Date(Date.now() - 1000).toISOString()
    // 首次接取即写过期租约，随后由读取路径懒回收 / first claim writes an already-stale lease
    const taken = await ctx.taskCenter.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: past })
    expect(taken.status).toBe('taken')
    expect(taken.claimedBy?.sessionId).toBe('s1')

    // 同一接取者重复接取是幂等续租 / same claimant re-taking just renews
    const renewed = await ctx.taskCenter.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: past })
    expect(renewed.status).toBe('taken')

    // 租约到期的 taken 在接取路径懒回收给新接取者 / an expired lease recycles lazily to a new claimant
    const lease = new Date(Date.now() + HOUR).toISOString()
    const released = await ctx.taskCenter.take(task.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease })
    expect(released.status).toBe('taken')
    expect(released.claimedBy?.sessionId).toBe('s2')

    // 现在有效租约挡住别人 / a live lease now blocks others
    expect(await errorOf(ctx.taskCenter.take(task.id, { sessionId: 's3', actor: 'agent', leaseUntil: lease })))
      .toBe(TaskErrorCode.AlreadyTaken)
    await dispose()
  })

  it('keeps tree-level mutex across trees on one url, and leaves other urls alone (§4.7.3)', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    // 同 URL 两棵树：一棵有活跃接取者，另一棵整树都接不了（跨树互斥）
    // / two trees on one url: an active claimant on one blocks the whole other tree
    const one = await ctx.taskCenter.send(draft())
    const two = await ctx.taskCenter.send(draft({ title: 'Second look' }))
    const lease = new Date(Date.now() + HOUR).toISOString()
    await ctx.taskCenter.take(one.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease })
    expect(await errorOf(ctx.taskCenter.take(two.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease })))
      .toBe(TaskErrorCode.AnotherActive)
    expect(await errorOf(ctx.taskCenter.take(two.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease })))
      .toBe(TaskErrorCode.AnotherActive)
    // 不同 URL 的树互不影响 / trees on different urls never interfere
    const otherUrl = await ctx.taskCenter.send(draft({ target: {
      url: '/apps/review-workbench/review/pr-43' as PageInstanceKey,
      appId: 'review-workbench', page: 'review', params: { pr: '43' },
    } }))
    await ctx.taskCenter.take(otherUrl.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease })
    await dispose()
  })

  it('release returns a taken task to open', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft())
    await ctx.taskCenter.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })
    const released = await ctx.taskCenter.release(task.id, 'changed my mind')
    expect(released.status).toBe('open')
    expect(released.claimedBy).toBeUndefined()
    expect(await errorOf(ctx.taskCenter.release(task.id, 'again'))).toBe('task/invalid-state')
    await dispose()
  })
})

describe('idempotent outcomes and expiry', () => {
  it('keeps the first complete result and never overwrites it', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft())
    await ctx.taskCenter.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })
    const done = await ctx.taskCenter.complete(task.id, { summary: 'looks good', artifacts: ['pr://42'] })
    const again = await ctx.taskCenter.complete(task.id, { summary: 'overwritten!' })
    expect(again.updatedAt).toBe(done.updatedAt)
    expect(again.result?.summary).toBe('looks good')
    expect(await errorOf(ctx.taskCenter.fail(task.id, { code: 'late', message: 'nope' }))).toBe('task/invalid-state')
    await dispose()
  })

  it('is idempotent for fail too', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft())
    await ctx.taskCenter.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })
    const failed = await ctx.taskCenter.fail(task.id, { code: 'target-unavailable', message: 'page gone' })
    const again = await ctx.taskCenter.fail(task.id, { code: 'other', message: 'overwrite attempt' })
    expect(again.updatedAt).toBe(failed.updatedAt)
    expect(again.failure?.code).toBe('target-unavailable')
    await dispose()
  })

  it('expires past-deadline open tasks lazily and refuses to take them', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft({ expiresAt: new Date(Date.now() + 50).toISOString() }))
    await new Promise(resolve => setTimeout(resolve, 90))
    expect((await ctx.taskCenter.get(task.id))?.status).toBe('expired')
    expect(await errorOf(ctx.taskCenter.take(task.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })))
      .toBe(TaskErrorCode.Expired)
    await dispose()
  })

  it('cancels open tasks but not taken or terminal ones', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft())
    const cancelled = await ctx.taskCenter.cancel(task.id, 'superseded')
    expect(cancelled.status).toBe('cancelled')
    expect(await errorOf(ctx.taskCenter.cancel(task.id, 'again'))).toBe('task/invalid-state')
    await dispose()
  })

  it('returns task/not-found for unknown ids', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    expect(await errorOf(ctx.taskCenter.complete('task-none' as never, { summary: 'x' }))).toBe(TaskErrorCode.NotFound)
    await dispose()
  })
})

describe('delivery seam', () => {
  it('marks notices read when the task reaches a terminal state, and records failed attempts', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const task = await ctx.taskCenter.send(draft())
    const [notice] = await ctx.taskCenter.pendingDeliveries()
    expect(notice?.deliveryId).toBeTruthy()
    const failedAttempt = await ctx.taskCenter.markDelivered(notice!.deliveryId, 'no live session')
    expect(failedAttempt?.state).toBe('pending')
    expect(failedAttempt?.attempts).toBe(1)
    expect(failedAttempt?.lastError).toBe('no live session')
    await ctx.taskCenter.markDelivered(notice!.deliveryId)
    await ctx.taskCenter.cancel(task.id, 'obsolete')
    expect(await ctx.taskCenter.pendingDeliveries()).toHaveLength(0)
    await dispose()
  })
})
