// 插件入口的组合测试：工具注册的 dispose/HMR 安全，以及分叉主流程。
// Composition tests for the plugin entry: dispose/HMR safety of the tool
// registration, plus the main fork flow.
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply, forkWithOptions } from '../src/index.js'

/** 构造最小事件夹具。Build a minimal event fixture. */
function event(type: string, seq: number, data: unknown = {}): SessionEvent {
  return { type, seq, time: 0, surfaceOp: 'append', data } as unknown as SessionEvent
}

interface Effect {
  readonly label: string
  readonly dispose: () => void
}

/** 记录 effect 与工具注册的假 ctx：dispose 后注册表必须回到空。
 * A fake ctx recording effects and tool registrations: after dispose the
 * registry must be empty again. */
function fakeCtx(events: readonly SessionEvent[] = []) {
  const tools = new Map<string, unknown>()
  const effects: Effect[] = []
  const created: Array<Record<string, unknown>> = []
  const selections: unknown[] = []
  const ctx = {
    effect(factory: () => () => void, label: string) {
      effects.push({ label, dispose: factory() })
    },
    get(service: string) {
      if (service === 'agentPresets' || service === 'llm' || service === 'workspaceRegistry') return undefined
      throw new Error(`unexpected service lookup: ${service}`)
    },
    tools: { register: (definition: { name: string }) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    sessionQuery: {
      observeSession: async () => ({
        header: { id: 'session-src', cwd: '/tmp' },
        events,
        projections: undefined,
        [Symbol.dispose]: () => {},
      }),
    },
    agents: {
      create: async (options: Record<string, unknown>) => {
        created.push(options)
        return { agent: { session: { append: (type: string, data: unknown) => selections.push({ type, data }) } } }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'dp', model: 'dm' }) },
  }
  return { ctx: ctx as never, tools, effects, created, selections }
}

/** 已完成轮次的最小日志。A minimal log with one completed turn. */
const COMPLETED = [
  event('turn/start', 0, { turn: 0 }),
  event('turn/end', 1, { turn: 0 }),
]

describe('apply（注册与 dispose / registration and disposal）', () => {
  it('注册一个工具，dispose 后注册表为空（HMR 安全）/ registers one tool and empties the registry after dispose', () => {
    const { ctx, tools, effects } = fakeCtx(COMPLETED)
    apply(ctx, {})
    expect(tools.has('session_fork_with_options')).toBe(true)
    expect(effects).toHaveLength(1)
    // 逆序清理约定：卸载所有 effect 后不得残留注册项。
    // Reverse-order cleanup contract: no registration may survive disposing
    // every effect.
    for (const effect of [...effects].reverse()) effect.dispose()
    expect(tools.size).toBe(0)
  })
})

describe('forkWithOptions（分叉主流程 / the main fork flow）', () => {
  it('继承默认模型时不追加 model/selection / inherits the default model without a selection event', async () => {
    const { ctx, created, selections } = fakeCtx(COMPLETED)
    const value = await forkWithOptions(ctx, { sessionId: 'session-src' })
    expect(value).toMatchObject({ sourceSessionId: 'session-src', atSeq: 1, inheritedEventCount: 2, provider: 'dp', model: 'dm' })
    expect(created[0]).toMatchObject({ inheritedEventCount: 2, meta: { parentSession: 'session-src', isSeeded: true } })
    expect(created[0].seed).toHaveLength(3)
    expect(selections).toHaveLength(0)
  })

  it('显式模型覆盖路由并持久化 model/selection / an explicit model overrides the route and is persisted', async () => {
    const { ctx, created, selections } = fakeCtx(COMPLETED)
    const value = await forkWithOptions(ctx, { sessionId: 'session-src', provider: 'pp', model: 'pm', reasoningEffort: 'high' })
    expect(value).toMatchObject({ provider: 'pp', model: 'pm', reasoningEffort: 'high' })
    expect(created[0].agentOptions).toEqual({ provider: 'pp', model: 'pm', reasoningEffort: 'high' })
    expect(selections).toEqual([{ type: 'model/selection', data: { provider: 'pp', model: 'pm', reasoningEffort: 'high' } }])
  })

  it('源会话不存在时报错 / reports a missing source session', async () => {
    const { ctx } = fakeCtx(COMPLETED)
    ;(ctx as unknown as { sessionQuery: { observeSession: () => Promise<never> } }).sessionQuery.observeSession =
      async () => { throw Object.assign(new Error('not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' }) }
    await expect(forkWithOptions(ctx, { sessionId: 'session-nope' })).rejects.toThrow(/not found/)
  })

  it('没有已完成轮次时拒绝分叉 / refuses to fork without a completed turn', async () => {
    const { ctx } = fakeCtx([event('turn/start', 0, { turn: 0 })])
    await expect(forkWithOptions(ctx, { sessionId: 'session-src' })).rejects.toThrow(/no completed turn/)
  })
})
