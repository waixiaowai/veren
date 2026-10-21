/**
 * 接线级测试：策略层经过真实装配路径（mountPage → MessageHost → 装配器）后，
 * 最终装配产物确实带上了 provider 缓存断点 / 被预算 remount。
 * Wiring-level tests: after the real assembly path (mountPage → MessageHost →
 * assembler), the assembled output really carries provider cache breakpoints /
 * was remounted on budget.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from '@veren/prompt-core'
import { anthropicPolicy, deepseekPolicy } from '@veren/prompt-host-messages'
import { definePage, mountPage } from '../src/index.ts'
import type { PageDefinition } from '../src/types.ts'

interface AppState {
  items: { id: string }[]
}

function makeStore(initial: AppState) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: AppState): void {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

const ListPage: PageDefinition<AppState> = definePage({
  name: 'list',
  url: '/task-list',
  description: '任务列表页',
  tree: (_params, state) => state.items.map((item) =>
    createElement('item', { key: item.id, path: 'tasks', value: item })),
})

/** 挂一个接了策略层的会话并完成一轮演化 / mount a policy-wired session and evolve once */
function mounted(policy = deepseekPolicy, budget?: { maxEntries: number }) {
  const store = makeStore({ items: [{ id: 'a' }] })
  const session = mountPage({
    page: ListPage,
    store,
    assembly: { systemPrompt: 'SYS', policy, budget },
  })
  return { store, session }
}

describe('session assembly wiring (mountPage + policy layer)', () => {
  it('anthropic：装配产物尾部块带 ephemeral 断点，chat 面去 provider 字段', () => {
    const { session } = mounted(anthropicPolicy)
    const assembled = session.assemble?.()
    expect(assembled).toBeDefined()
    expect(assembled?.remounted).toBe(false)
    expect(assembled?.chat[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(assembled?.chat.at(-1)?.role).toBe('user')
    expect(assembled?.chat.every((block) => !('cacheControl' in block))).toBe(true)
    expect(assembled?.blocks.at(-1)?.cacheControl).toBe('ephemeral') // 断点在块面 / breakpoint on the block face
    expect(assembled?.blocks[0]?.cacheControl).toBeUndefined() // 系统提示不加（消息级断点）
    expect(assembled?.text.length).toBeGreaterThan(0)
  })

  it('deepseek（未知 provider 的显式默认）：零断点、消息原样', () => {
    const { session } = mounted(deepseekPolicy)
    const assembled = session.assemble?.()
    expect(assembled?.blocks.every((block) => block.cacheControl === undefined)).toBe(true)
  })

  it('预算触顶 → 真实 remount：anchor 后回落全量快照基线', () => {
    const { store, session } = mounted(deepseekPolicy, { maxEntries: 2 })
    expect(session.assemble?.().remounted).toBe(false) // 首轮：初始基线快照，未触顶
    store.set({ items: [{ id: 'a' }, { id: 'b' }] }) // 第二轮：触发预算
    const assembled = session.assemble?.()
    expect(assembled?.remounted).toBe(true)
    expect(assembled?.text.startsWith('SNAPSHOT v')).toBe(true)
    expect(assembled?.text).toContain('"id":"b"') // 全量基线含新状态 / full baseline carries the new state
  })

  it('未给 assembly：无 assemble 方法（历史行为不变）', () => {
    const store = makeStore({ items: [{ id: 'a' }] })
    const session = mountPage({ page: ListPage, store })
    expect(session.assemble).toBeUndefined()
    expect(session.syncText()).toContain('"id":"a"')
  })
})
