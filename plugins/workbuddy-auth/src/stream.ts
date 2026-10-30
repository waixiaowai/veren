/**
 * SSE 流翻译：WorkBuddy（OpenAI 兼容）增量 → harness StreamChunk 词汇。
 * SSE translation: WorkBuddy's OpenAI-compatible deltas → the harness
 * StreamChunk vocabulary. Block order: reasoning precedes prose; tool calls
 * aggregate by wire index; the stream always ends with one finish chunk.
 *
 * 结构照搬 @veren/opencode-go 的 stream.ts（house 模式；两上游的 SSE 形状同
 * 为 OpenAI 兼容）。
 * Structure copied from @veren/opencode-go's stream.ts (house mode; both
 * upstreams speak the same OpenAI-compatible SSE shape).
 *
 * @module @veren/workbuddy-auth/stream
 */
import type { ContentBlock, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'

/** 上游 SSE 单块的最小形状（只取本插件读取的字段）。 */
/** The minimal shape of one upstream SSE chunk (only fields this plugin reads). */
export interface WireDelta {
  choices?: {
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
    }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number | null }
    completion_tokens_details?: { reasoning_tokens?: number | null }
  } | null
  error?: { message?: string } | null
}

/** 把响应体 SSE 解析为 wire 增量流；`data: [DONE]` 正常收尾。 */
/** Parses the response SSE into wire deltas; `data: [DONE]` closes normally. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<WireDelta> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        yield JSON.parse(payload) as WireDelta
      } catch {
        // 非法 JSON 行按网关噪声丢弃；完整解析失败在聚合层表现为空增量。
        // A malformed JSON line drops as gateway noise; aggregate-level failures surface as missing deltas.
      }
    }
  }
}

/** 流聚合状态机：增量 → harness 块序。The stream aggregation state machine. */
export class StreamAggregator {
  private readonly reasoning: string[] = []
  private readonly text: string[] = []
  private readonly toolOrders = new Map<number, { id: ToolCallId; blockIndex: number; name: string; arguments: string[] }>()
  private reasoningIndex: number | undefined
  private textIndex: number | undefined
  private nextBlock = 0
  private nextToolId = 0
  private usage: TokenUsage | undefined
  private finishReason: string | undefined

  /** 吸收一个 wire 增量，产出对应的 harness 块序。Absorbs one wire delta. */
  absorb(delta: WireDelta): StreamChunk[] {
    if (delta.error !== undefined && delta.error !== null) {
      throw new LlmError(`workbuddy: upstream reported ${delta.error.message ?? 'an in-band error'}`, 'UPSTREAM_ERROR')
    }
    const chunks: StreamChunk[] = []
    const choice = delta.choices?.[0]
    if (choice?.delta !== undefined) chunks.push(...this.absorbDelta(choice.delta))
    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) this.finishReason = choice.finish_reason
    if (delta.usage !== undefined && delta.usage !== null) this.usage = translateUsage(delta.usage)
    return chunks
  }

  /** 终局：关闭全部开启块 → usage → finish。Termination: close open blocks → usage → finish. */
  settle(aborted: boolean): StreamChunk[] {
    const chunks: StreamChunk[] = []
    chunks.push(...this.closeReasoning(), ...this.closeText(), ...this.closeTools())
    if (this.usage !== undefined) chunks.push({ type: 'usage', usage: this.usage })
    chunks.push({
      type: 'finish',
      reason: aborted
        ? { kind: 'aborted', failure: { code: 'ABORTED', message: 'workbuddy: request aborted' } }
        : { kind: mapFinish(this.finishReason) },
    })
    return chunks
  }

  /** 正文/推理/工具增量吸收（块序：reasoning 先于正文）。Delta absorption (reasoning precedes prose). */
  private absorbDelta(delta: NonNullable<NonNullable<WireDelta['choices']>[number]['delta']>): StreamChunk[] {
    const chunks: StreamChunk[] = []
    const reasoning = delta.reasoning_content
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      if (this.reasoningIndex === undefined) {
        this.reasoningIndex = this.nextBlock++
        chunks.push({ type: 'block-start', index: this.reasoningIndex, blockType: 'reasoning' })
      }
      this.reasoning.push(reasoning)
      chunks.push({ type: 'reasoning-delta', index: this.reasoningIndex, text: reasoning })
    }
    const text = delta.content
    if (typeof text === 'string' && text.length > 0) {
      if (this.textIndex === undefined) {
        this.textIndex = this.nextBlock++
        chunks.push({ type: 'block-start', index: this.textIndex, blockType: 'text' })
      }
      this.text.push(text)
      chunks.push({ type: 'text-delta', index: this.textIndex, text })
    }
    for (const call of delta.tool_calls ?? []) chunks.push(...this.absorbToolCall(call))
    return chunks
  }

  /** 工具调用增量：按 wire index 聚合；首个增量开块。Tool-call deltas aggregate by wire index; the first delta opens the block. */
  private absorbToolCall(call: NonNullable<NonNullable<NonNullable<WireDelta['choices']>[number]['delta']>['tool_calls']>[number]): StreamChunk[] {
    const wireIndex = call.index ?? 0
    const chunks: StreamChunk[] = []
    let order = this.toolOrders.get(wireIndex)
    if (order === undefined) {
      order = {
        // 上游已发 id 视为 provider 发行，过线即铸 brand；缺失才本地合成。
        // An upstream-sent id is provider-issued — branded on adoption; only absence synthesizes locally.
        id: ToolCallId(call.id ?? `workbuddy-call-${this.nextToolId++}`),
        blockIndex: this.nextBlock++,
        name: call.function?.name ?? '',
        arguments: [],
      }
      this.toolOrders.set(wireIndex, order)
      chunks.push({ type: 'block-start', index: order.blockIndex, blockType: 'tool-call' })
    }
    if (call.function?.name !== undefined) order.name = call.function.name
    const argumentsDelta = call.function?.arguments ?? ''
    if (argumentsDelta.length > 0) {
      order.arguments.push(argumentsDelta)
      chunks.push({ type: 'tool-call-delta', index: order.blockIndex, id: order.id, name: order.name, argumentsDelta })
    }
    return chunks
  }

  private closeReasoning(): StreamChunk[] {
    if (this.reasoningIndex === undefined) return []
    const block: ContentBlock = { type: 'reasoning', text: this.reasoning.join('') }
    return [{ type: 'block-end', index: this.reasoningIndex, block }]
  }

  private closeText(): StreamChunk[] {
    if (this.textIndex === undefined) return []
    const block: ContentBlock = { type: 'text', text: this.text.join('') }
    return [{ type: 'block-end', index: this.textIndex, block }]
  }

  private closeTools(): StreamChunk[] {
    const chunks: StreamChunk[] = []
    for (const order of this.toolOrders.values()) {
      const block: ContentBlock = { type: 'tool-call', id: order.id, name: order.name, arguments: order.arguments.join('') }
      chunks.push({ type: 'block-end', index: order.blockIndex, block })
    }
    return chunks
  }
}

/** finish_reason → harness FinishReason；未知值落 stop。 */
/** finish_reason → the harness FinishReason; unknown values land on stop. */
function mapFinish(reason: string | undefined): 'stop' | 'tool-calls' | 'max-tokens' {
  if (reason === 'tool_calls') return 'tool-calls'
  if (reason === 'length') return 'max-tokens'
  return 'stop'
}

/**
 * usage 折算：TokenUsage 的 inputTokens 是未缓存输入（prompt_tokens 折含缓存，
 * 需扣除）。
 * Usage conversion: TokenUsage.inputTokens is uncached input (prompt_tokens
 * folds cache in, so subtract it out).
 */
function translateUsage(usage: NonNullable<WireDelta['usage']>): TokenUsage {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const prompt = usage.prompt_tokens ?? 0
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const converted: TokenUsage = {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: usage.completion_tokens ?? 0,
  }
  if (usage.total_tokens !== undefined && usage.total_tokens !== null) converted.totalTokens = usage.total_tokens
  if (cached > 0) converted.cacheReadTokens = cached
  if (typeof reasoning === 'number' && reasoning > 0) converted.reasoningTokens = reasoning
  return converted
}
