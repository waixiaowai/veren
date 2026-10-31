/**
 * Subtask tree building and the completion check (§4.7.1/§4.7.2 rule one):
 * ancestorIds settle from root to parent, deliveries stay roots-only, target
 * mismatches and gone/terminal parents are refused, cycles are structurally
 * impossible, and a parent's complete waits for the whole subtree. All on the
 * real JSON stack (media policy in subtask-helpers.ts).
 *
 * 子任务建树与完成校验（§4.7.1/§4.7.2 规则一）：ancestorIds 从根到父一次定型、投递行
 * 只出根任务、target 不一致与父缺失/终结被拒、环在结构上不可能、父的 complete 等
 * 整棵子树。全部跑真实 JSON 栈（介质政策见 subtask-helpers.ts）。
 */

import { describe, expect, it } from 'vitest'
import { TaskErrorCode } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'
import { boot, draft, errorOf, growTree, lease, subDraft, tempRoot } from './subtask-helpers.ts'

describe('建树（§4.7.1）', () => {
  it('父 → 子 → 孙：ancestorIds 从根到父一次定型，根为空数组', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child, grandchild } = await growTree(ctx.taskCenter)
    expect(root.parentId).toBeUndefined()
    expect(root.ancestorIds).toEqual([])
    expect(child.parentId).toBe(root.id)
    expect(child.ancestorIds).toEqual([root.id])
    expect(grandchild.parentId).toBe(child.id)
    expect(grandchild.ancestorIds).toEqual([root.id, child.id])
    // 重读一致（持久化生效）/ identical after a re-read (persistence works)
    expect((await ctx.taskCenter.get(grandchild.id))?.ancestorIds).toEqual([root.id, child.id])
    await dispose()
  })

  it('子任务不产生投递行，pendingDeliveries 只出根任务（§4.7.5）', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child, grandchild } = await growTree(ctx.taskCenter)
    const notices = await ctx.taskCenter.pendingDeliveries()
    expect(notices).toHaveLength(1)
    expect(notices[0]!.task.id).toBe(root.id)
    expect(notices.map(row => row.task.id)).not.toContain(child.id)
    expect(notices.map(row => row.task.id)).not.toContain(grandchild.id)
    await dispose()
  })

  it('子任务 target.url 与父不一致 → task/subtask-target-mismatch', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const root = await ctx.taskCenter.send(draft())
    expect(await errorOf(ctx.taskCenter.addSubtask(root.id, draft({
      title: '跑错页面的子任务',
      target: { url: '/apps/review-workbench/review/pr-43' as PageInstanceKey, appId: 'review-workbench', page: 'review', params: {} },
    })))).toBe(TaskErrorCode.SubtaskTargetMismatch)
    await dispose()
  })

  it('父不存在 → task/parent-gone；父已终结 → task/invalid-state', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const root = await ctx.taskCenter.send(draft())
    expect(await errorOf(ctx.taskCenter.addSubtask('task-none' as never, draft())))
      .toBe(TaskErrorCode.ParentGone)
    await ctx.taskCenter.cancel(root.id, 'superseded')
    expect(await errorOf(ctx.taskCenter.addSubtask(root.id, draft())))
      .toBe(TaskErrorCode.InvalidState)
    await dispose()
  })
})

describe('环在结构上不可能（§4.7.1）', () => {
  it('addSubtask 只创建新记录：把“后代 id”当父传也只会长出新叶子，父指针永不改写', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child } = await growTree(ctx.taskCenter)
    // 尝试“把根挂到自己的后代 child 下”：只会创建一条以 child 为父的新记录，
    // root.parentId 不可变，环闭不上。/ "attach the root under its own descendant"
    // merely creates a fresh leaf under child; root.parentId is immutable, so no
    // cycle can close.
    const created = await ctx.taskCenter.addSubtask(child.id, subDraft(child, '新叶子'))
    expect(created.id).not.toBe(root.id)
    expect(created.ancestorIds).toEqual([root.id, child.id])
    expect((await ctx.taskCenter.get(root.id))?.parentId).toBeUndefined()
    await dispose()
  })
})

describe('完成校验（§4.7.2 规则一）', () => {
  it('子树有非终态后代时父 complete 被拒 task/children-active；全部终态后才放行', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child, grandchild } = await growTree(ctx.taskCenter)
    await ctx.taskCenter.take(root.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    await ctx.taskCenter.take(child.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    await ctx.taskCenter.take(grandchild.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    expect(await errorOf(ctx.taskCenter.complete(root.id, { summary: 'too early' })))
      .toBe(TaskErrorCode.ChildrenActive)
    await ctx.taskCenter.complete(grandchild.id, { summary: 'leaf done' })
    expect(await errorOf(ctx.taskCenter.complete(root.id, { summary: 'still too early' })))
      .toBe(TaskErrorCode.ChildrenActive)
    await ctx.taskCenter.complete(child.id, { summary: 'branch done' })
    const done = await ctx.taskCenter.complete(root.id, { summary: 'all clear' })
    expect(done.status).toBe('done')
    await dispose()
  })
})
