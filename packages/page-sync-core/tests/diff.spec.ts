import { describe, expect, it } from 'vitest'
import { diffKeyed, diffNodes } from '../src/diff.ts'
import type { Entity } from '../src/types.ts'

function item(id: string, extra: Record<string, unknown> = {}): Entity {
  return { id, ...extra }
}

describe('diffKeyed', () => {
  it('新增/更新/删除 → splice 带/不带 entity', () => {
    const prev = [item('a'), item('b', { v: 1 }), item('c')]
    const next = [item('a'), item('b', { v: 2 }), item('d')]
    expect(diffKeyed('list', prev, next)).toEqual([
      { op: 'splice', path: 'list', id: 'b', entity: item('b', { v: 2 }) },
      { op: 'splice', path: 'list', id: 'd', entity: item('d') },
      { op: 'splice', path: 'list', id: 'c' },
    ])
  })

  it('重排零 op；1000 条改 2 条恰好 2 op', () => {
    expect(diffKeyed('l', [item('a'), item('b')], [item('b'), item('a')])).toEqual([])
    const big = Array.from({ length: 1000 }, (_, i) => item(`t-${i}`))
    const next = big.map((x) => ({ ...x }))
    next[204] = { ...next[204], v: 1 }
    next[817] = { ...next[817], v: 1 }
    expect(diffKeyed('l', big, next)).toHaveLength(2)
  })
})

describe('diffNodes', () => {
  it('field：值不等产 set，相等产空', () => {
    expect(diffNodes({ kind: 'field', path: 'a', value: 1 }, { kind: 'field', path: 'a', value: 2 }))
      .toEqual([{ op: 'set', path: 'a', value: 2 }])
    expect(diffNodes({ kind: 'field', path: 'a', value: 1 }, { kind: 'field', path: 'a', value: 1 })).toEqual([])
  })

  it('类型变更 = 销毁重建（set 整棵子树）', () => {
    const ops = diffNodes({ kind: 'field', path: 'x', value: 1 }, { kind: 'keyed', path: 'x', items: [item('a')] })
    expect(ops).toEqual([{ op: 'set', path: 'x', value: [item('a')] }])
  })

  it('log：追加产 append，前缀断裂产 set', () => {
    const prev = { kind: 'log', path: 'l', entries: [1, 2] }
    expect(diffNodes(prev, { kind: 'log', path: 'l', entries: [1, 2, 3] }))
      .toEqual([{ op: 'append', path: 'l', entries: [3] }])
    expect(diffNodes(prev, { kind: 'log', path: 'l', entries: [9, 2, 3] }))
      .toEqual([{ op: 'set', path: 'l', value: [9, 2, 3] }])
  })

  it('group：递归按 path 对位；引用相等 bail out；子节点删除产 remove', () => {
    const child = { kind: 'field' as const, path: 'c', value: 1 }
    expect(diffNodes({ kind: 'group', path: 'g', children: [child] }, { kind: 'group', path: 'g', children: [child] }))
      .toEqual([]) // 引用相等
    const ops = diffNodes(
      { kind: 'group', path: 'g', children: [child, { kind: 'field', path: 'd', value: 1 }] },
      { kind: 'group', path: 'g', children: [{ kind: 'field', path: 'c', value: 2 }] },
    )
    expect(ops).toEqual([
      { op: 'set', path: 'c', value: 2 },
      { op: 'remove', path: 'd' },
    ])
  })

  it('static 永不产 op', () => {
    expect(diffNodes({ kind: 'static', content: 'a' }, { kind: 'static', content: 'b' })).toEqual([])
  })
})
