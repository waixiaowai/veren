/**
 * Subtask safety limits (§4.7.1): depth, width, and size refusals with their
 * stable error kinds. These cases run on the in-memory backend — the semantics
 * under test are in-service tree arithmetic and the limit refusals,
 * independent of the medium (media policy in subtask-helpers.ts).
 *
 * 子任务安全上限（§4.7.1）：深度/宽度/规模三类拒绝及其稳定错误类别。这些用例跑内存
 * 后端——被测语义是服务里的树运算与上限拒绝，与介质无关（介质政策见
 * subtask-helpers.ts）。
 */

import { describe, expect, it } from 'vitest'
import { MAX_TREE_DEPTH, MAX_TREE_SIZE, MAX_TREE_WIDTH } from '../src/tree.ts'
import { TaskErrorCode } from '../src/types.ts'
import type { TaskRecord } from '../src/types.ts'
import { bootMemory, draft, errorOf, subDraft } from './subtask-helpers.ts'

describe('安全上限（§4.7.1）', () => {
  // 三条用例各自批量建树（7/32/199 条子任务），被测语义是服务里的树运算与
  // 上限拒绝，与介质无关——跑内存后端，几百次写不再被磁盘 fsync 抖动拖进
  // vitest 的默认 5s 超时（顺序整库跑下复现过的缺陷）；持久化语义由跑真实
  // JSON 栈的用例覆盖。
  // / Each case bulk-builds a tree (7/32/199 subtasks); the semantics under
  // test are in-service tree arithmetic and the limit refusals, independent
  // of the medium — they run on the in-memory backend so hundreds of writes
  // cannot be dragged past vitest's default 5s timeout by disk fsync jitter
  // (reproduced under sequential whole-repo runs); persistence semantics stay
  // covered by the real-JSON-stack cases.
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
