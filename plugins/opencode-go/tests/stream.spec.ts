/**
 * SSE 聚合状态机的红绿回归：真实网关形态（reasoning 先行 + include_usage
 * 尾块）、工具调用聚合、终局块序、并发隔离（状态机无共享态）。
 * Red/green regression for the SSE aggregation state machine: the real
 * gateway shape (reasoning first plus the include_usage tail), tool call
 * aggregation, terminal chunk order, and concurrency isolation (no shared
 * state between aggregators).
 *
 * @module @veren/opencode-go/tests
 */
import { describe, expect, it } from 'vitest'
import { StreamAggregator, parseSse } from '../src/stream.js'

const GATEWAY_SSE = [
  'data: {"choices":[{"delta":{"reasoning_content":"想一想"}}]}',
  'data: {"choices":[{"delta":{"reasoning_content":"，然后回答"}}]}',
  'data: {"choices":[{"delta":{"content":"OK"}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"notebook_write","arguments":"{\\"a\\""}}]}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]}}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"prompt_tokens_details":{"cached_tokens":30},"completion_tokens_details":{"reasoning_tokens":12}}}',
  'data: [DONE]',
].join('\n')

function sse(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
}

describe('parseSse', () => {
  it('逐行解析 data 载荷并在 [DONE] 收尾', async () => {
    const deltas = []
    for await (const delta of parseSse(sse(GATEWAY_SSE))) deltas.push(delta)
    expect(deltas).toHaveLength(6)
  })

  it('非法 JSON 行按噪声丢弃，不中断流', async () => {
    const body = 'data: {broken\n\ndata: {"choices":[{"delta":{"content":"hi"}}]}\ndata: [DONE]'
    const deltas = []
    for await (const delta of parseSse(sse(body))) deltas.push(delta)
    expect(deltas).toHaveLength(1)
  })
})

describe('StreamAggregator', () => {
  it('真实网关形态：reasoning 块先行、文本块随后、工具调用聚合、usage 折算扣缓存', async () => {
    const aggregator = new StreamAggregator()
    const chunks = []
    for await (const delta of parseSse(sse(GATEWAY_SSE))) chunks.push(...aggregator.absorb(delta))
    chunks.push(...aggregator.settle(false))

    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(chunks[1]).toEqual({ type: 'reasoning-delta', index: 0, text: '想一想' })
    const textStart = chunks.findIndex((chunk) => chunk.type === 'block-start' && chunk.blockType === 'text')
    expect(textStart).toBeGreaterThan(0)
    const toolStart = chunks.findIndex((chunk) => chunk.type === 'block-start' && chunk.blockType === 'tool-call')
    expect(toolStart).toBeGreaterThan(textStart)

    const usage = chunks.find((chunk) => chunk.type === 'usage')
    expect(usage === undefined ? undefined : usage.usage).toEqual({
      // 100 = 35 + 30 + 35；缓存部分单列（TokenUsage 计数不相交）。
      // 100 = 35 + 30 + 35; cached input reports separately (disjoint TokenUsage counts).
      inputTokens: 70,
      outputTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 30,
      reasoningTokens: 12,
    })

    const finishes = chunks.filter((chunk) => chunk.type === 'finish')
    expect(finishes).toEqual([{ type: 'finish', reason: { kind: 'tool-calls' } }])
    const toolEnd = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(toolEnd === undefined ? undefined : toolEnd.block).toEqual({
      type: 'tool-call', id: 'call_1', name: 'notebook_write', arguments: '{"a":1}',
    })
  })

  it('length → max-tokens；无 usage 尾块时不发 usage 块', () => {
    const aggregator = new StreamAggregator()
    const chunks = [
      ...aggregator.absorb({ choices: [{ delta: { content: '长' }, finish_reason: 'length' }] }),
      ...aggregator.settle(false),
    ]
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
    expect(chunks.some((chunk) => chunk.type === 'usage')).toBe(false)
  })

  it('abort 终局给出 aborted finish', () => {
    const aggregator = new StreamAggregator()
    const chunks = [
      ...aggregator.absorb({ choices: [{ delta: { content: '写一半' } }] }),
      ...aggregator.settle(true),
    ]
    expect(chunks.at(-1)?.type).toBe('finish')
    expect((chunks.at(-1) as { reason: { kind: string } }).reason.kind).toBe('aborted')
  })

  it('带内 error 增量抛结构化 UPSTREAM_ERROR', () => {
    const aggregator = new StreamAggregator()
    expect(() => aggregator.absorb({ error: { message: 'quota blown' } })).toThrowError(/quota blown/)
  })

  it('并发隔离：两个聚合器互不串块（同仓并发安全铁律）', () => {
    const a = new StreamAggregator()
    const b = new StreamAggregator()
    a.absorb({ choices: [{ delta: { content: 'A1' } }] })
    b.absorb({ choices: [{ delta: { content: 'B1' } }] })
    const aChunks = [...a.absorb({ choices: [{ delta: { content: 'A2' } }] }), ...a.settle(false)]
    expect(aChunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text)).toEqual(['A2'])
  })
})
