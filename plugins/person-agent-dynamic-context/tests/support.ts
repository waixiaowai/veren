// 测试共享支撑：三个 spec 都需要的「配置解析」「日志行类型」「快照文本读取」。
// 这里只放与宿主/插件契约对齐的小工具，不放任何断言。
// Shared test support: config resolution, the log-row type, and snapshot-text
// reading — the three things every spec needs. Only contract-aligned helpers
// live here; assertions stay in the specs.
import type { Agent, Inbox, InboxTarget } from '@deepseek-ai/dsh-agent'
import type { AgentCancelCause } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Config } from '../src/index.js'
import type { ConfigShape, SessionLogView } from '../src/index.js'

/** 三个开关都打开的默认配置，语义等价于原测试里的 Config({})。
 * All three toggles on — semantically identical to the old Config({}). */
export const DEFAULT_CONFIG: ConfigShape = { includePresetRoster: true, includeWorkspaceList: true, includeModelCatalog: true }

/**
 * 解析一份完整配置：schema 的调用签名要求三个键齐全（缺键会 ts(2345)），因此这里显式
 * 用默认值补齐，测试里只需写想覆盖的那一项。
 * Resolves a complete config: the schema's call signature requires all three keys (a
 * missing key raises ts(2345)), so defaults are filled in here and a test only
 * writes the toggle it means to override.
 */
export const resolveConfig = (overrides: Partial<ConfigShape> = {}): ConfigShape =>
  Config({ ...DEFAULT_CONFIG, ...overrides })

/** One logged user/message event row — the host union's own member, so a fake
 * history is assignable to a real `Session`'s readers.
 * 一条已入账的 user/message 事件——直接取宿主联合的成员，因此假历史可直接赋给
 * 真实 `Session` 的读取器。 */
export type LoggedMessage = Extract<SessionEvent, { type: 'user/message' }>

/** The sections list, read defensively off the message-source union (every
 * source may carry optional sections).
 * 从消息来源联合上防御性读取的区块列表（每个来源都可选携带 sections）。 */
type SourceSections = { sections?: readonly { name: string, text: string }[] }

/**
 * Build one full host-shaped `user/message` event: branded seq, `surfaceOp`,
 * and a complete `UserMessage` payload — no partial rows in any spec.
 * 构造一条完整宿主形状的 `user/message` 事件：品牌号 seq、`surfaceOp`，以及
 * 完整的 `UserMessage` 负载——任何 spec 里都不再出现残缺行。
 * @param seq - the log sequence to brand.
 * @param source - the message source (kind plus any source-specific fields).
 * @param text - the single text block the message carries.
 * @returns the host-typed event row.
 */
export function loggedUserMessage(seq: number, source: UserMessage['source'], text: string): LoggedMessage {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: Date.UTC(2026, 9, 15),
    surfaceOp: 'append',
    data: {
      id: MessageId(`msg-${seq}`),
      role: 'user',
      source,
      content: [{ type: 'text', text }],
    },
  }
}

/** 日志序号类型（宿主品牌号），从插件的日志视图推导，避免另立来源。
 * The log sequence type, derived from the plugin's own log view. */
export type LogSeq = Parameters<SessionLogView['eventAt']>[0]

/** Snapshot texts an event history currently carries, one per message. 一段事件历史当前携带的快照文本，每条消息一个。 */
export function snapshotTexts(history: LoggedMessage[]): string[] {
  return history
    .filter((row) => row.data.source.kind === 'person-agent-context')
    .map((row) => (row.data.content[0]?.type === 'text' ? row.data.content[0].text : ''))
}

/**
 * The latest recorded text of one named section across the history (later
 * messages win). Undefined when the section was never appended.
 * 一段历史中某个具名区块的最新记录文本（后写优先）。该区块从未追加过时 undefined。
 */
export function latestSectionText(history: LoggedMessage[], name: string): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const source = history[index]?.data.source as SourceSections & { kind?: string }
    if (source.kind !== 'person-agent-context') continue
    const match = source.sections?.find((part) => part.name === name)
    if (match !== undefined) return match.text
  }
  return undefined
}

/**
 * 假 Agent：`agent/pre-step` 的载荷要求完整的运行时 Agent 面，但插件只读
 * `agent.session` 的日志视图切片（id/seq/eventAt/snapshotEvents），其余成员用
 * 「不可达」桩补齐——被触达即测试失败，绝不静默。
 * Fake Agent: the `agent/pre-step` payload requires the full runtime Agent face,
 * but the plugin reads only the log-view slice of `agent.session`
 * (id/seq/eventAt/snapshotEvents); every other member is an "unreachable" stub
 * that fails the test loudly instead of misbehaving.
 * @param session - the fake session slice the plugin reads through.
 * @returns a full Agent whose non-session surface is inert.
 */
/** The session slice the plugin is allowed to read. 插件被允许读取的会话切片。 */
type ReadSessionSlice = Pick<Agent['session'], 'id' | 'seq' | 'eventAt' | 'snapshotEvents'>

export function fakeAgent(session: ReadSessionSlice): Agent {
  const unreachable = (member: string): never => {
    throw new Error(`fakeAgent.${member} must not be called by this test`)
  }
  // 唯一一处收窄断言：Agent 面要求完整 Session，而本测试环境的契约是「插件只读
  // 上述切片」；越界读取会拿到 undefined 而非错误行为，由 type-pins 守住切片清单。
  // The single narrowing assertion: the Agent face demands a full Session, while
  // this test's contract is "the plugin reads only the slice above"; out-of-slice
  // reads yield undefined rather than wrong behavior, and the type-pins file
  // guards the slice list.
  const fullSession = session as Agent['session']
  const inbox: Inbox = {
    nextTurn: [],
    nextStep: [],
    clear: () => unreachable('inbox.clear'),
    append: (_target: InboxTarget, _message: UserMessage) => unreachable('inbox.append'),
    prepend: (_target: InboxTarget, _message: UserMessage) => unreachable('inbox.prepend'),
    replace: (_messageId: MessageId, _newMessage: UserMessage) => unreachable('inbox.replace'),
    remove: (_messageId: MessageId) => unreachable('inbox.remove'),
    splice: (_target: InboxTarget, _start: number, _deleteCount: number, _inserted: UserMessage[]) =>
      unreachable('inbox.splice'),
  }
  return {
    id: fullSession.id,
    options: {},
    session: fullSession,
    inbox,
    status: 'idle',
    ctx: undefined as never, // 插件契约只经 waterfall 读 agent.session；ctx 不可达 / unreachable by contract
    cancel: (_cause: AgentCancelCause) => unreachable('cancel'),
    whenIdle: () => unreachable('whenIdle'),
    runMaintenance: () => unreachable('runMaintenance'),
    send: () => unreachable('send'),
    followup: () => unreachable('followup'),
    steer: () => unreachable('steer'),
    inject: () => unreachable('inject'),
  }
}
