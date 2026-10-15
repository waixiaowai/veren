// workspace_session_list 行为测试：走真实 cordis Context 注册工具体，数据源
// （workspaceRegistry / sessions / sessionProjections / sessionQuery）用假实现，
// 锁定过滤矩阵、归档三态、limit 语义与排序。
// workspace_session_list behavior tests: the real cordis Context registers the
// tool body while the data sources (workspaceRegistry / sessions /
// sessionProjections / sessionQuery) are fakes, locking the filter matrix, the
// archive tri-state, limit semantics, and ordering.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'
import { resolveConfig } from './support.js'

/** 被注册工具定义的最小执行面（测试只走 execute）。 */
/** The minimal execution face of a registered tool (tests drive execute only). */
interface RegisteredTool {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 列表结果的形状。The list-result shape used by assertions. */
interface ListResult {
  total: number
  sessions: Array<{ sessionId: string, provider?: string, model?: string, agentPreset?: string, archived: boolean }>
}

/** 假工作区：账目里放活跃、冷、已归档三个会话。Fake workspace: live, cold, archived sessions accounted. */
const WORKSPACE_ID = 'ws-1'

function fakeRegistry() {
  return {
    archivedSessionIds: ['s-archived'],
    get(id: string) {
      if (id !== WORKSPACE_ID) return undefined
      return { id, sessionIds: ['s-live', 's-cold', 's-archived'] }
    },
  }
}

/** 假活跃会话：preset 'writer'，投影路由 deepseek/chat。Fake attached session: preset 'writer', projected route deepseek/chat. */
function fakeSession() {
  return { header: { id: 's-live', createdAt: 100, agentPreset: 'writer' } }
}

/** 安装真实 apply 与假数据源，返回执行入口。Install the real apply with fake data sources; return the runner. */
async function install(overrides: Partial<ConfigShape> = {}) {
  const ctx = new Context()
  const definitions = new Map<string, RegisteredTool>()
  ctx.provide('tools', {
    register: (definition: { name: string } & RegisteredTool) => {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  })
  ctx.provide('workspaceRegistry', fakeRegistry())
  ctx.provide('sessions', { get: (id: string) => id === 's-live' ? fakeSession() : undefined })
  ctx.provide('sessionProjections', {
    // 只有活跃会话带投影状态：lastUsed 即最近一次请求实际使用的路由。
    // Only the attached session holds projection state: lastUsed is the route
    // the latest request actually used.
    stateOf: (_session: unknown, key: string) =>
      key === 'modelSelection' ? { lastUsed: { provider: 'deepseek', model: 'chat' } } : undefined,
  })
  ctx.provide('sessionQuery', {
    readSession: async (id: string) => id === 's-cold'
      ? {
          session: { createdAt: 200, agentPreset: 'coder' },
          events: [{ type: 'model/selection', data: { provider: 'openai', model: 'gpt' } }],
        }
      : {
          session: { createdAt: 50, agentPreset: 'writer' },
          events: [],
        },
    readTitle: async (id: string) => ({ title: id === 's-cold' ? 'Cold work' : 'Archived work' }),
  })
  const fiber: Fiber = ctx.plugin({ name, inject, apply }, resolveConfig(overrides))
  await fiber
  return {
    run: async (tool: string, args: unknown): Promise<ListResult> =>
      await (definitions.get(tool) as RegisteredTool).execute(args, {}) as ListResult,
    registered: (): string[] => [...definitions.keys()].sort(),
  }
}

describe('workspace_session_list（条件检索 / conditional search）', () => {
  it('defaults to unarchived sessions, newest first', async () => {
    const env = await install()
    const result = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID })
    expect(result.total).toBe(2)
    expect(result.sessions.map(entry => entry.sessionId)).toEqual(['s-cold', 's-live'])
    expect(result.sessions[0]).toMatchObject({ provider: 'openai', model: 'gpt', agentPreset: 'coder' })
    expect(result.sessions[1]).toMatchObject({ provider: 'deepseek', model: 'chat', agentPreset: 'writer' })
  })

  it('serves the archive tri-state', async () => {
    const env = await install()
    const only = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, archived: 'only' })
    expect(only.total).toBe(1)
    expect(only.sessions[0]).toMatchObject({ sessionId: 's-archived', archived: true })
    const include = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, archived: 'include' })
    expect(include.total).toBe(3)
  })

  it('filters by agentPreset, provider, and model exactly', async () => {
    const env = await install()
    const preset = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, agentPreset: 'coder' })
    expect(preset.sessions.map(entry => entry.sessionId)).toEqual(['s-cold'])
    const provider = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, provider: 'deepseek' })
    expect(provider.sessions.map(entry => entry.sessionId)).toEqual(['s-live'])
    const model = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, model: 'gpt' })
    expect(model.sessions.map(entry => entry.sessionId)).toEqual(['s-cold'])
    const miss = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, model: 'nope' })
    expect(miss.total).toBe(0)
  })

  it('truncates with the pre-truncation total and rejects invalid limits', async () => {
    const env = await install()
    const truncated = await env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, limit: 1 })
    expect(truncated.total).toBe(2)
    expect(truncated.sessions).toHaveLength(1)
    await expect(env.run('workspace_session_list', { workspaceId: WORKSPACE_ID, limit: 0 }))
      .rejects.toMatchObject({ code: 'WORKSPACE_LIST_LIMIT_INVALID' })
    const capped = await install({ maxListSessions: 1 })
    await expect(capped.run('workspace_session_list', { workspaceId: WORKSPACE_ID, limit: 2 }))
      .rejects.toMatchObject({ code: 'WORKSPACE_LIST_LIMIT_INVALID' })
  })

  it('reports a missing workspace and omits the tool when disabled', async () => {
    const env = await install()
    await expect(env.run('workspace_session_list', { workspaceId: 'ws-x' }))
      .rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })
    const disabled = await install({ allowListSessions: false })
    expect(disabled.registered()).not.toContain('workspace_session_list')
  })
})
