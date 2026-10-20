import { describe, expect, it } from 'vitest'
import { createElement, memo } from '../src/element.ts'
import { bindStore, commitEffects, createRoot, flushBackground, scheduleRender } from '../src/schedule.ts'
import type { Effect, PromptHost } from '../src/types.ts'

class RecordingHost implements PromptHost {
  readonly ops: string[] = []
  flushCount = 0
  append(instance: { kind: string; props: Record<string, unknown> }): void {
    this.ops.push(`append:${instance.kind}:${String(instance.props.content ?? instance.props.value)}`)
  }
  flush(): void {
    this.flushCount++
  }
}

describe('schedule', () => {
  it('两阶段：commit 逐 effect 调宿主，收尾 flush 一次', () => {
    const host = new RecordingHost()
    const root = createRoot(host)
    scheduleRender(root, [createElement('static', { content: 'A' }), createElement('static', { content: 'B' })])
    expect(host.ops).toEqual(['append:static:A', 'append:static:B'])
    expect(host.flushCount).toBe(1)
    scheduleRender(root, [createElement('static', { content: 'A' })]) // 无变化
    expect(host.flushCount).toBe(2) // 空 commit 也 flush（合批边界）
    expect(host.ops).toHaveLength(2)
  })

  it('background lane 先缓冲，sync commit 时随批落盘', () => {
    const host = new RecordingHost()
    const root = createRoot(host)
    scheduleRender(root, [createElement('static', { content: 'bg' })], 'background')
    expect(host.ops).toEqual([]) // 未落盘
    flushBackground(root)
    expect(host.ops).toEqual(['append:static:bg'])
    expect(root.pending).toHaveLength(0)
  })

  it('commitEffects：update 走 revise，deletion 走 evict', () => {
    const revised: unknown[] = []
    const evicted: unknown[] = []
    const host: PromptHost = {
      append: () => undefined,
      revise: (prev, next) => revised.push([prev, next]),
      evict: (instance) => evicted.push(instance),
    }
    const effects: Effect[] = [
      { tag: 'update', instance: { kind: 'a', props: {} }, prevInstance: { kind: 'a', props: {} }, lane: 'sync' },
      { tag: 'deletion', instance: { kind: 'a', props: {} }, lane: 'sync' },
    ]
    commitEffects(host, effects)
    expect(revised).toHaveLength(1)
    expect(evicted).toHaveLength(1)
  })
})

describe('bindStore', () => {
  it('状态变化 → 重渲染 → 提交；取消订阅后不再渲染', () => {
    const host = new RecordingHost()
    const root = createRoot(host)
    const listeners = new Set<() => void>()
    const store = {
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      getState: () => ({ items: ['a'] }),
    }
    const Page = memo((props: { items: string[] }) => props.items.map((id) => createElement('item', { key: id, value: id })))
    const unbind = bindStore(root, store, (state) => [createElement(Page, state)])

    // 初始挂载
    store.getState = () => ({ items: ['a'] })
    scheduleRender(root, [createElement(Page, store.getState())])
    expect(host.ops).toEqual(['append:item:a'])
    host.ops.length = 0

    for (const fn of listeners) fn() // 内容没变 → memo bailout → 零追加
    expect(host.ops).toEqual([])

    store.getState = () => ({ items: ['a', 'b'] })
    for (const fn of listeners) fn()
    expect(host.ops).toEqual(['append:item:b'])

    unbind()
    expect(listeners.size).toBe(0)
  })
})