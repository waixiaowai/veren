import { describe, expect, it } from 'vitest'
import { diffItems, TaskStore } from '../src/store.ts'
import { dispatchTool, itemsOfSnapshot, renderSync, SYSTEM_PROMPT, TOOLS } from '../src/protocol.ts'
import { makeList } from '../src/store.ts'
import type { TaskItem } from '../src/types.ts'

describe('store', () => {
  it('1000 条改 2 条产出 2 个 ops', () => {
    const prev = makeList(1000)
    const next = prev.map((item) => ({ ...item }))
    next[204] = { ...next[204], status: 'taken', ownerId: 'u-1' }
    next[817] = { ...next[817], status: 'done' }
    expect(diffItems(prev, next)).toHaveLength(2)
  })

  it('按钮状态迁移校验：open→taken→done，非法迁移 fail loud', () => {
    const store = new TaskStore(makeList(5))
    expect(store.takeTask('t-1', 'model').ok).toBe(true)
    expect(store.takeTask('t-1', 'model')).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(store.completeTask('t-1').ok).toBe(true)
    expect(store.completeTask('t-1')).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(store.takeTask('t-999', 'model')).toMatchObject({ ok: false, code: 'task_not_found' })
  })

  it('sync 增量优先（splice op）、缺口/超前兜底全量快照', () => {
    const store = new TaskStore(makeList(5))
    const v0 = store.currentVersion
    store.takeTask('t-0', 'u-1')
    const sync = store.sync(v0)
    expect(sync.kind).toBe('patch')
    if (sync.kind === 'patch') {
      expect(sync.ops[0]).toMatchObject({ op: 'splice', path: 'tasks', id: 't-0' })
    }
    expect(store.sync(999).kind).toBe('snapshot')
    const snap = store.sync(undefined)
    expect(snap.kind).toBe('snapshot')
    if (snap.kind === 'snapshot') expect(itemsOfSnapshot(snap.nodes)).toHaveLength(5)
  })
})

describe('protocol', () => {
  it('补丁模板字节级稳定（canonical 键序，骨架固定）', () => {
    const items: TaskItem[] = [{ id: 't-1', title: 'a', status: 'open', ownerId: null }]
    const a = renderSync({ kind: 'patch', fromVersion: 1, toVersion: 2, ops: [{ op: 'splice', path: 'tasks', id: 't-1', entity: items[0] }] })
    const updated: TaskItem = { ...items[0], title: 'b' }
    const b = renderSync({ kind: 'patch', fromVersion: 3, toVersion: 4, ops: [{ op: 'splice', path: 'tasks', id: 't-1', entity: updated }] })
    expect(a.startsWith('PATCH v1->v2 {"ops":[{"entity":{"id":"t-1",')).toBe(true)
    expect(b.startsWith('PATCH v3->v4 {"ops":[{"entity":{"id":"t-1",')).toBe(true)
    // canonical：entity,id,op,path 字典序
    expect(a).toContain('"op":"splice","path":"tasks"}')
  })

  it('dispatch：JSON 解析失败与未知工具返回结构化错误', () => {
    const store = new TaskStore(makeList(3))
    expect(dispatchTool(store, 'take_task', 'not-json')).toMatchObject({ ok: false, code: 'bad_arguments' })
    expect(dispatchTool(store, 'nope', '{}')).toMatchObject({ ok: false, code: 'unknown_tool' })
    expect(dispatchTool(store, 'take_task', '{"task_id":"t-0"}').ok).toBe(true)
  })

  it('工具表静态：系统提示词与工具定义不含任何任务数据', () => {
    expect(SYSTEM_PROMPT).not.toContain('t-0')
    expect(TOOLS.every((tool) => typeof tool.function.name === 'string')).toBe(true)
  })
})
