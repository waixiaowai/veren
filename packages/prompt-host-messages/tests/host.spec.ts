import { describe, expect, it } from 'vitest'
import { MessageHost, renderSync } from '../src/index.ts'
import type { HostInstance } from '@veren/prompt-core'

function item(key: string, value: unknown): HostInstance {
  return { kind: 'item', key, props: { path: 'tasks', value } }
}

describe('MessageHost', () => {
  it('mount：静态块 + 集合 → 全量快照（不改历史，直接给基线）', () => {
    const host = new MessageHost()
    host.append({ kind: 'static', props: { content: '任务中心' } })
    host.append(item('t-1', { id: 't-1' }))
    host.flush()
    const sync = host.renderSince(undefined)
    expect(sync.kind).toBe('snapshot')
    expect(renderSync(sync)).toBe(
      'SNAPSHOT v1 {"nodes":[{"content":"任务中心","kind":"static"},{"items":[{"id":"t-1"}],"kind":"keyed","path":"tasks"}]}',
    )
  })

  it('增量：多次 flush 的 op 按 cursor 区间合并；字节稳定模板', () => {
    const host = new MessageHost()
    host.append(item('t-1', { id: 't-1' }))
    host.flush() // v1
    host.append(item('t-1', { id: 't-1', done: true })) // update → 新值重申
    host.append(item('t-2', { id: 't-2' }))
    host.flush() // v2
    const sync = host.renderSince(1)
    expect(sync.kind).toBe('patch')
    expect(renderSync(sync)).toBe(
      'PATCH v1->v2 {"ops":['
      + '{"entity":{"done":true,"id":"t-1"},"id":"t-1","op":"splice","path":"tasks"},'
      + '{"entity":{"id":"t-2"},"id":"t-2","op":"splice","path":"tasks"}]}',
    )
  })

  it('deletion：splice 无 entity，集合状态同步剔除并反映在快照', () => {
    const host = new MessageHost()
    host.append(item('t-1', { id: 't-1' }))
    host.flush()
    host.evict(item('t-1', undefined))
    host.flush()
    const snap = host.renderSince(999)
    expect(snap.kind).toBe('snapshot')
    if (snap.kind === 'snapshot') {
      const node = snap.nodes[0]
      expect(node.kind === 'keyed' && node.items).toEqual([])
    }
  })

  it('缺口过大/游标超前回落全量；压实后旧游标回落全量', () => {
    const host = new MessageHost({ maxPatchGap: 2 })
    for (let round = 0; round < 4; round++) {
      host.append(item(`t-${round}`, { id: `t-${round}` }))
      host.flush()
    }
    expect(host.renderSince(0).kind).toBe('snapshot') // 缺口 4 > 2
    expect(host.renderSince(99).kind).toBe('snapshot') // 超前
    expect(host.renderSince(undefined).kind).toBe('snapshot') // 无基线

    const anchored = new MessageHost({ compactEvery: 2 })
    anchored.append(item('t-0', { id: 't-0' }))
    anchored.flush()
    anchored.append(item('t-1', { id: 't-1' }))
    anchored.flush()
    anchored.append(item('t-2', { id: 't-2' }))
    anchored.flush() // 触发压实
    expect(anchored.renderSince(1).kind).toBe('snapshot')
  })

  it('data 块：set/remove op', () => {
    const host = new MessageHost()
    host.append({ kind: 'data', key: 'count', props: { path: 'stats.count', value: 2 } })
    host.flush()
    expect(renderSync(host.renderSince(0))).toBe(
      'PATCH v0->v1 {"ops":[{"op":"set","path":"stats.count","value":2}]}',
    )
  })
})
