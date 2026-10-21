/**
 * 子任务语义（§4.7）：建树、环不可能、级联、完成校验、树级互斥、安全上限、收件箱只出根。
 * Subtask semantics (§4.7): tree building, cycle impossibility, cascades, the
 * completion check, tree-level mutex, safety limits, roots-only inbox.
 *
 * 两种介质各司其职：持久化/重启语义跑真实 JSON 栈（每个用例一份全新临时根，
 * 并发安全）；安全上限只关心服务里的树运算，跑内存后端——批量建树的几百次
 * 写不再被磁盘 fsync 抖动拖进 vitest 的默认超时（顺序整库跑下复现过的缺陷）。
 * Two media with two jobs: persistence/restart semantics run the real JSON
 * stack (a fresh temp root per case, safe under concurrent workers); the
 * safety limits only exercise in-service tree arithmetic and run on the
 * in-memory backend — hundreds of bulk writes can no longer be dragged past
 * vitest's default timeout by disk fsync jitter (reproduced under sequential
 * whole-repo runs).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import TaskCenterPlugin from '../src/index.ts'
import type { TaskCenterService } from '../src/index.ts'
import { MAX_TREE_DEPTH, MAX_TREE_SIZE, MAX_TREE_WIDTH } from '../src/tree.ts'
import { TaskErrorCode } from '../src/types.ts'
import type { TaskDraft, TaskKind, TaskRecord } from '../src/types.ts'
import type { PageInstanceKey } from '@veren/prompt-page'
import { MemoryStorageBackend, mountMemoryBackend } from './fake-storage.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  // 假时钟不跨用例泄漏（用例中途失败也要还原）/ the fake clock must not leak
  // across cases (restore even on a mid-case failure)
  vi.useRealTimers()
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'task-center-subtask-'))
  roots.push(root)
  return root
}

async function boot(root: string): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} } as never)
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const fiber = ctx.plugin(TaskCenterPlugin)
  await fiber
  return { ctx, dispose: async () => { await (fiber as { dispose(): Promise<void> }).dispose() } }
}

/**
 * 内存介质启动：真实 hub + domain 栈，只有后端是 Map（见 fake-storage.ts）。
 * Memory-medium boot: the real hub and domain stack with a Map backend only
 * (see fake-storage.ts).
 */
async function bootMemory(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} } as never)
  await ctx.plugin(Storage.default)
  mountMemoryBackend(ctx, new MemoryStorageBackend())
  await ctx.plugin(StorageDomain, { backend: 'memory' })
  const fiber = ctx.plugin(TaskCenterPlugin)
  await fiber
  return { ctx, dispose: async () => { await (fiber as { dispose(): Promise<void> }).dispose() } }
}

const HOUR = 60 * 60 * 1000
const lease = () => new Date(Date.now() + HOUR).toISOString()

const URL = '/apps/review-workbench/review/pr-42' as PageInstanceKey

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    kind: 'review-workbench/review-request' as TaskKind,
    title: 'Review PR #42',
    target: { url: URL, appId: 'review-workbench', page: 'review', params: { pr: '42' } },
    ...overrides,
  }
}

/** 供 addSubtask 用的最小草稿：target 沿用父任务 / a minimal draft reusing the parent's target */
function subDraft(task: TaskRecord, title: string): TaskDraft {
  return { kind: task.kind, title, target: task.target }
}

function errorOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => { throw new Error('expected the call to throw') },
    (error: { code?: string }) => error.code ?? String(error),
  )
}

/** 建一棵 R → C → G 三层树 / build one R → C → G three-level tree */
async function growTree(taskCenter: TaskCenterService): Promise<{ root: TaskRecord; child: TaskRecord; grandchild: TaskRecord }> {
  const root = await taskCenter.send(draft())
  const child = await taskCenter.addSubtask(root.id, subDraft(root, '拆出的子步骤'))
  const grandchild = await taskCenter.addSubtask(child.id, subDraft(child, '再拆一层'))
  return { root, child, grandchild }
}

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

describe('安全上限（§4.7.1）', () => {
  // 三条用例各自批量建树（7/32/199 条子任务），被测语义是服务里的树运算与
  // 上限拒绝，与介质无关——跑内存后端，几百次写不再被磁盘 fsync 抖动拖进
  // vitest 的默认 5s 超时（顺序整库跑下复现过的缺陷）；持久化语义由上面跑
  // 真实 JSON 栈的用例覆盖。
  // / Each case bulk-builds a tree (7/32/199 subtasks); the semantics under
  // test are in-service tree arithmetic and the limit refusals, independent
  // of the medium — they run on the in-memory backend so hundreds of writes
  // cannot be dragged past vitest's default 5s timeout by disk fsync jitter
  // (reproduced under sequential whole-repo runs); persistence semantics stay
  // covered by the real-JSON-stack cases above.
  it('深度超过 8 → task/subtree-limit（kind: depth）', async () => {
    const { ctx, dispose } = await bootMemory()
    let node = await ctx.taskCenter.send(draft())
    for (let depth = 2; depth <= MAX_TREE_DEPTH; depth += 1) {
      node = await ctx.taskCenter.addSubtask(node.id, subDraft(node, `第 ${depth} 层`))
    }
    expect(await errorOf(ctx.taskCenter.addSubtask(node.id, subDraft(node, '第 9 层'))))
      .toBe(TaskErrorCode.SubtreeLimit)
    await dispose()
  })

  it('单节点直接子节点超过 32 → task/subtree-limit（kind: width）', async () => {
    const { ctx, dispose } = await bootMemory()
    const root = await ctx.taskCenter.send(draft())
    for (let index = 0; index < MAX_TREE_WIDTH; index += 1) {
      await ctx.taskCenter.addSubtask(root.id, subDraft(root, `子任务 ${index + 1}`))
    }
    expect(await errorOf(ctx.taskCenter.addSubtask(root.id, subDraft(root, '第 33 个'))))
      .toBe(TaskErrorCode.SubtreeLimit)
    await dispose()
  })

  it('单棵树节点数达到 200 后再挂 → task/subtree-limit（kind: size）', async () => {
    const { ctx, dispose } = await bootMemory()
    const root = await ctx.taskCenter.send(draft())
    // 广度优先铺满 200 个节点（每节点至多 32 个直接子节点）
    // / fill exactly 200 nodes breadth-first (at most 32 direct children per node)
    let level: TaskRecord[] = [root]
    let size = 1
    while (size < MAX_TREE_SIZE) {
      const nextLevel: TaskRecord[] = []
      for (const parent of level) {
        const slots = Math.min(MAX_TREE_WIDTH, MAX_TREE_SIZE - size)
        for (let index = 0; index < slots; index += 1) {
          nextLevel.push(await ctx.taskCenter.addSubtask(parent.id, subDraft(parent, `n-${size}`)))
          size += 1
        }
        if (size >= MAX_TREE_SIZE) break
      }
      level = nextLevel
    }
    expect(size).toBe(MAX_TREE_SIZE)
    // 树已满：往一个宽度未满的深层节点上再挂，触发的必须是 size 而不是 width
    // / the tree is full: attaching under a deep node with spare width must hit
    // `size`, not `width`
    const deepNode = level[0]!
    expect(await errorOf(ctx.taskCenter.addSubtask(deepNode.id, subDraft(deepNode, '第 201 个'))))
      .toBe(TaskErrorCode.SubtreeLimit)
    await dispose()
  })
})
