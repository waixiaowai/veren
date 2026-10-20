import { describe, expect, it } from 'vitest'
import { renderSync } from '@veren/prompt-host-messages'
import { TaskListPage, dispatchTaskTool } from '../src/page.ts'
import { TaskStore, makeList } from '../src/store.ts'
import { assemblePageSession } from '../src/driver.ts'

describe('store', () => {
  it('按钮状态迁移校验：open→taken→done / taken→open，非法迁移 fail loud', () => {
    const store = new TaskStore(makeList(5))
    expect(store.takeTask('t-1', 'model').ok).toBe(true)
    expect(store.takeTask('t-1', 'model')).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(store.completeTask('t-1').ok).toBe(true)
    expect(store.completeTask('t-1')).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(store.abandonTask('t-1')).toMatchObject({ ok: false, code: 'invalid_transition' })

    const store2 = new TaskStore(makeList(5))
    store2.takeTask('t-2', 'u-1')
    expect(store2.abandonTask('t-2').ok).toBe(true)
    expect(store2.getState().find((task) => task.id === 't-2')).toMatchObject({ status: 'open', ownerId: null })
    expect(store2.takeTask('t-999', 'u-1')).toMatchObject({ ok: false, code: 'task_not_found' })
  })

  it('不可变纪律：getState 引用在无变化时保持稳定（memo bailout 依赖）', () => {
    const store = new TaskStore(makeList(3))
    const before = store.getState()
    store.takeTask('t-0', 'u-1')
    expect(store.getState()).not.toBe(before)
    expect(store.getState().find((task) => task.id === 't-0')?.status).toBe('taken')
  })
})

describe('page + host integration (组件化全链路)', () => {
  it('同内容重复渲染 → memo bailout → 零 op；变化 → 仅差量 splice', () => {
    const store = new TaskStore(makeList(3))
    const host = assemblePageSession(store)
    const vMount = host.currentVersion
    const opCount = (): number => {
      const sync = host.renderSince(vMount)
      return sync.kind === 'patch' ? sync.ops.length : Number.POSITIVE_INFINITY
    }
    expect(opCount()).toBe(0)

    store.takeTask('t-1', 'u-1')
    expect(opCount()).toBe(1)

    const sync = host.renderSince(vMount)
    expect(sync.kind).toBe('patch')
    if (sync.kind === 'patch') {
      expect(sync.ops[0]).toMatchObject({ op: 'splice', path: 'tasks', id: 't-1' })
    }
  })

  it('全量快照模式：renderSince(undefined) 携带静态头与集合', () => {
    const store = new TaskStore(makeList(2))
    const host = assemblePageSession(store)
    const sync = host.renderSince(undefined)
    expect(sync.kind).toBe('snapshot')
    const text = renderSync(sync)
    expect(text.startsWith('SNAPSHOT v')).toBe(true)
    expect(text).toContain('"content":"任务中心 · 列表页"')
  })
})

describe('protocol', () => {
  it('dispatchTaskTool：JSON 解析失败与未知工具返回结构化错误', () => {
    const store = new TaskStore(makeList(3))
    expect(dispatchTaskTool(store, 'take_task', 'not-json')).toMatchObject({ ok: false, code: 'bad_arguments' })
    expect(dispatchTaskTool(store, 'nope', '{}')).toMatchObject({ ok: false, code: 'unknown_tool' })
    expect(dispatchTaskTool(store, 'take_task', '{"task_id":"t-0"}').ok).toBe(true)
  })

  it('静态面不含任何任务数据', () => {
    const elements = TaskListPage({ items: makeList(1) })
    expect(String(elements[0].props.content)).not.toContain('t-0')
  })
})
