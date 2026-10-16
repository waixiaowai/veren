// 测试辅助：真实 cordis Context + 真实 dsh-scope 作用域，只有外部服务用假实现。
// 关键点是 agent.ctx 必须是真实的作用域上下文：本插件的看守就挂在它上面，
// 事件路由因此由 dsh-scope 承担，插件自己不做任何 sessionId 比对。
// Test support: a real cordis Context and a real dsh-scope scope; only external
// services are faked. The load-bearing detail is that `agent.ctx` must be a real
// scoped context: the plugin's guard registers there, so dsh-scope owns event
// routing and the plugin performs no sessionId comparison at all.
import { Context } from '@deepseek-ai/cordis'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { apply, inject, name } from '../src/index.js'
import type { Config, ConfigShape } from '../src/index.js'

/** 被注册工具定义的最小执行面。/ The minimal execution face of a registered tool. */
export interface RegisteredTool {
  readonly name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 可以从外部结清的 promise。/ A promise an outside caller can settle. */
export interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

/**
 * 建一个可以从外部结清的 promise。/ Build a promise an outside caller can settle.
 * @returns 结清句柄。/ The settle handle.
 */
export function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** 一条派生消息的最小形状。/ The minimal derived-message shape. */
export interface FakeMessage {
  readonly role: string
  readonly content: { readonly type: string, readonly text: string }[]
}

/** 假 Agent：契约成员（status 在测试里可变）+ 测试驱动成员。 */
/** The fake Agent: contract members (with a mutable status for tests) plus test drivers. */
export interface FakeAgent {
  readonly id: SessionIdType
  readonly options: Record<string, never>
  ctx: Context
  status: 'idle' | 'running'
  readonly inbox: { nextTurn: UserMessage[], nextStep: UserMessage[] }
  readonly session: { readonly id: string, deriveMessages: () => FakeMessage[] }
  readonly messages: FakeMessage[]
  readonly received: UserMessage[]
  quiescent: boolean
  quiescence: Deferred
  readonly whenIdle: () => Promise<void>
  followup: (message: UserMessage) => void
  readonly wake: () => void
  readonly say: (text: string) => void
  readonly finish: () => void
  readonly finishWithMaintenance: () => void
  readonly park: () => void
  readonly settle: () => void
}

/**
 * 用运行时同款的作用域载体广播一次 agent/inbox/*。
 * Broadcast one agent/inbox/* through the runtime's own scope carrier.
 * @param agent - 主体 Agent。/ The subject Agent.
 * @param name - 事件名。/ The event name.
 * @param rest - 载荷中除 agent 之外的字段。/ The payload fields other than `agent`.
 */
function emitInbox(agent: FakeAgent, name: 'agent/inbox/inserted' | 'agent/inbox/claimed' | 'agent/inbox/discarded', rest: { message: UserMessage, turn?: number }): void {
  // 唯一的类型断言：假 Agent 只实现被测路径用到的成员，而派发入口要求完整的 Agent。
  // The single type assertion: the fake implements only the members exercised
  // paths touch, while the dispatch entry point is typed for the complete Agent.
  emitAgentEvent(agent.ctx, agent as unknown as Agent, name, rest as never)
}

/**
 * 迁移公开状态并广播一次（重复状态不广播）。
 * Transition the public status and broadcast once (repeat statuses stay silent).
 * @param agent - 目标 Agent。/ The subject Agent.
 * @param status - 目标状态。/ The destination status.
 */
function setStatus(agent: FakeAgent, status: 'idle' | 'running'): void {
  if (agent.status === status) return
  agent.status = status
  // 与运行时同一条路：agent/status 经作用域载体派发，由 dsh-scope 决定谁收到。
  // 看守不订阅它（结算靠 whenIdle() + inbox 事件），这里发出来是为了证明作用域过滤。
  // The runtime's own path: agent/status goes through the scope carrier and
  // dsh-scope decides who receives it. The guard does not subscribe to it
  // (settlement runs on whenIdle() plus inbox events); it is emitted here to
  // demonstrate scope filtering.
  emitAgentEvent(agent.ctx, agent as unknown as Agent, 'agent/status', { status })
}

/**
 * 建一个假 Agent 并给它一个真实的作用域上下文。
 * Build a fake Agent and give it a real scoped context.
 * @param root - 根上下文。/ The root context.
 * @param id - 会话身份。/ The session identity.
 * @returns 假 Agent。/ The fake Agent.
 */
export function createFakeAgent(root: Context, id: string): FakeAgent {
  const sessionId = SessionId(id)
  const agent: FakeAgent = {
    id: sessionId,
    options: {},
    ctx: root,
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
    session: { id: sessionId, deriveMessages: () => [...agent.messages] },
    messages: [],
    received: [],
    quiescent: true,
    quiescence: deferred(),
    whenIdle: () => (agent.quiescent ? Promise.resolve() : agent.quiescence.promise),
    followup: (message) => {
      agent.received.push(message)
      agent.inbox.nextTurn.push(message)
      // 与宿主一致的顺序：入队通知先发，再唤醒 driver。
      // Host order: the insertion notification fires, then the driver wakes.
      emitInbox(agent, 'agent/inbox/inserted', { message })
      agent.wake()
    },
    wake: () => {
      if (agent.quiescent) {
        agent.quiescent = false
        agent.quiescence = deferred()
      }
      setStatus(agent, 'running')
    },
    say: (text) => { agent.messages.push({ role: 'assistant', content: [{ type: 'text', text }] }) },
    finish: () => {
      for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
        emitInbox(agent, 'agent/inbox/claimed', { message, turn: 1 })
      }
      agent.inbox.nextTurn = []
      agent.inbox.nextStep = []
      agent.settle()
    },
    // 复现 maintenance 的坑：公开状态先回到 idle，whenIdle() 之后才 resolve。
    // Reproduce the maintenance pitfall: status returns to idle first while
    // whenIdle() stays pending.
    finishWithMaintenance: () => {
      agent.inbox.nextTurn = []
      agent.inbox.nextStep = []
      setStatus(agent, 'idle')
    },
    // 停放：driver 停了、whenIdle() 也 resolve 了，但输入还留在 inbox 里没人认领。
    // Park: the driver stopped and whenIdle() resolved, yet input stays in the
    // inbox with no claim pending.
    park: () => {
      agent.quiescent = true
      setStatus(agent, 'idle')
      agent.quiescence.resolve()
    },
    settle: () => {
      agent.quiescent = true
      setStatus(agent, 'idle')
      agent.quiescence.resolve()
    },
  }
  // 作用域键就是 Agent 对象本身，与运行时 agentCarrier() 一致。
  // The scope key is the Agent object itself, matching the runtime's agentCarrier().
  agent.ctx = createScope(root, agent).ctx
  return agent
}

/** 装好的测试环境。/ The installed test environment. */
export interface Env {
  readonly ctx: Context
  readonly definitions: Map<string, RegisteredTool>
  readonly warnings: string[]
  readonly flushes: string[]
  readonly agents: Map<string, FakeAgent>
  readonly created: Record<string, unknown>[]
  readonly rootStatusEvents: string[]
  addAgent: (id: string) => FakeAgent
  run: (tool: string, args: unknown, exec: unknown) => Promise<unknown>
  unload: () => Promise<void>
}

/** 默认配置：与 Config schema 的 default 一致。/ Defaults mirroring the Config schema. */
export const DEFAULT_CONFIG: Config = {
  reportTemplate: [
    '[SESSION DISPATCH REPORT]',
    'Target session: {target_session_id}',
    'Watch: {watch_id}',
    'Outcome: {outcome} (waited {waited_ms} ms)',
    '',
    '{output}',
  ].join('\n'),
  emptyOutputText: '(the dispatched session produced no assistant text)',
  maxReportChars: 4000,
  maxConcurrentWatches: 64,
}

/**
 * 用真实 Context / 真实 effect 清理安装本插件，外部服务用假实现。
 * Install the plugin with a real Context and real effect cleanup; external
 * services are fakes.
 * @param config - 配置覆盖。/ Config overrides.
 * @returns 测试环境。/ The test environment.
 */
export async function install(config: Partial<ConfigShape> = {}): Promise<Env> {
  const ctx = new Context()
  const definitions = new Map<string, RegisteredTool>()
  const warnings: string[] = []
  const flushes: string[] = []
  const agents = new Map<string, FakeAgent>()
  const sessions = new Map<string, { id: string }>()
  const created: Record<string, unknown>[] = []
  const rootStatusEvents: string[] = []

  const addAgent = (id: string): FakeAgent => {
    const agent = createFakeAgent(ctx, id)
    agents.set(id, agent)
    sessions.set(id, agent.session)
    return agent
  }

  ctx.provide('tools', {
    // 与宿主一致：register 返回精确卸载函数，供 cordis effect 逆序清理。
    // Host contract: register returns the exact disposer for reverse-order cleanup.
    register: (definition: RegisteredTool) => {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  })
  ctx.provide('agents', { get: (id: string) => agents.get(id) })
  ctx.provide('sessions', {
    get: (id: string) => sessions.get(id),
    flush: async (session: { id: string }) => { flushes.push(session.id); return true },
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
  ctx.logger.warn = (message: unknown) => { warnings.push(String(message)) }
  // 根上下文上的探针：未经作用域过滤的监听者会收到【所有】Agent 的事件，
  // 这正是本插件不采用「全局监听 + sessionId 过滤」的原因。
  // A probe on the root context: an unscoped listener receives EVERY Agent's
  // events, which is exactly why the plugin avoids global listen + filter.
  ctx.on('agent/status', ({ agent }) => { rootStatusEvents.push(String(agent.id)) })

  const fiber = ctx.plugin({ name, inject, apply }, { ...DEFAULT_CONFIG, ...config })
  await fiber
  return {
    ctx,
    definitions,
    warnings,
    flushes,
    agents,
    created,
    rootStatusEvents,
    addAgent,
    run: async (tool, args, exec) => {
      const definition = definitions.get(tool)
      if (definition === undefined) throw new Error(`tool not registered: ${tool}`)
      return await definition.execute(args, exec)
    },
    unload: async () => { await fiber.dispose() },
  }
}

/**
 * 让事件循环跑几轮，等微任务推进。/ Let the event loop turn a few times.
 * @param rounds - 轮数。/ How many turns.
 */
export async function settleAsync(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
