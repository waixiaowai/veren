import { describe, expect, it } from 'vitest'
import { canonicalJson, createElement, memo } from '../src/element.ts'
import { reconcileChildren } from '../src/reconciler.ts'
import type { Effect, Fiber, PromptElement } from '../src/types.ts'

function hostFiber(kind: string, key?: string, props: Record<string, unknown> = {}): Fiber {
  return { type: kind, key, props, tag: 'host', child: null, sibling: null, parent: null, instance: { kind, key, props } }
}

function run(prevFirst: Fiber | null, elements: PromptElement[]): { first: Fiber | null; effects: Effect[] } {
  const parent: Fiber = { type: '⌂', tag: 'component', props: {}, child: null, sibling: null, parent: null }
  const effects: Effect[] = []
  const first = reconcileChildren(parent, prevFirst, elements, 'sync', effects)
  return { first, effects }
}

describe('reconciler', () => {
  it('首次挂载全部产出 placement', () => {
    const { effects } = run(null, [
      createElement('static', { content: 'A' }),
      createElement('static', { content: 'B' }),
    ])
    expect(effects.map((effect) => effect.tag)).toEqual(['placement', 'placement'])
  })

  it('keyed：新增/更新/删除 → placement/update/deletion；重排零 effect', () => {
    const t1 = createElement('item', { key: 't-1', path: 'tasks', value: { id: 't-1', v: 1 } })
    const t2 = createElement('item', { key: 't-2', path: 'tasks', value: { id: 't-2' } })
    const first = run(null, [t1, t2]).first

    // 重排：零 effect
    expect(run(first, [t2, t1]).effects).toEqual([])

    // 更新 t-1 + 新增 t-3 + 删除 t-2
    const t1b = createElement('item', { key: 't-1', path: 'tasks', value: { id: 't-1', v: 2 } })
    const t3 = createElement('item', { key: 't-3', path: 'tasks', value: { id: 't-3' } })
    const tags = run(first, [t1b, t3]).effects.map((effect) => effect.tag)
    expect(tags).toContain('update')
    expect(tags).toContain('placement')
    expect(tags).toContain('deletion')
  })

  it('memo：props canonical 相等 → 整棵子树零 effect', () => {
    const Inner = memo((props: { v: number }) => [createElement('static', { content: `v=${props.v}` })])
    const first = run(null, [createElement(Inner, { v: 1 })]).first
    expect(run(first, [createElement(Inner, { v: 1 })]).effects).toEqual([])
    const tags = run(first, [createElement(Inner, { v: 2 })]).effects.map((effect) => effect.tag)
    expect(tags).toEqual(['update'])
  })

  it('组件嵌套：父组件展开子元素并递归对账', () => {
    const List = (props: { ids: string[] }) =>
      props.ids.map((id) => createElement('item', { key: id, path: 'x', value: id }))
    const first = run(null, [createElement(List, { ids: ['a', 'b'] })]).first
    expect(first?.type).toBe(List)
    expect(first?.child?.sibling?.instance?.key).toBe('b')
    // a 的 props 未变 → 零 effect；b 删除；c 新增
    const tags = run(first, [createElement(List, { ids: ['a', 'c'] })]).effects.map((effect) => effect.tag)
    expect(tags).toEqual(['placement', 'deletion'])
  })
})

describe('canonicalJson', () => {
  it('键序与构造顺序无关', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3] } })).toBe(canonicalJson({ a: { c: [3], d: 2 }, b: 1 }))
  })
})
