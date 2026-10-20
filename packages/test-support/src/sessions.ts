/**
 * 假会话端口 / 假 agent 作用域：每会话一个真实的 cordis 子上下文（isolate），
 * 页面工具挂进该作用域自己的工具表——与 AgentRegistry「每个 agent 独立 ctx」
 * 同机制、同注销器语义，足以断言「工具挂进了哪条会话、会话销毁后不可见」。
 * Fake session ports / fake agent scopes: each session gets a real cordis
 * child context (`isolate`) whose own tool table receives the page tools —
 * the same mechanism and disposer semantics as AgentRegistry's per-agent
 * contexts — enough to assert which session a tool landed in and that it
 * disappears once that session's agent is destroyed.
 *
 * @module @veren/test-support/sessions
 */
import { Context } from '@deepseek-ai/cordis'

/** 登记进工具表的对象的最小面（真实 ToolDefinition 结构兼容）。The minimal face of a registered tool (real ToolDefinitions fit). */
export interface RegisteredTool {
  readonly name: string
}

/**
 * 一张工具表：登记与注销成对，dispose 时逆序执行全部注销器。
 * One tool table: registration and disposal pair up; dispose runs every
 * disposer in reverse order.
 */
export class ToolTable {
  readonly #tools = new Map<string, RegisteredTool>()
  readonly #undos: Array<() => void> = []

  /** 登记一个工具，返回它的注销器。Register one tool and get its disposer back. */
  register(tool: RegisteredTool): () => void {
    this.#tools.set(tool.name, tool)
    const undo = (): void => { this.#tools.delete(tool.name) }
    this.#undos.push(undo)
    return undo
  }

  /** 已登记的工具名（注册顺序）。Registered tool names in registration order. */
  names(): string[] {
    return [...this.#tools.keys()]
  }

  /** 逆序执行全部注销器；之后表为空、可复用。Run all disposers reversed; the table ends empty and reusable. */
  dispose(): void {
    for (const undo of this.#undos.splice(0).reverse()) undo()
  }
}

/** followup 消息的最小面：测试只关心拼起来的文本。Minimal followup face: only the joined text matters in specs. */
export interface FollowupMessage {
  readonly content: ReadonlyArray<{ text?: string }>
}

/** 拼出 followup 文本 / join the followup text blocks */
function followupText(message: FollowupMessage): string {
  return message.content.map((block) => block.text ?? '').join('')
}

/** 一个 agent 作用域的观测面 / the observable face of one agent scope */
export interface AgentScopeView {
  /** 该作用域的 cordis 子上下文（工具经 ctx.tools.register 挂进来）。The scope's cordis child context (tools land via ctx.tools.register). */
  readonly ctx: Context
  /** 该会话收到的 followup 文本（按序）。Followup texts this session received, in order. */
  readonly followups: string[]
  /** 当前挂在本作用域里的工具名。Tool names currently visible in this scope. */
  toolNames(): string[]
}

interface ScopeRecord {
  readonly scopeCtx: Context
  readonly table: ToolTable
  readonly followups: string[]
}

/** 假会话端口：够页面运行时与断言使用的最小结构面。Fake session ports: the minimal structural face page runtimes and specs need. */
export interface FakeSessions {
  /** 让一个会话"活了"：建作用域、广播 agent/created。Bring one session alive: build its scope and broadcast agent/created. */
  startAgent(sessionId: string): AgentScopeView
  /** agent 销毁：作用域内登记逆序摘除，广播 agent/disposed。Destroy the agent: undo scope registrations reversed and broadcast agent/disposed. */
  stopAgent(sessionId: string): void
  /** 会话当前是否活着。Whether the session is currently alive. */
  isAlive(sessionId: string): boolean
  /** 摘掉全部作用域与根替身（每个作用域内部逆序）。Tear down every scope and the root stubs (each scope reversed inside). */
  dispose(): void
}

/**
 * 在 ctx 上安装假 sessions/agents/tools 端口。`agents.get` 只在会话活着时
 * 返回作用域视图，与真实注册表「会话销毁即不可见」的语义一致。
 * Install fake sessions/agents/tools ports on `ctx`. `agents.get` returns the
 * scope view only while the session is alive, matching the real registry's
 * "gone when the session dies" semantics.
 */
export function installFakeSessions(ctx: Context): FakeSessions {
  const sessions = new Map<string, { alive: boolean }>()
  const scopes = new Map<string, ScopeRecord>()
  const rootTools = new ToolTable()
  ctx.provide('tools', rootTools)
  ctx.provide('sessions', {
    get: (id: string) => (sessions.get(id)?.alive === true ? { id } : undefined),
    create: (id?: string) => {
      const key = id ?? crypto.randomUUID()
      sessions.set(key, { alive: true })
      return { id: key }
    },
    flush: () => true,
  })
  ctx.provide('agents', {
    get: (id: string) => agentView(scopes.get(id), id),
  })
  return {
    startAgent: (sessionId) => startScope(ctx, sessions, scopes, sessionId),
    stopAgent: (sessionId) => stopScope(ctx, sessions, scopes, sessionId),
    isAlive: (sessionId) => sessions.get(sessionId)?.alive === true,
    dispose: () => {
      for (const id of [...scopes.keys()].reverse()) stopScope(ctx, sessions, scopes, id)
      rootTools.dispose()
    },
  }
}

/** 活 agent 的结构面：作用域 ctx + 会话 + followup。The live-agent structural face: scope ctx + session + followup. */
function agentView(scope: ScopeRecord | undefined, id: string) {
  if (scope === undefined) return undefined
  return {
    ctx: scope.scopeCtx,
    session: { id },
    followup: (message: FollowupMessage) => { scope.followups.push(followupText(message)) },
  }
}

/** 建一个作用域（isolate('tools') + 独立工具表）并广播 agent/created。Build one scope (isolate('tools') + its own table) and broadcast agent/created. */
function startScope(
  ctx: Context,
  sessions: Map<string, { alive: boolean }>,
  scopes: Map<string, ScopeRecord>,
  sessionId: string,
): AgentScopeView {
  const scopeCtx = ctx.isolate('tools')
  const table = new ToolTable()
  scopeCtx.provide('tools', table)
  const followups: string[] = []
  scopes.set(sessionId, { scopeCtx, table, followups })
  sessions.set(sessionId, { alive: true })
  ctx.events.emit('agent/created', { agent: agentView(scopes.get(sessionId), sessionId) })
  return { ctx: scopeCtx, followups, toolNames: () => table.names() }
}

/** 销毁一个作用域：注销器逆序全执行，广播 agent/disposed。Destroy one scope: run every disposer reversed and broadcast agent/disposed. */
function stopScope(
  ctx: Context,
  sessions: Map<string, { alive: boolean }>,
  scopes: Map<string, ScopeRecord>,
  sessionId: string,
): void {
  const scope = scopes.get(sessionId)
  if (scope === undefined) return
  scope.table.dispose()
  scopes.delete(sessionId)
  const row = sessions.get(sessionId)
  if (row !== undefined) row.alive = false
  ctx.events.emit('agent/disposed', { agent: { session: { id: sessionId } } })
}
