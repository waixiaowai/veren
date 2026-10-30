/**
 * 请求翻译：harness 消息/工具词汇 → WorkBuddy 的 OpenAI 兼容 wire。
 * Request translation: the harness message/tool vocabulary → WorkBuddy's
 * OpenAI-compatible wire.
 *
 * 模型 id 面：单路由内两区域并存而上游 id 有跨区域撞名（`glm-5.3` 两区都在、
 * 元数据不同），所以 harness 面的 id 带区域前缀（`cn:`/`global:`），wire 上
 * 永远发裸上游 id。显示名缀区域标签与计费倍率。
 * Model-id scheme: the single route carries both regions while upstream ids
 * collide across them (`glm-5.3` exists in both with different metadata), so
 * harness-facing ids carry a region prefix (`cn:`/`global:`) and the wire
 * always sends the bare upstream id. Display names carry a region tag and the
 * billing rate.
 *
 * 图片/文件 v1 投影为占位文本（照 @veren/opencode-go 先例；WorkBuddy 模型
 * 虽声明 supportsImages，附件解析留待 v2）。
 * Images/files project to placeholder text in v1 (the @veren/opencode-go
 * precedent; WorkBuddy models declare supportsImages, but attachment
 * resolution waits for v2).
 *
 * @module @veren/workbuddy-auth/translate
 */
import type { ContentBlock, GenerateOptions, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { WorkBuddyRegion } from '@veren/workbuddy-protocol'

/** 区域 → harness 面 id 前缀。Region → harness-facing id prefix. */
const REGION_PREFIX: Readonly<Record<WorkBuddyRegion, string>> = { cn: 'cn:', global: 'global:' }

/** 区域短标签（显示名用）。Short region tags (for display names). */
const REGION_TAG: Readonly<Record<WorkBuddyRegion, string>> = { cn: '国内', global: '国际' }

/** 组装 harness 面的模型 id。Composes the harness-facing model id. */
export function composeModelId(region: WorkBuddyRegion, upstreamId: string): string {
  return `${REGION_PREFIX[region]}${upstreamId}`
}

/** 区域显示标签。The region display tag. */
export function regionTag(region: WorkBuddyRegion): string {
  return REGION_TAG[region]
}

/**
 * 解析 harness 面模型 id：剥区域前缀得区域与裸上游 id。
 * 无前缀 = 旧选择器残留或外部直呼 —— 显式拒绝（INVALID_REQUEST），不猜区域。
 * Parses a harness-facing model id into region + bare upstream id. A prefixless
 * id is explicitly refused (INVALID_REQUEST) — the region is never guessed.
 */
export function parseModelId(model: string): { region: WorkBuddyRegion; upstreamId: string } {
  if (model.startsWith(REGION_PREFIX.cn)) return { region: 'cn', upstreamId: model.slice(REGION_PREFIX.cn.length) }
  if (model.startsWith(REGION_PREFIX.global)) return { region: 'global', upstreamId: model.slice(REGION_PREFIX.global.length) }
  throw new LlmError(
    `workbuddy: model id must carry a region prefix ("cn:…"/"global:…"), got "${model}"`,
    'INVALID_REQUEST',
  )
}

/**
 * 档位映射：harness 档位 id → wire `reasoning_effort` 值。
 * `off`/`minimal` 不在上游词表且两区域都拒 `off`（字段缺省是唯一各处实测皆过
 * 的形态），整个省略；声明档位原样放行。
 * Effort mapping: harness effort id → wire `reasoning_effort`. `off`/`minimal`
 * are outside the upstream vocabulary (`off` is rejected by both regions;
 * omission is the only form measured good everywhere), so they drop entirely;
 * declared spellings pass through.
 */
export function translateEffort(effort: string | undefined): string | undefined {
  if (effort === undefined || effort === '' || effort === 'off' || effort === 'minimal') return undefined
  return effort
}

/** 组装 wire 请求体（方言准备由协议库的 prepareBodyForRegion 负责）。Assembles the wire body (dialect preparation lives in the protocol's prepareBodyForRegion). */
export function translateRequest(options: GenerateOptions, upstreamId: string, effort: string | undefined): Record<string, unknown> {
  return {
    model: upstreamId,
    messages: translateMessages(options.messages, options.system),
    stream: true,
    ...(effort === undefined ? {} : { reasoning_effort: effort }),
    ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: translateTools(options.tools) }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: options.stop }),
  }
}

/** 消息序列翻译：role 分派 + 块级投影。Message-sequence translation: role dispatch plus per-block projection. */
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
    case 'user': return [{ role: 'user', content: userParts(message.content) }]
    case 'assistant': return translateAssistant(message)
    case 'tool': return [{ role: 'tool', tool_call_id: message.toolCallId, content: joinText(message.content) }]
    default: return []
  }
}

/** assistant 消息：可见文本 + 工具调用；reasoning 块不可回放，按 OpenAI 语义丢弃。 */
/** Assistant message: visible text plus tool calls; reasoning blocks are not replayable and drop per OpenAI semantics. */
function translateAssistant(message: Extract<RequestMessage, { role: 'assistant' }>): unknown[] {
  const text = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('')
  const toolCalls = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
    .map(block => ({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } }))
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

/** 工具声明翻译。Tool-declaration translation. */
function translateTools(tools: readonly ToolSchema[]): unknown[] {
  return tools.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/** 拼接全部文本块（空内容回答空串）。Joins every text block (empty content answers an empty string). */
function joinText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('')
}
