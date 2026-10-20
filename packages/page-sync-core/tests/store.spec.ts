import { describe, expect, it } from 'vitest'
import { PageStore } from '../src/store.ts'
import { canonicalJson, fieldNode, keyedNode, logNode, renderSync, staticNode } from '../src/index.ts'
import type { Entity } from '../src/types.ts'

function task(id: string, status = 'open'): Entity & { status: string } {
  return { id, status }
}

describe('PageStore', () => {
  it('update 合批：一次 update 一个版本；无变化不推进', () => {
    const store = new PageStore([keyedNode('tasks', [task('a')])])
    const v0 = store.currentVersion
    const ops = store.update([keyedNode('tasks', [task('a'), task('b')]), fieldNode('count', 2)])
    expect(ops).toHaveLength(2)
    expect(store.currentVersion).toBe(v0 + 1)
    store.update([keyedNode('tasks', [task('a'), task('b')]), fieldNode('count', 2)])
    expect(store.currentVersion).toBe(v0 + 1)
  })

  it('sync 增量优先；缺口过大/游标超前回落全量', () => {
    const store = new PageStore([keyedNode('tasks', [])], { maxPatchGap: 2 })
    const v0 = store.currentVersion
    store.update([keyedNode('tasks', [task('a')])])
    expect(store.sync(v0).kind).toBe('patch')
    store.update([keyedNode('tasks', [task('a'), task('b')])])
    store.update([keyedNode('tasks', [task('a'), task('b'), task('c')])])
    expect(store.sync(0).kind).toBe('snapshot') // 缺口 3 > 2
    expect(store.sync(999).kind).toBe('snapshot') // 超前
    expect(store.sync(undefined).kind).toBe('snapshot') // 无基线
  })

  it('压实后旧游标回落全量快照，快照内容是当前状态', () => {
    const store = new PageStore([keyedNode('tasks', [])], { compactEvery: 2 })
    store.update([keyedNode('tasks', [task('a')])])
    const staleCursor = store.currentVersion
    store.update([keyedNode('tasks', [task('a'), task('b')])])
    store.update([keyedNode('tasks', [task('a'), task('b'), task('c')])])
    const sync = store.sync(staleCursor)
    expect(sync.kind).toBe('snapshot')
    if (sync.kind === 'snapshot') {
      const node = sync.nodes[0]
      expect(node.kind === 'keyed' && node.items).toHaveLength(3)
    }
  })

  it('stage/flush：background lane 攒批一次提交', () => {
    const store = new PageStore([])
    store.stage([{ op: 'set', path: 'a', value: 1 }])
    store.stage([{ op: 'set', path: 'b', value: 2 }])
    expect(store.currentVersion).toBe(0)
    const ops = store.flush()
    expect(ops).toHaveLength(2)
    expect(store.currentVersion).toBe(1)
    expect(store.flush()).toEqual([])
  })
})

describe('byte-stable rendering', () => {
  it('canonicalJson：键序与构造顺序无关', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }))
      .toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }))
  })

  it('补丁/快照模板字节级固定', () => {
    const patch = renderSync({
      kind: 'patch', fromVersion: 1, toVersion: 2,
      ops: [{ op: 'splice', path: 'tasks', id: 't-1', entity: task('t-1') }],
    })
    expect(patch).toBe('PATCH v1->v2 {"ops":[{"entity":{"id":"t-1","status":"open"},"id":"t-1","op":"splice","path":"tasks"}]}')
    const snap = renderSync({
      kind: 'snapshot', version: 7,
      nodes: [staticNode('页头'), logNode('feed', [{ e: 1 }])],
    })
    expect(snap).toBe('SNAPSHOT v7 {"nodes":[{"content":"页头","kind":"static"},{"entries":[{"e":1}],"kind":"log","path":"feed"}]}')
  })
})
