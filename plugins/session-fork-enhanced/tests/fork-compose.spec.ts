/**
 * The fork composition layer with fake host services.
 *
 * Every step here turns an untrusted tool request into a child Session: the
 * boundary must name a real event, an explicit route must fail before a Session
 * is created when the adapter catalog refuses it, the preset must mount before
 * publication, and the workspace attach failure must be reported instead of
 * leaving a half-parented child.
 *
 * 用假宿主服务测试分叉组合层。
 *
 * 这里每一步都把不可信的工具请求变成一个子会话：边界必须指向真实事件；显式路由被适配器目录
 * 拒绝时必须在创建会话前失败；预设必须在发布前挂载；工作区附着失败必须上报，而不是留下一个
 * 半挂靠的子会话。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  composePreset,
  createForkAgent,
  forkValue,
  forkWorkspace,
  requestedRoute,
  resolveBoundary,
} from '../src/fork-compose.js'
import type { ForkPlan } from '../src/fork-compose.js'
import type { ForkRequest, ModelSelectionView } from '../src/types.js'

/** One minimal session event: the layer only reads `type` and `seq`. 最小会话事件：该层只读 type 与 seq。 */
function event(type: string, seq: number): SessionEvent {
  return { type, seq, time: 0, surfaceOp: 'append', data: {} } as unknown as SessionEvent
}

/** One source header with the fields the layer reads. 只带该层读取字段的源会话头。 */
function header(over: Partial<SessionHeader> = {}): SessionHeader {
  return { id: SessionId('source-1'), origin: 'user', ...over } as unknown as SessionHeader
}

/** One normalized fork request. 一份归一化后的分叉请求。 */
function request(over: Partial<ForkRequest> = {}): ForkRequest {
  return { sessionId: 'source-1', ...over } as ForkRequest
}

/** A plan with the fields the value/creation helpers read. 只带取值与创建辅助函数所读字段的计划。 */
function plan(over: Partial<ForkPlan> = {}): ForkPlan {
  return {
    selection: { provider: 'deepseek', model: 'v4-flash' } as ModelSelectionView,
    explicit: undefined,
    inherited: { provider: 'deepseek', model: 'v4-flash' } as ModelSelectionView,
    composition: {},
    workspace: undefined,
    seed: [],
    ...over,
  } as ForkPlan
}

describe('resolveBoundary / 解析边界', () => {
  const events = [event('turn/start', 0), event('turn/end', 1), event('turn/start', 2)]

  it('accepts an explicit seq that exists in the log', () => {
    expect(resolveBoundary(request({ atSeq: 2 }), events)).toBe(2)
  })

  it('refuses an explicit seq the log does not contain, naming the last one', () => {
    expect(() => resolveBoundary(request({ atSeq: 9 }), events)).toThrow(/event 9 does not exist.*last seq: 2/)
  })

  it('falls back to the latest completed-turn prefix', () => {
    expect(resolveBoundary(request(), events)).toBe(1)
  })

  it('refuses to fork a session with no completed turn', () => {
    expect(() => resolveBoundary(request(), [event('turn/start', 0)])).toThrow(/no completed turn/)
  })
})

describe('composePreset / 组合预设', () => {
  it('returns nothing when the deployment composes no roster and none was requested', async () => {
    await expect(composePreset(new Context(), undefined)).resolves.toEqual({})
  })

  it('refuses a requested preset when the deployment has no roster', async () => {
    await expect(composePreset(new Context(), 'writer')).rejects.toThrow(/composes no agent preset roster/)
  })

  it('resolves the preset and mounts it through the roster', async () => {
    const mount = vi.fn(async () => {})
    const ctx = new Context()
    ctx.provide('agentPresets', {
      resolve: async (id: string | undefined) => ({ id: id ?? 'default' }),
      mount,
    } as unknown as Context['agentPresets'])

    const composition = await composePreset(ctx, 'writer')
    expect(composition.agentPreset).toBe('writer')

    await composition.setup?.({} as never, {} as never)
    expect(mount).toHaveBeenCalledWith(expect.anything(), 'writer')
  })

  it('wraps a roster resolution failure in the tool diagnostic', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', {
      resolve: async () => { throw new Error('gone') },
      mount: async () => {},
    } as unknown as Context['agentPresets'])

    await expect(composePreset(ctx, 'writer')).rejects.toThrow(/agent preset "writer" could not be resolved.*gone/)
  })
})

describe('requestedRoute / 解析显式路由', () => {
  it('has no route when the caller named no provider', async () => {
    await expect(requestedRoute(new Context(), request())).resolves.toBeUndefined()
  })

  it('passes an explicit route through when no adapter catalog exists', async () => {
    await expect(requestedRoute(new Context(), request({
      provider: 'p',
      model: 'm',
      reasoningEffort: 'high' as never,
    }))).resolves.toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
  })

  it('normalizes the resolved route and stringifies its effort', async () => {
    const ctx = new Context()
    ctx.provide('llm', {
      resolveCallConfig: async () => ({ provider: 'resolved-p', model: 'resolved-m', reasoningEffort: 2 }),
    } as unknown as Context['llm'])

    await expect(requestedRoute(ctx, request({ provider: 'p', model: 'm' }))).resolves.toEqual({
      provider: 'resolved-p',
      model: 'resolved-m',
      reasoningEffort: '2',
    })
  })

  it('fails before creation when the adapter catalog refuses the route', async () => {
    const ctx = new Context()
    ctx.provide('llm', {
      resolveCallConfig: async () => { throw new Error('no such model') },
    } as unknown as Context['llm'])

    await expect(requestedRoute(ctx, request({ provider: 'p', model: 'm' })))
      .rejects.toThrow(/provider\/model route p\/m could not be resolved.*no such model/)
  })
})

describe('forkWorkspace / 查找源工作区', () => {
  it('has no workspace when the deployment has no registry', async () => {
    await expect(forkWorkspace(new Context(), header())).resolves.toBeUndefined()
  })

  it('finds the workspace that lists the source session', async () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      list: () => [{ id: 'ws-1', sessionIds: ['source-1'] }],
    } as unknown as Context['workspaceRegistry'])

    await expect(forkWorkspace(ctx, header())).resolves.toMatchObject({ id: 'ws-1' })
  })

  it('follows subagent lineage when the source itself is not attached', async () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      list: () => [{ id: 'ws-parent', sessionIds: ['parent-1'] }],
    } as unknown as Context['workspaceRegistry'])
    ctx.provide('sessionQuery', {
      traceSession: async () => ({ ancestors: [{ header: { id: 'parent-1' } }] }),
    } as unknown as Context['sessionQuery'])

    await expect(forkWorkspace(ctx, header({ origin: 'subagent' }))).resolves.toMatchObject({ id: 'ws-parent' })
  })

  it('has no workspace when no ancestor is attached either', async () => {
    const ctx = new Context()
    ctx.provide('workspaceRegistry', { list: () => [] } as unknown as Context['workspaceRegistry'])
    ctx.provide('sessionQuery', { traceSession: async () => ({ ancestors: [] }) } as unknown as Context['sessionQuery'])

    await expect(forkWorkspace(ctx, header({ origin: 'subagent' }))).resolves.toBeUndefined()
  })
})

describe('forkValue / 分叉返回值', () => {
  it('reports the child, source, boundary, and effective selection', () => {
    expect(forkValue(request(), 'child-1', 4, plan())).toEqual({
      sessionId: 'child-1',
      sourceSessionId: 'source-1',
      atSeq: 4,
      inheritedEventCount: 5,
      provider: 'deepseek',
      model: 'v4-flash',
    })
  })

  it('carries the preset and effort when they exist', () => {
    const value = forkValue(request(), 'child-1', 0, plan({
      selection: { provider: 'p', model: 'm', reasoningEffort: 'high' } as ModelSelectionView,
      composition: { agentPreset: 'writer' },
    }))

    expect(value).toMatchObject({ agentPreset: 'writer', reasoningEffort: 'high' })
  })
})

describe('createForkAgent / 创建子代理', () => {
  /** A context whose `agents.create` records its payload and returns a recording handle. 记录负载并返回记录句柄的上下文。 */
  function host(options: { attach?: () => Promise<void> } = {}) {
    const created: unknown[] = []
    const appended: unknown[] = []
    const create = vi.fn(async (payload: Record<string, unknown>) => {
      created.push(payload)
      return { agent: { session: { append: (_type: string, _data: unknown) => { appended.push(_data) } } } }
    })
    const ctx = new Context()
    ctx.provide('agents', { create } as unknown as Context['agents'])
    const workspace = { attachSession: vi.fn(options.attach ?? (async () => {})) }
    return { ctx, create, created, appended, workspace }
  }

  it('creates the child with the seed, inherited count, parent meta, and route', async () => {
    const { ctx, created } = host()

    await createForkAgent(ctx, SessionId('child-1'), header({ cwd: 'C:/work' }), 2, plan({
      composition: { agentPreset: 'writer' },
    }))

    const payload = created[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      sessionId: 'child-1',
      inheritedEventCount: 3,
      meta: { cwd: 'C:/work', parentSession: 'source-1', isSeeded: true, agentPreset: 'writer' },
      agentOptions: { provider: 'deepseek', model: 'v4-flash' },
    })
    expect(payload['seed']).toEqual([])
  })

  it('persists an explicit model intent that differs from the inherited one', async () => {
    const { ctx, appended } = host()
    const explicit = { provider: 'other', model: 'other-model' } as ModelSelectionView

    await createForkAgent(ctx, SessionId('child-1'), header(), 0, plan({ explicit }))

    expect(appended).toEqual([explicit])
  })

  it('does not append a selection that matches the inherited one', async () => {
    const { ctx, appended } = host()

    await createForkAgent(ctx, SessionId('child-1'), header(), 0, plan({
      explicit: { provider: 'deepseek', model: 'v4-flash' } as ModelSelectionView,
    }))

    expect(appended).toEqual([])
  })

  it('attaches the workspace and reports an attach failure', async () => {
    const { ctx, workspace } = host()
    await createForkAgent(ctx, SessionId('child-1'), header(), 0, plan({ workspace }))
    expect(workspace.attachSession).toHaveBeenCalledWith('child-1')

    const failing = host({ attach: async () => { throw new Error('no such workspace') } })
    await expect(createForkAgent(failing.ctx, SessionId('child-2'), header(), 0, plan({ workspace: failing.workspace })))
      .rejects.toThrow(/was forked but could not attach to its workspace.*no such workspace/)
  })
})