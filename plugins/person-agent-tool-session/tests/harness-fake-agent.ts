// 假 Agent：契约成员（status 可变）+ 测试驱动成员；agent.ctx 必须是真实
// dsh-scope 作用域上下文——看守挂在它上面，事件路由由 dsh-scope 承担，
// 构建器自己不做任何 sessionId 比对。
// The fake Agent: contract members (mutable status) plus test drivers; the
// `agent.ctx` must be a real dsh-scope scoped context - the guard registers
// there, dsh-scope owns event routing, and the builder performs no sessionId
// comparison.
import { Context } from '@deepseek-ai/cordis'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { deferred } from './harness-deferred.js'
import type { Deferred } from './harness-deferred.js'

/** 一条派生消息的最小形状。The minimal derived-message shape. */
export interface FakeMessage {
  readonly role: string
  readonly content: { readonly type: string, readonly text: string }[]
}

/** 假 Agent：契约成员（status 在测试里可变）+ 测试驱动成员。 */
/** The fake Agent: contract members (mutable status for tests) plus test drivers. */
export interface FakeAgent {
  readonly id: SessionIdType
  readonly options: Record<string, never>
  ctx: Context
  status: 'idle' | 'running'
  readonly inbox: { nextTurn: UserMessage[], nextStep: UserMessage[] }
  readonly session: {
    readonly id: SessionIdType
    readonly seq: number
    readonly header: { readonly id: SessionIdType, readonly parentSession?: SessionIdType }
    deriveMessages: () => FakeMessage[]
  }
  readonly messages: FakeMessage[]
  readonly received: UserMessage[]
  quiescent: boolean
  quiescence: Deferred
  readonly whenIdle: () => Promise<void>
  followup: (message: UserMessage) => void
  readonly steered: UserMessage[]
  readonly steer: (message: UserMessage) => void
  readonly wake: () => void
  /** 只认领一条排队输入，模拟宿主逐个开跑排队的回合。Claims one queued input, as the host does when it starts queued turns one by one. */
  readonly claimNext: (index?: number) => void
  readonly say: (text: string) => void
  /** 结束一个已进入 step 的轮次并广播 turn/end。Ends a stepped turn and emits `turn/end`. */
  readonly turnEnd: (reasonKind: string) => void
  /** 广播 agent/error。Emits `agent/error`. */
  readonly fail: () => void
  readonly finish: () => void
  readonly finishWithMaintenance: () => void
  readonly park: () => void
  readonly settle: () => void
}

/**
 * 用运行时同款的作用域载体广播一次 agent 事件。
 * Broadcast one agent event through the runtime's own scope carrier.
 * @param agent - 主体 Agent。The subject Agent.
 * @param name - 事件名。The event name.
 * @param rest - 载荷中除 agent 之外的字段。The payload fields other than `agent`.
 */
function emit(agent: FakeAgent, name: 'agent/inbox/inserted' | 'agent/inbox/claimed', rest: unknown): void {
  // 唯一的类型断言：假 Agent 只实现被测路径用到的成员，而派发入口要求完整的 Agent。
  // The single type assertion: the fake implements only the members exercised
  // paths touch, while the dispatch entry point is typed for the complete Agent.
  emitAgentEvent(agent.ctx, agent as unknown as Agent, name, rest as never)
}

/**
 * 广播一次 session/event（会话自己的作用域事件，载荷不是 agent 形式）。
 * Broadcast one `session/event` (a session-scoped event whose payload is not the
 * agent form).
 * @param agent - 会话所属 Agent。The Agent owning the session.
 * @param event - 会话事件。The session event.
 */
function emitSession(agent: FakeAgent, event: unknown): void {
  agent.ctx.emit('session/event', agent.session as never, event as never)
}

/**
 * 迁移公开状态并广播一次（重复状态不广播）。
 * Transition the public status and broadcast once (repeat statuses stay silent).
 * @param agent - 目标 Agent。The subject Agent.
 * @param status - 目标状态。The destination status.
 */
function setStatus(agent: FakeAgent, status: 'idle' | 'running'): void {
  if (agent.status === status) return
  agent.status = status
  emitAgentEvent(agent.ctx, agent as unknown as Agent, 'agent/status', { status })
}

/**
 * 建一个假 Agent 并给它一个真实的作用域上下文。
 * Build a fake Agent and give it a real scoped context.
 * @param root - 根上下文。The root context.
 * @param id - 会话身份。The session identity.
 * @param parentSession - 父会话 id（构造相邻血统用）。The parent session id (builds adjacent lineage).
 * @returns 假 Agent。The fake Agent.
 */
export function createFakeAgent(root: Context, id: string, parentSession?: string): FakeAgent {
  const sessionId = SessionId(id)
  // 目标会话的事件序号：foldConsumedWork 与失败取代判断都读它。
  // The target session's event sequence; both foldConsumedWork and failure
  // supersession read it.
  let seq = 0
  let turn = 0
  const agent: FakeAgent = {
    id: sessionId,
    options: {},
    ctx: root,
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [] },
    session: {
      id: sessionId,
      get seq() { return seq },
      header: { id: sessionId, ...parentSession === undefined ? {} : { parentSession: SessionId(parentSession) } },
      deriveMessages: () => [...agent.messages],
    },
    messages: [],
    received: [],
    steered: [],
    quiescent: true,
    quiescence: deferred(),
    whenIdle: () => (agent.quiescent ? Promise.resolve() : agent.quiescence.promise),
    followup: (message) => {
      agent.received.push(message)
      agent.inbox.nextTurn.push(message)
      // 与宿主一致的顺序：入队通知先发，再唤醒 driver。
      // Host order: the insertion notification fires, then the driver wakes.
      emit(agent, 'agent/inbox/inserted', { message })
      agent.wake()
    },
    steer: (message) => {
      agent.steered.push(message)
      emit(agent, 'agent/inbox/inserted', { message })
      agent.wake()
    },
    wake: () => {
      if (agent.quiescent) {
        agent.quiescent = false
        agent.quiescence = deferred()
      }
      setStatus(agent, 'running')
    },
    claimNext: (index = 0) => {
      const [message] = agent.inbox.nextTurn.splice(index, 1)
      if (message === undefined) throw new Error(`claimNext: no queued input at ${index}`)
      emit(agent, 'agent/inbox/claimed', { message, turn: 1 })
    },
    say: (text) => {
      const content = [{ type: 'text', text }]
      agent.messages.push({ role: 'assistant', content })
      // 与宿主一致：一条 assistant 输出会作为 assistant/message 会话事件落盘，
      // 看守折的正是这个事件，而不是派生历史。
      // Host fidelity: one assistant output lands as an `assistant/message` session
      // event; the guard folds that event, not the derived history.
      seq += 1
      emitSession(agent, {
        type: 'assistant/message',
        seq,
        time: Date.now(),
        // 真实的 assistant/message 一定带内嵌流记录（可能为空数组）；看守会读它。
        // A real `assistant/message` always carries its embedded stream records
        // (possibly an empty array); the guard reads it.
        data: { message: { role: 'assistant', content }, stream: [] },
      })
    },
    turnEnd: (reasonKind) => {
      turn += 1
      const push = (type: string, data: unknown): void => {
        seq += 1
        emitSession(agent, { type, seq, time: Date.now(), data })
      }
      // 进入过 step 的轮次才会被 foldConsumedWork 记为「计账轮次」。
      // Only a turn that entered a step counts as an accounting turn.
      push('turn/start', { turn })
      push('step/start', { turn, step: 1 })
      push('turn/end', { turn, reason: { kind: reasonKind } })
    },
    fail: () => {
      emitAgentEvent(agent.ctx, agent as unknown as Agent, 'agent/error', {
        turn: turn + 1, step: 1, error: new Error('boom'),
      } as never)
    },
    finish: () => {
      for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
        emit(agent, 'agent/inbox/claimed', { message, turn: 1 })
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
