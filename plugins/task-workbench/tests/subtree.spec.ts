/**
 * 子任务树（§4.7.8）：整树进度、子任务树投影、split_task 的守卫与降级、
 * 父指针不可变（环结构上不可能）。
 * Subtask trees (§4.7.8): whole-subtree progress, the subtask-tree projection,
 * split_task guards and degrade, and the immutable parent pointer (cycles are
 * structurally impossible).
 */

import { describe, expect, it } from 'vitest'
import { rootsOf, subtreeProgress, subtaskTree, TaskStore } from '../src/store.ts'
import type { TaskItem } from '../src/types.ts'

/** 建 R → C1/C2 → G 三层树 / build one R → C1/C2 → G three-level tree */
function grow(): { store: TaskStore; items: TaskItem[] } {
  const store = new TaskStore([
    { id: 't-1', title: '根', status: 'open' },
  ])
  store.takeTask('t-1', 'model')
  store.splitTask('t-1', '子 1')
  store.splitTask('t-1', '子 2')
  store.takeTask('t-3', 'model')
  store.splitTask('t-3', '孙 1')
  return { store, items: store.getSnapshot() }
}

describe('整树进度（§4.7.8 第 1 条）', () => {
  it('进度按整棵子树口径（含根），非终态即 active', () => {
    const { items } = grow()
    const progress = subtreeProgress(items, 't-1')
    expect(progress.label).toBe('0/4')
    expect(progress.active).toBe(true)
    // 完成 G（t-4）后整树 1/4 / after finishing G the tree is 1/4
    store_progress_after_done(items)
  })

  it('列表口径只出根任务 / the list view shows roots only', () => {
    const { items } = grow()
    expect(rootsOf(items).map((item) => item.id)).toEqual(['t-1'])
  })
})

function store_progress_after_done(items: TaskItem[]): void {
  const done: TaskItem[] = items.map((item) =>
    item.id === 't-4' ? { ...item, status: 'done' as const } : item)
  expect(subtreeProgress(done, 't-1').label).toBe('1/4')
}

describe('子任务树投影（§4.7.8 第 2 条）', () => {
  it('逐层列出后代，活跃分支默认展开，带各层进度', () => {
    const { items } = grow()
    const nodes = subtaskTree(items, 't-1')
    expect(nodes.map((node) => node.item.id)).toEqual(['t-2', 't-3', 't-4'])
    expect(nodes.map((node) => node.depth)).toEqual([1, 1, 2])
    // 全树未完成 → 全部分支展开 / nothing terminal yet → every branch expanded
    expect(nodes.map((node) => node.expanded)).toEqual([true, true, true])
    expect(nodes[2]!.progress.label).toBe('0/1')
  })
})

describe('split（§4.7.6）', () => {
  it('只能拆 taken 节点；只创建新记录，父指针一次定型', () => {
    const store = new TaskStore([{ id: 't-1', title: '根', status: 'open' }])
    expect(store.splitTask('t-1', '不许拆').outcome).toBe('bad-state')
    expect(store.splitTask('ghost', '不存在').outcome).toBe('not-found')
    store.takeTask('t-1', 'model')
    const first = store.splitTask('t-1', '子')
    expect(first.outcome).toBe('ok')
    const again = store.splitTask('t-1', '另一个子')
    expect(again.outcome).toBe('ok')
    // “把根挂到自己后代下”只会长出新叶子，root.parentId 永不改写
    // / "attaching the root under its descendant" only grows a new leaf
    store.takeTask(first.item!.id, 'model')
    const underChild = store.splitTask(first.item!.id, '孙')
    expect(underChild.item!.parentId).toBe(first.item!.id)
    expect((store.getSnapshot().find((item) => item.id === 't-1'))?.parentId).toBeUndefined()
  })
})
