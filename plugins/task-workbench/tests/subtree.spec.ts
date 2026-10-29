/**
 * 子任务树（§4.7.8）：整树进度、子任务树投影是纯函数（条目直接构造）；
 * store.rebuildFrom 的分组与父链（队列权威搬家的投影路径，§1.1）。
 * Subtask trees (§4.7.8): whole-subtree progress and the subtask-tree
 * projection are pure functions (items constructed directly); store.rebuildFrom's
 * grouping and parent chain (the queue-authority move's projection path, §1.1).
 */
import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '@veren/task-center'
import { rootsOf, subtreeProgress, subtaskTree, TaskStore } from '../src/store.ts'
import type { TaskItem } from '../src/types.ts'

/** 建 R → C1/C2 → G 三层树的条目 / build one R → C1/C2 → G three-level item tree */
function grow(): TaskItem[] {
  return [
    { id: 't-1', title: '根', status: 'taken', ownerId: 'model' },
    { id: 't-2', title: '子 1', status: 'open', parentId: 't-1' },
    { id: 't-3', title: '子 2', status: 'taken', parentId: 't-1', ownerId: 'model' },
    { id: 't-4', title: '孙 1', status: 'open', parentId: 't-3' },
  ]
}

describe('整树进度（§4.7.8 第 1 条）', () => {
  it('进度按整棵子树口径（含根），非终态即 active', () => {
    const items = grow()
    const progress = subtreeProgress(items, 't-1')
    expect(progress.label).toBe('0/4')
    expect(progress.active).toBe(true)
    // 完成 G（t-4）后整树 1/4 / after finishing G the tree is 1/4
    const done: TaskItem[] = items.map((item) =>
      item.id === 't-4' ? { ...item, status: 'done' as const } : item)
    expect(subtreeProgress(done, 't-1').label).toBe('1/4')
    // failed 也算终态（与任务中心同口径）/ failed counts as terminal too (same as the center)
    const failed: TaskItem[] = items.map((item) =>
      item.id === 't-4' ? { ...item, status: 'failed' as const } : item)
    expect(subtreeProgress(failed, 't-1').label).toBe('1/4')
  })

  it('列表口径只出根工作单 / the list view shows root orders only', () => {
    expect(rootsOf(grow()).map((item) => item.id)).toEqual(['t-1'])
  })
})

describe('子任务树投影（§4.7.8 第 2 条）', () => {
  it('逐层列出后代，活跃分支默认展开，带各层进度', () => {
    const items = grow()
    const nodes = subtaskTree(items, 't-1')
    expect(nodes.map((node) => node.item.id)).toEqual(['t-2', 't-3', 't-4'])
    expect(nodes.map((node) => node.depth)).toEqual([1, 1, 2])
    // 全树未完成 → 全部分支展开 / nothing terminal yet → every branch expanded
    expect(nodes.map((node) => node.expanded)).toEqual([true, true, true])
    expect(nodes[2]!.progress.label).toBe('0/1')
  })
})

// ---- rebuildFrom：中心记录 → 投影（§1.1）/ rebuildFrom: center records → projection ----

/** 最小记录构造（只带投影需要的字段）/ a minimal record (only the fields the projection reads) */
function recordOf(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: id as TaskRecord['id'],
    appId: 'task-workbench',
    kind: 'task-workbench/publish' as TaskRecord['kind'],
    title: `单 ${id}`,
    target: { url: '/apps/task-workbench/task/t-1', appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    appVersion: '0.0.0',
    assignee: 'local',
    status: 'open',
    revision: 1,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    ancestorIds: [],
    schemaVersion: 2,
    ...overrides,
  } as TaskRecord
}

describe('rebuildFrom（队列权威在中心的投影）', () => {
  it('根按工作单 id 分组（入站参数优先），子任务按父链挂行，attempts 数根级记录', () => {
    const store = new TaskStore()
    store.rebuildFrom([
      recordOf('task-1'),
      recordOf('task-9', { updatedAt: '2026-10-29T01:00:00.000Z' }),
      recordOf('task-2', { parentId: 'task-1' as TaskRecord['id'], ancestorIds: ['task-1' as TaskRecord['id']] }),
    ])
    const items = store.getState()
    // 同工作单 id 的两条根记录合成一个条目，活跃载体 = 最新 updatedAt 的 open 记录
    // / two root records of one work order merge into one item; the active vehicle = the latest open record
    expect(rootsOf(items).map((item) => item.id)).toEqual(['t-1'])
    expect(rootsOf(items)[0]?.activeRecordId).toBe('task-9')
    expect(rootsOf(items)[0]?.attempts).toBe(2)
    // 子任务行带父链 / the subtask row carries the parent chain
    expect(items.find((item) => item.id === 'wb-task-2')).toMatchObject({ parentId: 't-1', status: 'open' })
  })

  it('出站记录（幂等键内嵌工作单 id）入组并翻 dispatchedTo；终态组仍保留为历史行', () => {
    const store = new TaskStore()
    store.rebuildFrom([
      recordOf('task-out', {
        appId: 'person-agent',
        title: '派出去的单',
        target: { url: '/apps/person-agent/overview', appId: 'person-agent', page: 'overview', params: {} } as TaskRecord['target'],
        idempotencyKey: 'task-workbench/t-7/person-agent-a1',
      }),
      recordOf('task-done', { status: 'done' }),
    ])
    const roots = rootsOf(store.getState())
    expect(roots.find((item) => item.id === 't-7')).toMatchObject({ dispatchedTo: 'person-agent', status: 'open' })
    expect(roots.find((item) => item.id === 't-1')).toMatchObject({ status: 'done', activeRecordId: 'task-done' })
  })

  it('nextItemId 从现有条目推大；claimLocal 只动投影且 done 拒绝', () => {
    const store = new TaskStore()
    store.rebuildFrom([recordOf('task-1')])
    expect(store.nextItemId()).toBe('t-2')
    store.claimLocal('t-1', 'model')
    expect(store.getState()[0]).toMatchObject({ status: 'taken', ownerId: 'model' })
    store.rebuildFrom([recordOf('task-1', { status: 'done' })])
    store.claimLocal('t-1', 'model')
    expect(store.getState()[0]?.status).toBe('done')
  })
})
