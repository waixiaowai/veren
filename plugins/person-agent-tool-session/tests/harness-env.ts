// 结算测试环境：真实 cordis Context + 真实 dsh-scope 作用域，只有外部服务是假实现。
// 关键点是 agent.ctx 必须是真实作用域上下文：看守挂在它上面，事件路由因此由
// dsh-scope 承担，构建器自己不做任何 sessionId 比对。
// The settlement test environment: a real cordis Context and a real dsh-scope
// scope; only external services are faked. The load-bearing detail is that
// `agent.ctx` must be a real scoped context: the guard registers there, so
// dsh-scope owns event routing and the builder performs no sessionId comparison.
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildSessionDispatchDefinition, createSettlementWatch } from '../src/index.js'
import { createFakeAgent } from './harness-fake-agent.js'
import type { FakeAgent } from './harness-fake-agent.js'

/** 工具定义的最小执行面（测试只走 execute）。 */
/** The minimal execution face of a registered tool (tests drive execute only). */
export interface RegisteredTool {
  readonly name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 测试只走 execute：收窄到最小执行面（唯一的断言点，宿主 exec 由假对象顶替）。 */
/** Tests drive execute only: narrow to the minimal face (the single assertion point; an empty object stands in for the host exec). */
function drivable(definition: ToolDefinition): RegisteredTool {
  return definition as unknown as RegisteredTool
}

/** 装好的结算测试环境。The installed settlement test environment. */
export interface Env {
  readonly definitions: Map<string, RegisteredTool>
  readonly warnings: string[]
  readonly flushes: string[]
  readonly agents: Map<string, FakeAgent>
  readonly created: Record<string, unknown>[]
  readonly rootStatusEvents: string[]
  /**
   * flush 前回调，用来注入竞态：例如 flush 期间目标又落了一条事件。
   * Hooks run before each flush, so a test can inject a race such as an event
   * landing while the flush is in flight.
   */
  readonly flushHooks: ((sessionId: string) => void)[]
  /** 收到的生命周期事件，按发出顺序。The lifecycle events received, in emission order. */
  readonly runEvents: { readonly name: string, readonly payload: unknown }[]
  /** 让 `ctx.tools.get(name)` 能找到一个工具（检查可见性用）。Make `ctx.tools.get(name)` resolve. */
  readonly addTool: (name: string) => void
  addAgent: (id: string, parentSession?: string) => FakeAgent
  run: (tool: string, args: unknown, exec: unknown) => Promise<unknown>
  unload: () => Promise<void>
}

/**
 * 用真实 Context 安装构建器与结算看守（unload 结清全部看守，与页面视图销毁同语义）。
 * Install the builder and the settlement watch with a real Context (unload
 * settles every watch — the same semantics as a page view's teardown).
 * @param config - 看守配置（字符/并发上限）。Watch bounds (character / concurrency caps).
 * @returns 测试环境。The test environment.
 */
export async function install(config: { maxReportChars?: number, maxConcurrentWatches?: number } = {}): Promise<Env> {
  const ctx = new Context()
  const definitions = new Map<string, RegisteredTool>()
  const warnings: string[] = []
  const flushes: string[] = []
  const agents = new Map<string, FakeAgent>()
  const sessions = new Map<string, { id: string }>()
  const created: Record<string, unknown>[] = []
  const rootStatusEvents: string[] = []

  const addAgent = (id: string, parentSession?: string): FakeAgent => {
    const agent = createFakeAgent(ctx, id, parentSession)
    agents.set(id, agent)
    sessions.set(id, agent.session)
    return agent
  }

  const visibleTools = new Set<string>()
  ctx.provide('tools', {
    // 与宿主一致：register 返回精确卸载函数，供 cordis effect 逆序清理。
    // Host contract: register returns the exact disposer for reverse-order cleanup.
    register: (definition: RegisteredTool) => {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
    get: (name: string) => (visibleTools.has(name) ? {} : undefined),
  })
  ctx.provide('agents', { get: (id: string) => agents.get(id) })
  const flushHooks: ((sessionId: string) => void)[] = []
  ctx.provide('sessions', {
    get: (id: string) => sessions.get(id),
    flush: async (session: { id: string }) => {
      for (const hook of flushHooks) hook(session.id)
      flushes.push(session.id)
      return true
    },
  })
  ctx.provide('sessionController', {
    resolveAgent: async (id: string) => {
      const agent = agents.get(id)
      return agent === undefined ? { error: new Error(`session "${id}" not found`) } : { agent }
    },
    create: async (request: Record<string, unknown>) => {
      const sessionId = `created-${created.length + 1}`
      created.push(request)
      return { sessionId, agentPreset: request['agentPreset'] }
    },
  })
  ctx.provide('workspaceRegistry', {
    archiveSession: async () => {}, unarchiveSession: async () => {},
    pinSession: async () => {}, unpinSession: async () => {},
  })
  ctx.logger.warn = (message: unknown) => { warnings.push(String(message)) }
  // 根上下文上的探针：未经作用域过滤的监听者会收到【所有】Agent 的事件，
  // 这正是本插件不采用「全局监听 + sessionId 过滤」的原因。
  // A probe on the root context: an unscoped listener receives EVERY Agent's
  // events, which is exactly why the plugin avoids global listen + filter.
  ctx.on('agent/status', ({ agent }) => { rootStatusEvents.push(String(agent.id)) })
  // 未标记作用域的根监听者会收到全部派发事件（dsh-scope 全局接纳未标记监听者）。
  // An unscoped root listener receives every dispatch event (dsh-scope admits
  // untagged listeners globally).
  const runEvents: { readonly name: string, readonly payload: unknown }[] = []
  ctx.on('session-dispatch/start', payload => { runEvents.push({ name: 'start', payload }) })
  ctx.on('session-dispatch/end', payload => { runEvents.push({ name: 'end', payload }) })

  const watch = createSettlementWatch(ctx, {
    maxReportChars: config.maxReportChars ?? 4000,
    maxConcurrentWatches: config.maxConcurrentWatches ?? 64,
  })
  definitions.set('session_dispatch', drivable(buildSessionDispatchDefinition(ctx, watch)))
  return {
    definitions,
    warnings,
    flushes,
    agents,
    created,
    rootStatusEvents,
    flushHooks,
    runEvents,
    addTool: (name: string) => { visibleTools.add(name) },
    addAgent,
    run: async (tool, args, exec) => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not registered: ${tool}`)
      return await definition.execute(args, exec)
    },
    unload: async () => { watch.dispose() },
  }
}

/**
 * 让事件循环跑几轮，等微任务推进。Let the event loop turn a few times.
 * @param rounds - 轮数。How many turns.
 */
export async function settleAsync(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
