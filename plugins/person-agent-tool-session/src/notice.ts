// 派发的两种消息：调用方写给目标会话的内容，以及 runtime 对目标会话下场的陈述。
// 形状照抄官方子 agent 的 src/continuation-messages.ts：两者来源 kind 不同，
// 因为「发送者选择的内容」与「runtime 陈述的事实」合并会让目标被安上它没说过的话。
// The two dispatch messages: content the caller wrote to a target session, and the
// runtime's own account of what became of that session. The shape follows the
// official subagent's src/continuation-messages.ts - two distinct source kinds,
// because merging "content the sender chose" with "a fact the runtime states"
// would credit the target with words it never produced.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionDispatchOutcome } from './types.js'

/** 调用方投给目标会话的派发提示。Durable attribution for one dispatch prompt. */
export interface SessionDispatchPromptSource {
  readonly kind: 'session-dispatch'
  /** 一个 Agent 写给另一个 Agent 的内容（relay 形态）。Content one Agent addressed to another (`relay`). */
  readonly form: 'relay'
  /** 投递方会话 id。Session id of the Agent whose tool call produced the prompt. */
  readonly senderSessionId: SessionId
}

/**
 * runtime 对一次派发下场的陈述。与 {@link SessionDispatchPromptSource} 刻意分开：
 * 提示是调用方选择的内容，这条是 runtime 在陈述目标会话的下场。
 * The runtime's own account of one dispatch settlement. Deliberately a different
 * kind from {@link SessionDispatchPromptSource}: the prompt is content the caller
 * chose, while this message states what became of the target session.
 */
export interface SessionDispatchNoticeSource {
  readonly kind: 'session-dispatch-notice'
  /** 供 UI 行内展示、无需展开的一行陈述。A one-line account shown without expanding the row. */
  readonly form: 'notice'
  /** 一行陈述本身。The one-line account. */
  readonly summary: string
  /** 静止下去的那个会话。Session id of the session that settled. */
  readonly senderSessionId: SessionId
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'session-dispatch': SessionDispatchPromptSource
    'session-dispatch-notice': SessionDispatchNoticeSource
  }
}

/**
 * 建一条派发提示：调用方选择的内容，原样投给目标会话。
 * Build one dispatch prompt: content the caller chose, delivered verbatim to the
 * target session.
 * @param senderSessionId - 投递方会话 id。The sending session id.
 * @param text - 提示正文。The prompt body.
 * @returns 已标识的用户消息。The identified user message.
 */
export function createDispatchPrompt(senderSessionId: SessionId, text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'session-dispatch', form: 'relay', senderSessionId },
  })
}

/**
 * 一行陈述目标会话的下场，用调用方自己的任务词汇。
 * 分支与官方 continuation-messages.ts 的 settlementSummary 一致，包括两条必须区分的语义：
 * `refusal` 意味着被认领的输入被 pre-step 拒绝丢弃，调用方**不能**当作任务已完成；
 * 无法命名的下场按「可能没做完」汇报，而不是当成成功。
 * One line stating the target session's outcome in the caller's own task
 * vocabulary. The arms match the official settlementSummary, including two
 * semantics that must not be collapsed: `refusal` means a pre-step rejection
 * discarded claimed input, so the caller must not treat the task as done, and an
 * unnameable outcome is reported as possibly unfinished rather than as success.
 * @param targetSessionId - 目标会话 id。The target session id.
 * @param outcome - 下场。The outcome.
 * @returns 面向模型的开场句。The model-facing opening line.
 */
function settlementSummary(targetSessionId: SessionId, outcome: SessionDispatchOutcome): string {
  const subject = `Background session ${targetSessionId}`
  switch (outcome) {
    case 'completed':
      return `${subject} finished and will do no further work unless you send it more.`
    case 'aborted':
      return `${subject} was stopped before it finished.`
    case 'max-tokens':
      return `${subject} ran out of room before it finished.`
    case 'refusal':
      return `${subject} declined the task.`
    case 'error':
      return `${subject} failed before it finished.`
    case 'target-gone':
      return `${subject} left the runtime before it was observed settling; its work may be incomplete.`
    default:
      // 下场集合是可扩展的：无法命名的下场按「可能没做完」汇报，而不是当成成功。
      // Merge-extensible union: an unnameable outcome is reported as possibly
      // unfinished rather than silently as success.
      return `${subject} ended abnormally (${String(outcome)}) before it finished.`
  }
}

/**
 * 把收尾文本按字符上限截断，超限保留一个省略号。
 * Truncate closing text to the character cap, keeping one ellipsis.
 * @param blocks - 目标的收尾文本块。The target's closing text blocks.
 * @param limit - 字符上限（至少 1）。The character cap (at least 1).
 * @returns 截断后的文本块。The truncated text blocks.
 */
function boundClosingText(blocks: readonly ContentBlock[], limit: number): ContentBlock[] {
  const joined = blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
  if (joined.length <= limit) return [...blocks]
  return [{ type: 'text', text: `${joined.slice(0, Math.max(0, limit - 1))}…` }]
}

/**
 * 建一条结算通知：开场句 + 目标的收尾文本（非文本块按官方做法剔除，父级 provider
 * 可能拒收非文本 assistant 块）。
 * Build one settlement notice: the opening line plus the target's closing text
 * (non-text blocks are excluded, as the official notice does, because a parent
 * provider may reject non-text assistant blocks).
 * @param targetSessionId - 目标会话 id。The target session id.
 * @param outcome - 下场。The outcome.
 * @param closingText - 目标的收尾文本块。The target's closing text blocks.
 * @param maxReportChars - 收尾文本的字符上限。Character cap for the closing text.
 * @returns 已标识的通知消息。The identified notice message.
 */
export function createSettlementNotice(
  targetSessionId: SessionId,
  outcome: SessionDispatchOutcome,
  closingText: readonly ContentBlock[],
  maxReportChars: number,
): UserMessage {
  const summary = settlementSummary(targetSessionId, outcome)
  const text = closingText.flatMap(block => (block.type === 'text' && block.text.length > 0 ? [block] : []))
  return createUserMessage({
    content: [
      { type: 'text' as const, text: summary },
      ...text.length === 0
        ? [{ type: 'text' as const, text: 'It left no closing message.' }]
        : [{ type: 'text' as const, text: 'Its closing message:' }, ...boundClosingText(text, maxReportChars)],
    ],
    source: {
      kind: 'session-dispatch-notice',
      form: 'notice',
      summary: boundContextSummary(summary),
      senderSessionId: targetSessionId,
    },
  })
}

/**
 * 投递一条唤醒消息：与官方 `sendWaking` 同一判据——空闲用 queue（自成一轮），
 * 忙碌用 steer（并入当前轮的下一个 step 边界），因此忙碌的调用方不会被迫多跑一轮。
 * Deliver one waking message with the official `sendWaking` rule: queue when idle
 * (its own turn), steer when running (joined at the nearest step boundary), so a
 * busy caller is not forced into an extra turn.
 * @param agent - 接收方 Agent。The receiving Agent.
 * @param message - 已标识的用户消息。The identified user message.
 */
export function sendWaking(agent: Agent, message: UserMessage): void {
  if (agent.status === 'idle') agent.followup(message)
  else agent.steer(message)
}

/**
 * 把结算通知投回调用方会话并确认持久化。调用方 Agent 已不在注册表时（宿主重启过），
 * 经 Session controller 恢复它——与 schedule 的到期投递同一路线。
 * Deliver the settlement notice back into the caller session and confirm
 * durability. When the caller Agent is no longer registered (a Host restart),
 * restore it through the Session controller - the same route schedule uses.
 * @param ctx - 宿主上下文。The host context.
 * @param callerSessionId - 调用方会话 id。The caller session id.
 * @param message - 结算通知。The settlement notice.
 * @returns 投递与 flush 结束。Resolves after enqueue and flush.
 */
export async function deliverNotice(ctx: Context, callerSessionId: SessionId, message: UserMessage): Promise<void> {
  const live = ctx.agents.get(callerSessionId)
  if (live !== undefined) {
    sendWaking(live, message)
    await ctx.sessions.flush(live.session)
    return
  }
  const found = await ctx.sessionController.resolveAgent(callerSessionId)
  if ('error' in found) throw found.error
  sendWaking(found.agent, message)
  await ctx.sessions.flush(found.agent.session)
}
