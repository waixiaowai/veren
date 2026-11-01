/**
 * The delivery pump's own semantics (the effects base under the inbox seam):
 * a sent notice gets exactly one effect row; a settled receipt releases it; a
 * terminal task's notice settles to `read` within the pump cadence without
 * anyone pulling; an orphaned task's notice stays pending (§4.5) but stops
 * pumping; and pump rows persist across a restart over the same root.
 *
 * Observation goes through the real storage domains (`task_center_effects`
 * rows, `task_center` delivery rows) — the pump is internal, its durable
 * effects are not.
 *
 * 投递泵自己的语义（收件箱接缝下的效果核底座）：发出的通知恰有一条效果行；回执落定即
 * 撤行；终态任务的通知在泵节拍内无人拉取也翻 `read`；孤儿任务的通知按 §4.5 保持
 * pending 但停止泵送；泵行跨重启在同一存储根上持久。
 *
 * 观测走真实存储域（`task_center_effects` 的效果行、`task_center` 的投递行）——泵是
 * 内部的，它的持久效果不是。
 */

import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot, draft, tempRoot } from './service-helpers.ts'
import type { DeliveryRecord } from '../src/storage.ts'

/** 行数走真实泵域 / the effect row count via the real pump domain */
function effectRowCount(ctx: Context): number {
  return ctx.storageDomain.get('task_center_effects')!.table('effects').size
}

/** 投递行走真实任务域 / the delivery row of one task via the real task domain */
function deliveryRowOf(ctx: Context, taskId: string): DeliveryRecord | undefined {
  for (const [, row] of ctx.storageDomain.get('task_center')!.table('deliveries').entries()) {
    if ((row as DeliveryRecord).taskId === taskId) return row as DeliveryRecord
  }
  return undefined
}

it('tracks a sent notice as one effect row and releases it when the delivery settles', async () => {
  const { ctx, fiber, dispose } = await boot(tempRoot())
  await fiber
  await ctx.taskCenter.send(draft())
  const [notice] = await ctx.taskCenter.pendingDeliveries()
  expect(effectRowCount(ctx)).toBe(1)
  await ctx.taskCenter.markDelivered(notice!.deliveryId)
  expect(effectRowCount(ctx)).toBe(0)
  await dispose()
})

it('settles a terminal task notice to read within the pump cadence, with nobody pulling', async () => {
  const { ctx, fiber, dispose } = await boot(tempRoot())
  await fiber
  const task = await ctx.taskCenter.send(draft())
  await ctx.taskCenter.cancel(task.id, 'obsolete')
  // 泵节拍 2s、暂缓重试 2s：给两个完整节拍 / one pump tick of 2s plus the 2s defer: allow two full cycles
  await vi.waitFor(() => {
    expect(deliveryRowOf(ctx, task.id)?.state).toBe('read')
  }, { timeout: 7000 })
  expect(effectRowCount(ctx)).toBe(0)
  await dispose()
}, 8000)

it('keeps an orphaned task notice pending but stops pumping it (§4.5)', async () => {
  const { ctx, fiber, dispose } = await boot(tempRoot())
  await fiber
  const task = await ctx.taskCenter.send(draft())
  await ctx.taskCenter.markAppOrphaned(task.appId, 'uninstalled')
  await vi.waitFor(() => {
    // 泵把孤儿通知的效果行撤掉（成功结算），但回执保持 pending / the pump settles the orphan's effect row away, the receipt stays pending
    expect(effectRowCount(ctx)).toBe(0)
  }, { timeout: 7000 })
  expect(deliveryRowOf(ctx, task.id)?.state).toBe('pending')
  await dispose()
}, 8000)

it('persists pump rows across a restart over the same storage root', async () => {
  const root = tempRoot()
  const first = await boot(root)
  await first.fiber
  await first.ctx.taskCenter.send(draft())
  expect(effectRowCount(first.ctx)).toBe(1)
  await first.dispose()
  const second = await boot(root)
  await second.fiber
  expect(effectRowCount(second.ctx)).toBe(1)
  await second.dispose()
})
