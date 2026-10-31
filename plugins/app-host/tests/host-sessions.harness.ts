/**
 * 宿主会话替身 harness：最小 agents/sessions 结构面（live agent 表 +
 * agent/created、agent/disposed 事件），agent 作用域见 agent-scope.harness。
 * The host-session stub harness: the minimal agents/sessions structural faces
 * (the live agent table plus agent/created and agent/disposed events); agent
 * scopes live in agent-scope.harness.
 * @module tests/host-sessions.harness
 */
import { Context } from '@deepseek-ai/cordis'
import { agentCarrier } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { makeAgentScope } from './agent-scope.harness.ts'
import type { AgentScope } from './agent-scope.harness.ts'

/** 替身会话记录：页面运行时只读 header.agentPreset（presetOf 的同源字段）与 append
 * / stub session record: the runtime reads only header.agentPreset (presetOf's
 * source) and append */
interface StubSession {
  id: string
  header: { agentPreset: string }
  messages: string[]
  alive: boolean
  titles: Array<{ title: string; source: { kind: string } }>
  append(type: string, data: { title: string; source: { kind: string } }): void
}

/** 替身会话工厂：带上 append 与会话头（presetOf 的同源字段）/ stub session factory with append and the header (presetOf's source) */
function newSession(id: string): StubSession {
  const record: StubSession = {
    id, header: { agentPreset: 'standard' }, messages: [], alive: true, titles: [],
    append: (_type, data) => { record.titles.push(data) },
  }
  return record
}

/** 宿主替身的全部可断言状态 / every assertable piece of the host stub */
interface HostStubState {
  readonly sessions: Map<string, StubSession>
  readonly scopes: Map<string, AgentScope>
  readonly agentObjects: Map<string, Agent>
  readonly hostTools: Map<string, unknown>
  /** 记录 agents.create 的入参（页面会话 cwd 归属的断言面）/ records agents.create options */
  readonly agentCreations: Array<{ sessionId: string; cwd?: string }>
  /** 记录加入工作区的会话（attachSession 的断言面）/ records workspace attachments */
  readonly attached: Array<{ workspaceId: string; sessionId: string }>
  /** 页面身份注册面（断言面）/ the page-identity registration surface */
  readonly promptContexts: Array<{ name: string; order: number }>
  readonly emit: (event: string, payload: unknown) => void
  readonly defaultWorkspacePath: string
}

/**
 * 宿主工具表替身：register 按名入表、注销器按名出表——"注册必须发生"才能被
 * 断言；failTool 注入注册期抛错（装配中途失败的回滚用例）。
 * The host tool-table stub: register by name, disposers remove by name —
 * "registration must happen" becomes assertable; failTool injects a throw for
 * the mid-assembly-failure rollback cases.
 */
function provideHostTools(ctx: Context, hostTools: Map<string, unknown>, failTool?: string): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', {
    register: (tool: { name: string }) => {
      if (failTool !== undefined && tool.name === failTool) throw new Error(`boom registering ${tool.name}`)
      hostTools.set(tool.name, tool)
      return () => { hostTools.delete(tool.name) }
    },
  })
}

/**
 * 装配的 inject 声明 'skills'（页面级 skills 服务面）：根上给替身，agent 作用域
 * 另有按作用域分桶的替身（见 agent-scope.harness 的 provideScopeSkills）。
 * The assembly injects 'skills' (the page-scope skill service face): a root
 * stub, with per-scope stubs in the agent-scope harness.
 */
function provideHostSkillStub(ctx: Context): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', {
    register: () => () => undefined,
  })
}

/** 替身会话服务：get 只认活会话；create 入表 / the stub session service: get honors liveness; create records */
function provideHostSessions(ctx: Context, sessions: Map<string, StubSession>): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('sessions', {
    get: (id: string) => (sessions.get(id)?.alive === true ? sessions.get(id) : undefined),
    create: (id?: string) => {
      const key = id ?? crypto.randomUUID()
      const record = newSession(key)
      sessions.set(key, record)
      return record
    },
    flush: () => true,
  })
}

/** 部署默认模型替身 / the deployment default-model stub */
function provideHostModel(ctx: Context): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test', model: 'test-model' }),
  })
}

/**
 * 工作区注册表替身（页面会话的归属落点）：默认工作区 + 一个更新的工作区——
 * list() 按注册序（新的在前），默认工作区是最早创建的那条。
 * The workspace registry stub (the page session's membership home): a default
 * workspace plus a newer one — list() is registry order (newest first), so the
 * default is the oldest entry.
 */
function provideHostWorkspaces(ctx: Context, attached: Array<{ workspaceId: string; sessionId: string }>, defaultWorkspacePath: string): void {
  const makeWorkspace = (id: string, path: string) => ({
    id,
    path,
    sessionIds: [] as string[],
    attachSession: async (sessionId: string) => { attached.push({ workspaceId: id, sessionId }) },
  })
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('workspaceRegistry', {
    list: () => [makeWorkspace('ws-newer', 'C:\\fake-newer-workspace'), makeWorkspace('ws-default', defaultWorkspacePath)],
    initializeDefault: async () => makeWorkspace('ws-default', defaultWorkspacePath),
  })
}

/**
 * 页面身份系统提示的替身:记录注册进来的 context(断言面),disposer 逆序摘除。
 * Stub for the page-identity system prompt: records registered contexts (an
 * assertion surface); the disposer removes them again.
 */
function provideSystemPromptStub(ctx: Context, promptContexts: Array<{ name: string; order: number }>): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('systemPrompt', {
    context: (c: { name: string; order: number }) => {
      promptContexts.push({ name: c.name, order: c.order })
      return () => {
        const at = promptContexts.findIndex(p => p.name === c.name)
        if (at >= 0) promptContexts.splice(at, 1)
      }
    },
  })
}

/** 建宿主替身状态并挂上除 agents 外的全部服务 / build the stub state, providing every service except agents */
function createHostStubState(ctx: Context, failTool?: string): HostStubState {
  const state = {
    sessions: new Map<string, StubSession>(),
    scopes: new Map<string, AgentScope>(),
    agentObjects: new Map<string, Agent>(),
    hostTools: new Map<string, unknown>(),
    agentCreations: [] as Array<{ sessionId: string; cwd?: string }>,
    attached: [] as Array<{ workspaceId: string; sessionId: string }>,
    promptContexts: [] as Array<{ name: string; order: number }>,
    emit: ctx.emit as unknown as (event: string, payload: unknown) => void,
    defaultWorkspacePath: 'C:\\fake-default-workspace',
  } as const
  provideHostTools(ctx, state.hostTools, failTool)
  provideHostSkillStub(ctx)
  provideHostSessions(ctx, state.sessions)
  provideHostModel(ctx)
  provideHostWorkspaces(ctx, state.attached, state.defaultWorkspacePath)
  provideSystemPromptStub(ctx, state.promptContexts)
  return state
}

/** 活 agent 面：会话活着才返回稳定 agent 对象（它同时是 createScope 的 tag） */
function agentViewOf(state: HostStubState, id: string): Agent | undefined {
  if (state.sessions.get(id)?.alive !== true) return undefined
  return state.agentObjects.get(id)
}

/**
 * 造 agent + 作用域并挂接（create 与 resume 共用）：同一个对象既是 agent 又是
 * createScope 的 tag——agentEvents 的 carrier key 与作用域标签一致，事件过滤才是
 * 真的。
 * Spawn an agent + scope and wire them (shared by create/resume): one object is
 * both the agent and the createScope tag — the agentEvents carrier key equals
 * the scope tag, so filtering is real.
 */
function spawnAgent(ctx: Context, state: HostStubState, id: string): Agent {
  const session = state.sessions.get(id) ?? newSession(id)
  state.sessions.set(id, session)
  const agent = {
    id,
    session,
    followup: (m: { content: Array<{ text?: string }> }) => {
      state.scopes.get(id)?.followups.push(m.content.map((block) => block.text ?? '').join(''))
    },
  } as unknown as Agent
  const scope = makeAgentScope(ctx, agent)
  ;(agent as { ctx: Context }).ctx = scope.ctx
  state.scopes.set(id, scope)
  state.agentObjects.set(id, agent)
  return agent
}

/**
 * H 后的创建面：agents.create 连同创建会话并发布 agent/created（打开即激活）。
 * The post-H create face: agents.create also creates the session and publishes
 * agent/created (activated at open).
 */
function provideAgentService(ctx: Context, state: HostStubState): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', {
    get: (id: string) => agentViewOf(state, id),
    create: async (options: { sessionId: string; meta?: { cwd?: string } }) => {
      const id = options.sessionId
      state.agentCreations.push({ sessionId: id, ...(options.meta?.cwd === undefined ? {} : { cwd: options.meta.cwd }) })
      const agent = spawnAgent(ctx, state, id)
      state.emit('agent/created', { agent })
      return {
        agent,
        dispose: async () => {
          state.scopes.get(id)?.disposeAll()
          state.scopes.delete(id)
          state.agentObjects.delete(id)
          const current = state.sessions.get(id)
          if (current !== undefined) current.alive = false
          state.emit('agent/disposed', { agent: { session: { id } } })
        },
      }
    },
  })
}

/** agent 销毁：作用域注销器全部执行（真实 cordis 语义）+ 广播 agent/disposed */
function stopAgentStub(state: HostStubState, id: string): void {
  state.scopes.get(id)?.disposeAll()
  state.scopes.delete(id)
  state.agentObjects.delete(id)
  state.emit('agent/disposed', { agent: { session: { id } } })
}

/**
 * 重启后再激活（真实宿主的 resume 派发形态）：agent/created 经 agentCarrier
 * （scopeTarget 载体）serial 派发，agent 带跨域 baseFilter——真实 Agent 是
 * Service，其 isolate 过滤会把根域监听器全部排除；裸 emit 永远测不到这条
 * 排除路径（真机 2.0.8 反例：重挂与身份零触发、单测却全绿）。
 * Re-activation after a restart (the real host's resume dispatch shape):
 * agent/created dispatches serially through agentCarrier (a scopeTarget
 * carrier) with the agent carrying a cross-realm baseFilter — the real Agent
 * is a Service whose isolate filter excludes every root-realm listener; a bare
 * emit can never exercise this exclusion path (live 2.0.8 counter-example:
 * zero remount/identity firings while unit tests stayed green).
 */
async function resumeAgentViaCarrier(ctx: Context, state: HostStubState, id: string): Promise<Agent> {
  const agent = spawnAgent(ctx, state, id)
  // 跨域服务替身：baseFilter 恒 false = 任何作用域标签的监听器都被排除，
  // 只有 { global: true } 的监听器能收到这次派发。
  // Cross-realm service stand-in: an always-false baseFilter excludes every
  // scope-tagged listener; only a { global: true } listener receives this.
  ;(agent as unknown as Record<symbol, unknown>)[Context.filter] = () => false
  await (ctx.serial as unknown as (carrier: Context, event: string, payload: unknown) => Promise<void>)(
    agentCarrier(agent) as unknown as Context, 'agent/created', { agent })
  return agent
}

/**
 * 最小 agents/sessions 结构面：live agent 表 + agent/created、agent/disposed 事件。
 * 失败注入（failTool）供"装配中途失败"回滚用例使用。
 * The minimal agents/sessions structural faces: the live agent table plus the
 * agent/created and agent/disposed events. The failTool injection serves the
 * mid-assembly-failure rollback cases.
 */
export function makeHostSessions(ctx: Context, failTool?: string) {
  const state = createHostStubState(ctx, failTool)
  provideAgentService(ctx, state)
  return {
    sessions: state.sessions,
    scopes: state.scopes,
    hostTools: state.hostTools,
    agentCreations: state.agentCreations,
    attached: state.attached,
    defaultWorkspacePath: state.defaultWorkspacePath,
    /** 页面身份注册面（断言面）/ the page-identity registration surface */
    promptContexts: state.promptContexts,
    /** 该会话的稳定 agent 对象（也是作用域 tag）；agent 未创建 → undefined */
    agentOf(id: string): Agent | undefined { return state.agentObjects.get(id) },
    /** agent 销毁：作用域注销器全部执行 + 广播 agent/disposed / dispose the scope + broadcast agent/disposed */
    stopAgent(id: string): void { stopAgentStub(state, id) },
    /** 重启后再激活（scopeTarget 载体 + 跨域 baseFilter，见 resumeAgentViaCarrier）*/
    resumeAgentFiltered(id: string): Promise<Agent> { return resumeAgentViaCarrier(ctx, state, id) },
  }
}
