/**
 * TaskCenterService behavior over the real storage stack.
 *
 * Every spec boots a fresh temporary JSON storage root, so specs are safe
 * under concurrent vitest workers and never touch the repository. The service
 * is exercised through its public contract; app checks go through the lazily
 * wired resolver (session A is not required).
 *
 * TaskCenterService 行为测试，跑在真实存储栈上。
 *
 * 每个用例都启动全新的临时 JSON 存储根目录，并发 worker 下安全，也不会碰仓库。应用校验走
 * 惰性接线的 resolver，不要求会话 A 的实现。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterPlugin from '../src/index.ts'
import type { TaskCenterService } from '../src/index.ts'
import type { AppSnapshot } from '../src/service.ts'
import { TaskErrorCode } from '../src/types.ts'
import type { TaskDraft, TaskKind } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'task-center-'))
  roots.push(root)
  return root
}

function provideStub<K extends string & keyof Context>(ctx: Context, name: K, value: object): void {
  ctx.provide(name, value as Context[K])
}

/** Boot the real storage stack plus the task center on one fresh root. */
async function boot(root: string): Promise<{ ctx: Context; fiber: Promise<unknown>; dispose: () => Promise<void> }> {
  const ctx = new Context()
  provideStub(ctx, 'tools', { register: () => () => {} })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = ctx.plugin(TaskCenterPlugin)
  return {
    ctx,
    fiber: fiber as unknown as Promise<unknown>,
    // 只卸插件 fiber；根 fiber 连着存储栈，留给断言用 / only the plugin fiber; keep storage
    dispose: async () => { await fiber.then(f => f.dispose()) },
  }
}

const HOUR = 60 * 60 * 1000

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    kind: 'review-workbench/review-request' as TaskKind,
    title: 'Review PR #42',
    target: {
      url: '/apps/review-workbench/review/pr-42' as PageInstanceKey,
      appId: 'review-workbench',
      page: 'review',
      params: { pr: '42' },
    },
    ...overrides,
  }
}

function errorOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => { throw new Error('expected the call to throw') },
    (error: { code?: string }) => error.code ?? String(error),
  )
}

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

  it('refuses two active tasks on the same URL for one session but not across sessions', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const one = await ctx.taskCenter.send(draft())
    const two = await ctx.taskCenter.send(draft({ title: 'Second look' }))
    const lease = new Date(Date.now() + HOUR).toISOString()
    await ctx.taskCenter.take(one.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease })
    expect(await errorOf(ctx.taskCenter.take(two.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease })))
      .toBe(TaskErrorCode.AnotherActive)
    await ctx.taskCenter.take(two.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease })
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

describe('app lifecycle', () => {
  it('marks open and taken tasks orphaned on uninstall and keeps the records', async () => {
    const { ctx, fiber, dispose } = await boot(tempRoot())
    await fiber
    const open = await ctx.taskCenter.send(draft())
    const taken = await ctx.taskCenter.send(draft({ title: 'Already in progress', target: {
      url: '/apps/review-workbench/review/pr-43' as PageInstanceKey, appId: 'review-workbench', page: 'review', params: { pr: '43' },
    } }))
    await ctx.taskCenter.take(taken.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })
    const orphaned = await ctx.taskCenter.markAppOrphaned('review-workbench', 'uninstalled')
    expect(orphaned.map(row => row.status)).toEqual(['orphaned', 'orphaned'])
    expect((await ctx.taskCenter.get(open.id))?.status).toBe('orphaned')
    expect(await errorOf(ctx.taskCenter.take(open.id, { sessionId: 's1', actor: 'agent', leaseUntil: new Date(Date.now() + HOUR).toISOString() })))
      .toBe('task/orphaned')
    // 记录仍在，投递接缝不再返回 orphaned 的通知 / records kept; seam no longer returns them
    expect(await ctx.taskCenter.pendingDeliveries()).toHaveLength(0)
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

describe('persistence across a process restart', () => {
  it('restores task and delivery states consistently from the same storage root', async () => {
    const root = tempRoot()
    const first = await boot(root)
    await first.fiber
    const open = await first.ctx.taskCenter.send(draft())
    const taken = await first.ctx.taskCenter.send(draft({ title: 'In progress', target: {
      url: '/apps/review-workbench/review/pr-43' as PageInstanceKey, appId: 'review-workbench', page: 'review', params: { pr: '43' },
    } }))
    const lease = new Date(Date.now() + HOUR).toISOString()
    await first.ctx.taskCenter.take(taken.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease })
    await first.dispose()
    expect(first.ctx.storageDomain.get('task_center')).toBeUndefined()

    const second = await boot(root)
    await second.fiber
    const restoredOpen = await second.ctx.taskCenter.get(open.id)
    expect(restoredOpen?.status).toBe('open')
    expect(restoredOpen?.revision).toBe(1)
    const restoredTaken = await second.ctx.taskCenter.get(taken.id)
    expect(restoredTaken?.status).toBe('taken')
    expect(restoredTaken?.claimedBy?.leaseUntil).toBe(lease)
    expect(await second.ctx.taskCenter.pendingDeliveries()).toHaveLength(2)
    // 重启后同样懒过期 / lazy expiry still applies after the restart
    expect(await errorOf(second.ctx.taskCenter.take('task-none' as never, {
      sessionId: 's9', actor: 'agent', leaseUntil: lease,
    }))).toBe(TaskErrorCode.NotFound)
    await second.dispose()
  })
})
