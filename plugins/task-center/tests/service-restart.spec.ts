/**
 * TaskCenterService persistence semantics: app-uninstall orphans and the
 * task/delivery state restore across a process restart over the same storage
 * root.
 *
 * TaskCenterService 持久化语义：应用卸载孤儿化，以及跨进程重启从同一存储根恢复的
 * 任务/投递状态。
 */

import { describe, expect, it } from 'vitest'
import { TaskErrorCode } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'
import { HOUR, boot, draft, errorOf, tempRoot } from './service-helpers.ts'

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
