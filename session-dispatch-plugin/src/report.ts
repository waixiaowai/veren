// 回报渲染与投递：把目标会话的收尾 assistant 输出渲染成一条回报正文，并以
// 插件来源的 follow-up 消息投回调用方会话，最后用 flush 确认持久化。
// Report rendering and delivery: render the target session's final assistant
// output into one report body, deliver it as a plugin-sourced follow-up message
// into the caller session, then confirm durability with a flush.
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 agent 与 sessionController 的 Context 声明合并。
// Type-only imports: pull the agent and sessionController Context declaration merging.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { ReportContext } from './types.js'
import type { Config } from './index.js'

/**
 * 按字符数截断，超限时保留一个省略号。Truncate by character count, keeping
 * one ellipsis when the limit is exceeded.
 * @param text - 原文。The source text.
 * @param limit - 字符上限（至少 1）。The character cap (at least 1).
 * @returns 不超限的文本。Text no longer than the limit.
 */
function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * 取目标会话在投递之后新产生的最后一条有正文的 assistant 输出。
 * 基线之前的派生历史属于投递前的工作，不构成这次派发的收尾输出。
 * Read the target session's last assistant message with text produced AFTER the
 * delivery. Derived history before the baseline belongs to earlier work and is
 * not this dispatch's closing output.
 * @param ctx - 宿主上下文。The host context.
 * @param sessionId - 目标会话 id。The target session id.
 * @param baseline - 投递时的派生历史长度。The derived-history length at delivery.
 * @returns 收尾输出；取不到时为空串。The final output, or '' when there is none.
 */
export function readFinalOutput(ctx: Context, sessionId: SessionId, baseline: number): string {
  const session = ctx.sessions.get(sessionId) ?? ctx.agents.get(sessionId)?.session
  if (session === undefined) return ''
  const produced = session.deriveMessages().slice(baseline)
  for (let index = produced.length - 1; index >= 0; index -= 1) {
    const message = produced[index]
    if (message === undefined || message.role !== 'assistant') continue
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (text.trim() !== '') return text
  }
  return ''
}

/**
 * 套用回报模板；占位符见 Config.reportTemplate 的文档。
 * Apply the report template; its placeholders are documented on Config.reportTemplate.
 * @param config - 已校验配置。The validated config.
 * @param context - 渲染输入。The render inputs.
 * @param output - 目标的收尾输出（可能为空串）。The target's final output (possibly '').
 * @returns 回报正文。The report body.
 */
export function renderReport(config: Config, context: ReportContext, output: string): string {
  const body = output.trim() === '' ? config.emptyOutputText : truncate(output, config.maxReportChars)
  return config.reportTemplate
    .replaceAll('{target_session_id}', context.targetSessionId)
    .replaceAll('{watch_id}', context.watchId)
    .replaceAll('{outcome}', context.outcome)
    .replaceAll('{waited_ms}', String(context.waitedMs))
    .replaceAll('{output}', body)
}

/**
 * 把回报作为 follow-up 投回调用方会话并确认持久化。若调用方 Agent 已不在
 * 注册表里（例如宿主重启过），按 schedule 的做法经 Session controller 恢复它。
 * Deliver the report as a follow-up into the caller session and confirm
 * durability. When the caller Agent is no longer registered (a Host restart, for
 * example), restore it through the Session controller, as Schedule does.
 * @param ctx - 宿主上下文。The host context.
 * @param callerSessionId - 调用方会话 id。The caller session id.
 * @param text - 回报正文。The report body.
 * @returns 投递与 flush 结束。Resolves after enqueue and flush.
 */
export async function deliverReport(ctx: Context, callerSessionId: SessionId, text: string): Promise<void> {
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'session-dispatch' },
  })
  const live = ctx.agents.get(callerSessionId)
  if (live !== undefined) {
    live.followup(message)
    await ctx.sessions.flush(live.session)
    return
  }
  const found = await ctx.sessionController.resolveAgent(callerSessionId)
  if ('error' in found) throw found.error
  found.agent.followup(message)
  await ctx.sessions.flush(found.agent.session)
}
