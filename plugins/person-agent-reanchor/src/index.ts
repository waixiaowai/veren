// 插件入口：定期重锚。连续 N 步只做分析、期间没有派活时，在下一个请求的末尾
// 追加一条很短的「关于它自己的事实」，把桥梁拉回派活姿态。
// Plugin entry: periodic re-anchoring. After N consecutive analysis-only steps
// with no dispatch, append one short fact about the session to the end of the
// next request and pull the bridge back into its delegating posture.
//
// 为什么是 append-only 消息而不是改系统提示词：模型目录没有为
// `deepseek-v4-pro` 声明 `systemPromptUpdate: 'in-history'`，中途改写提示词会
// 让整个前缀缓存失效，长会话上等于每一步重付全部历史。pre-step 决策里的消息
// 只往后追加，前缀不动。
// Why an append-only message instead of a system-prompt update: the model
// catalog does not declare `systemPromptUpdate: 'in-history'` for
// `deepseek-v4-pro`, so rewriting the prompt mid-session would drop the whole
// prefix cache and make a long session pay for all history every step. Messages
// from the pre-step decision are appended only; the prefix never moves.
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
// 类型-only import：拉取 agent/pre-step 的 Context 声明合并。
// Type-only import: pull the agent/pre-step Context declaration merging.
import type {} from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { readAnalysisRun, shouldReanchor, SOURCE } from './analyze.js'
import { reminderSummary, renderReminder } from './render.js'
import type { AnalysisRun } from './types.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'person-agent-reanchor': { kind: 'person-agent-reanchor' } & ContextFormed
  }
}

export const name = 'personAgentReanchor'

export interface Config {
  /** Master switch: false leaves the listener unregistered. 总开关：false 时不注册监听器。 */
  enabled: boolean
  /** Consecutive analysis-only steps before one notice. 触发一条提醒所需的连续纯分析步数。 */
  threshold: number
  /** Tool names that count as inspecting/analyzing. 算作检查/分析的工具名。 */
  analysisTools: string[]
  /** Tool names that count as handing work to another session. 算作把活交给其他会话的工具名。 */
  dispatchTools: string[]
}

const DEFAULT_ANALYSIS_TOOLS = ['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch']
const DEFAULT_DISPATCH_TOOLS = ['session_dispatch']

export const Config: z<Config> = z
  .object({
    enabled: z.boolean().default(true).description('Register the re-anchor listener; false disables the plugin entirely.'),
    threshold: z.natural().min(1).default(3).description('Consecutive analysis-only steps before one re-anchor notice.'),
    analysisTools: z.array(z.string()).default(DEFAULT_ANALYSIS_TOOLS).description('Tool names that only inspect or analyze (read, read_image, glob, grep, web_search, web_fetch by default).'),
    dispatchTools: z.array(z.string()).default(DEFAULT_DISPATCH_TOOLS).description('Tool names that hand the task to another session (session_dispatch by default).'),
  })
  .description('Append a short numeric self-work reminder after a run of analysis-only steps, without touching the system prompt.')

// 配置形状类型别名：`Config` 同时是接口类型与 schema 值，测试用别名指接口。
// A type alias for the config shape: `Config` is both an interface type and a
// schema value, so tests use this alias to mean the interface.
export type ConfigShape = Config

/** No services are required: the plugin reads the log and publishes a pre-step decision. 不需要服务：插件只读日志并产出 pre-step 决策。 */
export const inject = []
export const provide = []

/**
 * Register the pre-step listener. Append-only: the notice joins the host's
 * admitted messages at the end, which is the end of the request.
 * 注册 pre-step 监听器。只追加：提醒接在宿主已准入消息之后，也就是请求末尾。
 * @param ctx - plugin context; the listener is disposed with it. 插件上下文；监听器随其卸载。
 * @param config - validated policy; `enabled: false` registers nothing. 已校验的策略；`enabled: false` 不注册任何东西。
 */
export const apply = (ctx: Context, config: Config): void => {
  if (!config.enabled) return
  assertPositiveThreshold(config.threshold)
  assertToolList('analysisTools', config.analysisTools)
  assertToolList('dispatchTools', config.dispatchTools)
  const policy = { analysisTools: config.analysisTools, dispatchTools: config.dispatchTools }
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    // 拒绝与已取消都原样返回，不改写宿主的决定。
    // A rejection or an aborted turn passes the host's decision through untouched.
    if (decision.kind === 'reject' || signal.aborted) return decision
    const run = readAnalysisRun(agent.session, policy, turn)
    if (!shouldReanchor(run, config.threshold)) return decision
    const notice = noticeMessage(run)
    // 放到末尾：模型看到的最后一条输入就是这条事实，最贴近下一步决策。
    // Append at the end: the last input the model sees before deciding the next
    // step is this fact.
    return { kind: 'enter', messages: [...decision.messages, notice] }
  })
}

/**
 * Build one sourced notice message. The source kind keeps it out of derived
 * human history, and `form: 'notice'` gives the UI a one-line account.
 * 构造一条带来源的提醒消息。来源 kind 让它不混进派生的人类历史，
 * `form: 'notice'` 给 UI 一行陈述。
 * @param run - counted facts. 统计事实。
 * @returns the identified user message. 已标识的用户消息。
 */
function noticeMessage(run: AnalysisRun) {
  const text = renderReminder(run, run.anchors)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: SOURCE, form: 'notice', summary: boundContextSummary(reminderSummary(run)) },
  })
}

/**
 * Fail loud on a threshold that could never fire as intended.
 * 阈值不可能按预期触发时显性失败。
 * @param threshold - configured threshold. 配置的阈值。
 */
function assertPositiveThreshold(threshold: number): void {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(`person-agent-reanchor: threshold must be an integer >= 1, got ${String(threshold)}`)
  }
}

/**
 * Fail loud on an empty tool list: an empty analysis list can never re-anchor,
 * and an empty dispatch list cannot tell "no dispatch" from "not tracked".
 * 工具列表为空时显性失败：空分析列表永远不会触发，空派活列表无法区分「没派活」
 * 与「没跟踪」。
 * @param field - config field name for the error. 用于错误消息的配置字段名。
 * @param tools - configured names. 配置的名字。
 */
function assertToolList(field: string, tools: readonly string[]): void {
  if (tools.length === 0) throw new Error(`person-agent-reanchor: ${field} must not be empty`)
  for (const tool of tools) {
    if (tool.trim() === '') throw new Error(`person-agent-reanchor: ${field} must not contain an empty tool name`)
  }
}
