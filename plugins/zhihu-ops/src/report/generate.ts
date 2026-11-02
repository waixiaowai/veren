/**
 * 报告生成：一次模型调用，把事实块写成运营分析。
 *
 * 起草调用刻意放在任何会话之外：它经 `ctx.llm` 发出一次性请求，因此自动生成
 * 的报告绝不唤醒 agent、绝不进入对话日志、也不继承任何对话上下文。
 *
 * Report generation: one model call turns the fact block into operations
 * analysis.
 *
 * The drafting call is deliberately outside any Session: it goes out through
 * `ctx.llm` as a one-shot request, so an automatic report never wakes an
 * agent, never enters a conversation log, and never inherits a conversation's
 * context.
 *
 * @module @veren/zhihu-ops/report/generate
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { FactSections } from './facts.ts'

/** 报告的请求与结果 / the report request and result */
export interface ReportRequest {
  /** 事实块的各段 / the fact block sections */
  readonly facts: FactSections
  /** 报告窗口天数 / how many days the report covers */
  readonly windowDays: number
  /** 报告日期键 / the report's date key */
  readonly day: string
}

/** 写出报告的指令 / the instruction that writes the report */
const SYSTEM_PROMPT = [
  '你是一位知乎账号的运营分析师。你拿到的是账号最近若干天的真实数据快照。',
  '请写一份中文运营分析报告，用 Markdown，分四节，标题固定为：',
  '## 账号表现 / ## 内容表现 / ## 待办 / ## 选题建议',
  '规则：',
  '- 只用给出的数据说话，不要编造任何数字；数据没覆盖的（例如阅读率、完读率）就明说"本次数据未覆盖"。',
  '- 待办写 3 到 5 条，每条一句话，必须具体到"做什么"，不要写"继续努力"这类空话。',
  '- 选题建议结合给定的热榜与适合回答的问题，并说明为什么适合这个账号。',
  '- 不要寒暄，不要复述数据表格，直接给判断。',
].join('\n')

/**
 * 组装报告请求的提示词。
 * Assembles the report request's prompt.
 *
 * @param request - the request / 请求
 * @returns the system prompt and the single user message / 系统提示与用户消息
 */
export function reportPrompt(request: ReportRequest): { system: string; text: string } {
  const text = [
    `统计窗口：最近 ${request.windowDays} 天（截至 ${request.day}）。`,
    '',
    '## 账号数据',
    request.facts.account,
    '',
    '## 内容数据',
    request.facts.contents,
    '',
    '## 评论信号',
    request.facts.replies,
    '',
    '## 热榜',
    request.facts.hot,
    '',
    '## 适合回答的问题',
    request.facts.topics,
  ].join('\n')
  return { system: SYSTEM_PROMPT, text }
}

/**
 * 收集一次流式回答的文本。
 * Collects a streaming reply into one string.
 *
 * @param chunks - the model's stream / 模型的流
 * @returns the concatenated text / 拼好的文本
 */
export async function collectText(chunks: AsyncIterable<{ readonly type: string; readonly text?: string }>): Promise<string> {
  let text = ''
  for await (const chunk of chunks) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text
}

/**
 * 用部署配置的模型写一份报告。`llm` 与默认模型面由所属服务以参数显式传入
 * （均为声明的硬 inject，G13）；"未配置默认模型"是值层面的拒绝。
 * Writes one report with the deployment's configured model. The `llm` and
 * default-model faces arrive as explicit parameters from the owning service
 * (both are declared hard injects, G13); "no default model configured" is a
 * value-level refusal.
 *
 * @param model - the injected default-model face / 注入的默认模型面
 * @param llm - the injected llm face / 注入的 llm 面
 * @param request - the request / 请求
 * @returns the report body / 报告正文
 * @throws Error when no model is configured / 未配置模型
 */
export async function generateReport(
  model: Context['agentDefaultModel'],
  llm: Context['llm'],
  request: ReportRequest,
): Promise<string> {
  const selection = model.currentSelection()
  if (selection === undefined) {
    throw new Error('[zhihu-ops] no default model is configured, so the report cannot be written')
  }
  const prompt = reportPrompt(request)
  const text = await collectText(llm.stream({
    provider: selection.provider,
    model: selection.model,
    system: prompt.system,
    messages: [createUserMessage({
      content: [{ type: 'text', text: prompt.text }],
      source: { kind: 'zhihu-ops-report' },
    })],
    purpose: 'session-title',
  }))
  return text.trim()
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A one-shot Zhihu operations report request. @persistenceSource user */
    'zhihu-ops-report': { kind: 'zhihu-ops-report' }
  }
}
