/**
 * Subtask cascade semantics (§4.7.2 rule two), tree-level mutex (§4.7.3), and
 * index rebuild after a restart: cancels/expiries cascade over the non-terminal
 * subtree while terminal descendants stay, one session holding a tree blocks
 * every other session at every level, and a fresh Context over the same
 * storage root rebuilds the subtree/mutex/completion facts from the KV rows.
 * All on the real JSON stack (media policy in subtask-helpers.ts).
 *
 * 子任务级联语义（§4.7.2 规则二）、树级互斥（§4.7.3）与重启后索引重建：取消/过期沿
 * 非终态子树级联而终态后代保留；一条会话持有树后挡住其他会话在任何层的接取；同一存储
 * 目录上的全新 Context 从 KV 行重建子树/互斥/完成校验事实。全部跑真实 JSON 栈
 * （介质政策见 subtask-helpers.ts）。
 */

import { describe, expect, it, vi } from 'vitest'
import { TaskErrorCode } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'
import { HOUR, boot, draft, errorOf, growTree, lease, subDraft, tempRoot } from './subtask-helpers.ts'

describe('重启后索引重建', () => {
  it('整个 Context 销毁后用同一存储目录重开：子树/级联/互斥/完成校验全部仍正确', async () => {
    const longLease = () => new Date(Date.now() + HOUR).toISOString()
    // 先造一棵持久的 R → C → G 树：G 已 done，C 被 s1 持有
    // / first grow a persistent R → C → G tree: G done, C held by s1
    const root = tempRoot()
    const first = await boot(root)
    const tree = await growTree(first.ctx.taskCenter)
    await first.ctx.taskCenter.take(tree.grandchild.id, { sessionId: 's1', actor: 'agent', leaseUntil: longLease() })
    await first.ctx.taskCenter.complete(tree.grandchild.id, { summary: 'leaf done before restart' })
    await first.ctx.taskCenter.take(tree.child.id, { sessionId: 's1', actor: 'agent', leaseUntil: longLease() })
    await first.dispose()

    // 全新 Context + 同一目录：内存索引从 KV 重建 / a fresh Context over the same
    // root: the in-memory index rebuilds from the KV rows
    const second = await boot(root)
    const tasks = second.ctx.taskCenter
    // ① 子树查询（ancestorIds 持久化）：孙的祖先链原样 / subtree query: the
    // grandchild's ancestor chain survived
    expect((await tasks.get(tree.grandchild.id))?.ancestorIds).toEqual([tree.root.id, tree.child.id])
    // ② 完成校验：父 complete 仍被子树状态挡住 / completion check still sees the tree
    await tasks.take(tree.root.id, { sessionId: 's1', actor: 'agent', leaseUntil: longLease() })
    expect(await errorOf(tasks.complete(tree.root.id, { summary: 'too early' })))
      .toBe(TaskErrorCode.ChildrenActive)
    // ③ 整树互斥：重启前写入的租约仍挡住别的会话 / tree mutex: the pre-restart
    // lease still blocks another session
    expect(await errorOf(tasks.take(tree.child.id, { sessionId: 's2', actor: 'agent', leaseUntil: longLease() })))
      .toBe(TaskErrorCode.AlreadyTaken)
    // ④ 级联：释放两条租约后取消根 → 非终态子树进 cancelled，done 的孙保留
    // / cascade: release both leases, then cancel the root — the non-terminal
    // subtree cascades, the done leaf stays
    await tasks.release(tree.root.id, 'before the cascade check')
    await tasks.release(tree.child.id, 'before the cascade check')
    await tasks.cancel(tree.root.id, 'after restart')
    expect((await tasks.get(tree.child.id))?.status).toBe('cancelled')
    expect((await tasks.get(tree.grandchild.id))?.status).toBe('done')
    await second.dispose()
  })
})

describe('级联（§4.7.2 规则二）', () => {
  it('父 cancel → 整棵子树非终态节点 cancelled（带 cascade 理由），终态后代保留', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child, grandchild } = await growTree(ctx.taskCenter)
    // 孙先做完 → 级联时保留 / finish the grandchild first → kept by the cascade
    await ctx.taskCenter.take(grandchild.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    await ctx.taskCenter.complete(grandchild.id, { summary: 'leaf done' })
    await ctx.taskCenter.cancel(root.id, 'superseded')
    expect((await ctx.taskCenter.get(child.id))?.status).toBe('cancelled')
    expect((await ctx.taskCenter.get(child.id))?.failure?.code).toBe(TaskErrorCode.CascadeCancelled)
    expect((await ctx.taskCenter.get(grandchild.id))?.status).toBe('done')
    expect((await ctx.taskCenter.get(root.id))?.failure).toBeUndefined()
    await dispose()
  })

  it('父 open 过期 → 子树里 open 后代 expired、taken 后代 cancelled', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    // 假时钟只替换 Date：死线之后的建树写盘耗时再慢也拨不动时钟，懒清扫不可能
    // 在建树途中触发；建树完成后才把时钟拨过死线——清扫触发点是确定性的，
    // 不再依赖"四次落盘必须在 500ms 真实时间内跑完"。
    // / The fake clock swaps Date only: however slow the post-deadline
    // tree-building writes are, the frozen clock cannot reach the deadline, so
    // the lazy sweep cannot fire mid-build. The clock advances past the
    // deadline only after the tree is built — a deterministic sweep trigger
    // with no "four durable writes must fit in 500ms of real time" premise.
    vi.useFakeTimers({ toFake: ['Date'] })
    const root = await ctx.taskCenter.send(draft({ expiresAt: new Date(Date.now() + 500).toISOString() }))
    const child = await ctx.taskCenter.addSubtask(root.id, subDraft(root, '子'))
    const takenChild = await ctx.taskCenter.addSubtask(root.id, subDraft(root, '已接取的子'))
    await ctx.taskCenter.take(takenChild.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    // 时钟拨过死线 1s（租约仍有 1h，不受影响）/ advance the clock 1s past the
    // deadline (the 1h lease is unaffected)
    vi.setSystemTime(Date.now() + 1000)
    await ctx.taskCenter.get(root.id) // 触发懒清扫 / trigger the lazy sweep
    expect((await ctx.taskCenter.get(root.id))?.status).toBe('expired')
    expect((await ctx.taskCenter.get(child.id))?.status).toBe('expired')
    expect((await ctx.taskCenter.get(takenChild.id))?.status).toBe('cancelled')
    await dispose()
  })

  it('卸载孤儿判定扫整棵树：markAppOrphaned 把整棵子树标 orphaned', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child, grandchild } = await growTree(ctx.taskCenter)
    await ctx.taskCenter.take(child.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    const changed = await ctx.taskCenter.markAppOrphaned('review-workbench', 'uninstalled')
    expect(changed.map(row => row.id).sort()).toEqual([root.id, child.id, grandchild.id].sort())
    expect((await ctx.taskCenter.get(grandchild.id))?.status).toBe('orphaned')
    await dispose()
  })
})

describe('树级互斥（§4.7.3）', () => {
  it('一条会话持有树后，另一条会话接同树任意层被拒 task/already-taken；持有者可继续接任意 open 节点', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root, child, grandchild } = await growTree(ctx.taskCenter)
    await ctx.taskCenter.take(child.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    // 树内任何层都被别的会话挡住 / every level blocks other sessions
    for (const node of [root, grandchild]) {
      expect(await errorOf(ctx.taskCenter.take(node.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease() })))
        .toBe(TaskErrorCode.AlreadyTaken)
    }
    // 持有者逐个接取同树 open 节点 / the holder keeps taking open nodes in its tree
    await ctx.taskCenter.take(grandchild.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    await ctx.taskCenter.take(root.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    await dispose()
  })

  it('不同树的 URL 互不影响；同 URL 跨树仍互斥 task/another-active', async () => {
    const { ctx, dispose } = await boot(tempRoot())
    const { root } = await growTree(ctx.taskCenter)
    await ctx.taskCenter.take(root.id, { sessionId: 's1', actor: 'agent', leaseUntil: lease() })
    // 另一棵树、另一个 URL：不受影响 / another tree on another url: unaffected
    const otherTree = await ctx.taskCenter.send(draft({ target: {
      url: '/apps/review-workbench/review/pr-43' as PageInstanceKey,
      appId: 'review-workbench', page: 'review', params: { pr: '43' },
    } }))
    await ctx.taskCenter.take(otherTree.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease() })
    // 同 URL 的第二棵树：跨树互斥 / a second tree on the same url: cross-tree mutex
    const siblingTree = await ctx.taskCenter.send(draft({ title: '同一页面的另一棵树' }))
    expect(await errorOf(ctx.taskCenter.take(siblingTree.id, { sessionId: 's2', actor: 'agent', leaseUntil: lease() })))
      .toBe(TaskErrorCode.AnotherActive)
    await dispose()
  })
})
