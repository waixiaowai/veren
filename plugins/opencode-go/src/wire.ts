/**
 * 请求翻译：harness 消息/工具词汇 → OpenAI chat completions wire。
 * v1 语义面：文本 + 工具；图片以占位文本投影（网关原生支持图片，v2 再接
 * attachment 解析）；reasoning/developer 块按网关语义折叠。
 * Request translation: the harness message/tool vocabulary → the OpenAI chat
 * completions wire. v1 semantics: text plus tools; images project to
 * placeholder text (the gateway supports images natively — attachment
 * resolution lands in v2); reasoning/developer blocks fold per wire semantics.
 *
 * @module @veren/opencode-go
 */
import type { ContentBlock, GenerateOptions, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'

/** 诚实的客户端身份：网关文档明确要求非通用 SDK 的自报家门。 */
/** Honest client identity: the gateway docs require self-identification over generic SDK names. */
export const PLUGIN_USER_AGENT = '@veren/opencode-go/2.2.1 (dsh-harness)'

/** 未携带 sessionId 的辅助调用共用的稳定会话头（利于网关侧 prompt cache）。 */
/** Stable session header shared by auxiliary calls without a sessionId (helps gateway prompt caching). */
const ANON_SESSION = 'dsh-opencode-go-anonymous'

/** 一次请求的全部头：鉴权 + 会话路由 + 归因 + UA。All headers of one request: auth, session routing, attribution, UA. */
export function buildRequestHeaders(key: string, sessionId: string | undefined): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    'x-opencode-session': sessionId ?? ANON_SESSION,
    'user-agent': PLUGIN_USER_AGENT,
    ...attributionHeaders(),
  }
}

/** 组装 wire 请求体。Assembles the wire request body. */
export function translateRequest(options: GenerateOptions): Record<string, unknown> {
  return {
    model: options.model,
    messages: translateMessages(options.messages, options.system),
    stream: true,
    stream_options: { include_usage: true },
    ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: translateTools(options.tools) }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop === undefined ? { stop: undefined } : { stop: options.stop }),
  }
}

/** 消息序列翻译：role 分派 + 块级投影。Message sequence translation: role dispatch plus per-block projection. */
function translateMessages(messages: readonly RequestMessage[], system: string | undefined): unknown[] {
  const wire: unknown[] = []
  if (system !== undefined && system.length > 0) wire.push({ role: 'system', content: system })
  for (const message of messages) wire.push(...translateOne(message))
  return wire
}

/** 单条消息翻译；未知块类型按 merge-extensible 词汇契约直接落空。 */
/** Translates one message; unknown block types fall through per the merge-extensible vocabulary contract. */
function translateOne(message: RequestMessage): unknown[] {
  switch (message.role) {
    case 'system': return [{ role: 'system', content: joinText(message.content) }]
    // 网关按 OpenAI 兼容语义只认 system/user/assistant/tool；developer 折叠为 system。
    // The OpenAI-compatible wire knows system/user/assistant/tool only; developer folds into system.
    case 'developer': return message.content.length === 0 ? [] : [{ role: 'system', content: joinText(message.content) }]
    case 'user': return [{ role: 'user', content: userParts(message.content) }]
    case 'assistant': return translateAssistant(message)
    case 'tool': return [{
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: joinText(message.content),
    }]
    default: return []
  }
}

/** assistant 消息：可见文本 + 工具调用；reasoning 块不可回放，按 OpenAI 语义丢弃。 */
/** Assistant message: visible text plus tool calls; reasoning blocks are not replayable and drop per OpenAI semantics. */
function translateAssistant(message: Extract<RequestMessage, { role: 'assistant' }>): unknown[] {
  const text = message.content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('')
  const toolCalls = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    }))
  if (toolCalls.length === 0) return [{ role: 'assistant', content: text }]
  return [{ role: 'assistant', content: text.length > 0 ? text : null, tool_calls: toolCalls }]
}

/** 用户内容：文本直译；图片/文件投影为占位文本（v1 文本面）。 */
/** User content: text translates directly; images/files project to placeholder text (v1 text surface). */
function userParts(content: readonly ContentBlock[]): unknown[] {
  const parts: unknown[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push({ type: 'text', text: block.text })
    else if (block.type === 'image' || block.type === 'file') parts.push({ type: 'text', text: `[${block.type} omitted]` })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

/** 工具声明翻译。Tool declaration translation. */
function translateTools(tools: readonly ToolSchema[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/** 拼接全部文本块（空内容回答空串）。Joins every text block (empty content answers an empty string). */
function joinText(content: readonly ContentBlock[]): string {
  return content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('')
}

/**
 * HTTP 错误 → 结构化 LlmError：401 KEY_INVALID（不清登录）、402 配额尽、
 * 403 路由拒绝、其余 UPSTREAM_ERROR 带 status。
 * HTTP error → structured LlmError: 401 KEY_INVALID (sign-in kept), 402 quota
 * exhausted, 403 route refused, everything else UPSTREAM_ERROR with status.
 */
export async function wireError(response: Response, what: string): Promise<LlmError> {
  const detail = await response.text().catch(() => '')
  const trimmed = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail
  const message = `opencode-go: ${what} failed with HTTP ${response.status}${trimmed.length > 0 ? `: ${trimmed}` : ''}`
  const code = response.status === 401 ? 'KEY_INVALID'
    : response.status === 402 ? 'QUOTA_EXCEEDED'
    : response.status === 403 ? 'ROUTE_FORBIDDEN'
    : 'UPSTREAM_ERROR'
  return new LlmError(message, code, { status: response.status })
}
