// 测试支撑：构造宿主形状的会话事件、假 Agent 切片，以及一次真实 pre-step 派发。
// Test support: host-shaped session events, the fake Agent slice, and one real
// pre-step dispatch.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { Config } from '../src/index.js'
import type { ConfigShape } from '../src/index.js'

/** 默认配置：三步阈值、默认工具名。Default config: threshold 3, default tool names. */
export const DEFAULT_CONFIG: ConfigShape = Config({
  enabled: true,
  threshold: 3,
  analysisTools: ['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch'],
  dispatchTools: ['session_dispatch'],
})

/**
 * 补齐配置：schema 的调用签名要求完整对象，测试只覆盖关心的字段。
 * Complete a config: the schema's call signature wants all fields, so a test
 * overrides only what it exercises.
 */
export const resolveConfig = (overrides: Partial<ConfigShape> = {}): ConfigShape =>
  Config({ ...DEFAULT_CONFIG, ...overrides })

/** 一条已记录的用户消息事件。One logged user-message event. */
export function userEvent(seq: number, text: string): SessionEvent {
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: Date.UTC(2026, 9, 19),
    surfaceOp: 'append',
    data: { ...message, id: MessageId(`msg-${seq}`) },
  }
}

/** 一条本插件写入的重锚提醒事件（模拟下一轮日志里的历史提醒）。One logged re-anchor notice. */
export function reanchorEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: Date.UTC(2026, 9, 19),
    surfaceOp: 'append',
    data: {
      id: MessageId(`msg-${seq}`),
      role: 'user',
      source: { kind: 'person-agent-reanchor', form: 'notice', summary: 'test notice' },
      content: [{ type: 'text', text }],
    },
  }
}

/** 一条工具调用事件。One tool-call event. */
export function callEvent(
  seq: number,
  turn: number,
  step: number,
  name: string,
  args: Record<string, unknown> = {},
): SessionEvent {
  return {
    type: 'tool/call',
    seq: SessionSeq(seq),
    time: Date.UTC(2026, 9, 19),
    data: { turn, step, callId: ToolCallId(`call-${seq}`), name, arguments: JSON.stringify(args) },
  }
}

/** 一条工具结果事件，用于把长会话的体量做进日志。One tool-result event, used to give the long session its bulk. */
export function resultEvent(seq: number, turn: number, step: number, text: string): SessionEvent {
  const callId = ToolCallId(`call-${seq}`)
  const message = createToolResultMessage({ callId, content: [{ type: 'text', text }], isError: false })
  return {
    type: 'tool/result',
    seq: SessionSeq(seq),
    time: Date.UTC(2026, 9, 19),
    surfaceOp: 'append',
    data: { turn, step, message },
  }
}

/** 插件唯一读取的会话切片。The session slice the plugin reads. */
type ReadSessionSlice = Pick<Agent['session'], 'id' | 'seq' | 'eventAt' | 'snapshotEvents'>

/**
 * 只有日志读取面的假 Agent；其他成员一碰就失败。
 * Fake Agent with only the log-read face; every other member fails when touched.
 * @param history - mutable log rows. 可变日志行。
 * @returns a full Agent whose non-log surface is unreachable. 完整 Agent，非日志面不可达。
 */
export function fakeAgent(history: SessionEvent[]): Agent {
  const unreachable = (member: string): never => {
    throw new Error(`fakeAgent.${member} must not be called`)
  }
  const session: ReadSessionSlice = {
    id: 'session-reanchor-test' as never,
    get seq() { return history.length as never },
    eventAt: (seq) => history[Number(seq)],
    snapshotEvents: () => history,
  }
  return {
    id: session.id,
    options: {},
    session: session as Agent['session'],
    inbox: {
      nextTurn: [],
      nextStep: [],
      clear: () => unreachable('inbox.clear'),
      append: () => unreachable('inbox.append'),
      prepend: () => unreachable('inbox.prepend'),
      replace: () => unreachable('inbox.replace'),
      remove: () => unreachable('inbox.remove'),
      splice: () => unreachable('inbox.splice'),
    },
    status: 'idle',
    ctx: undefined as never,
    cancel: () => unreachable('cancel'),
    whenIdle: () => unreachable('whenIdle'),
    runMaintenance: () => unreachable('runMaintenance'),
    send: () => unreachable('send'),
    followup: () => unreachable('followup'),
    steer: () => unreachable('steer'),
    inject: () => unreachable('inject'),
  }
}

/**
 * 一次真实 waterfall 派发；返回宿主决策里的全部消息。
 * One real waterfall dispatch; returns every message in the host decision.
 * @param ctx - context carrying the plugin. 承载插件的上下文。
 * @param agent - subject agent. 目标 Agent。
 * @param turn - turn about to start. 即将开始的回合。
 * @param step - step about to start. 即将开始的步骤。
 * @param signal - cancellation signal. 取消信号。
 * @returns the decision's messages (empty on reject). 决策里的消息（拒绝时为空）。
 */
export async function preStep(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  signal: AbortSignal = new AbortController().signal,
): Promise<UserMessage[]> {
  const decision = await ctx.waterfall(
    'agent/pre-step',
    { agent, messages: [], turn, step, signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
  return decision.kind === 'reject' ? [] : decision.messages
}

/** 一条消息里唯一的文本。The single text carried by one message. */
export function textOf(message: UserMessage | undefined): string {
  if (message === undefined) return ''
  return message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
}
