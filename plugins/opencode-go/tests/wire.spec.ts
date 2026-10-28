/**
 * 请求翻译与错误映射的契约测试：role 分派、reasoning 丢弃、工具回放、
 * 头部组成（鉴权 + 会话 + 归因 + UA）、HTTP 状态 → 稳定 code。
 * Contract tests for request translation and error mapping: role dispatch,
 * reasoning drops, tool replay, header composition (auth + session +
 * attribution + UA), and HTTP status → stable codes.
 *
 * @module @veren/opencode-go/tests
 */
import { describe, expect, it } from 'vitest'
import { buildRequestHeaders, translateRequest, wireError } from '../src/wire.js'

const base = {
  provider: 'opencode-go',
  model: 'deepseek-v4.1-flash',
} as const

function message(role: string, content: unknown, extra: Record<string, unknown> = {}): never {
  return { id: `m_${role}`, source: { kind: 'test' }, role, content, ...extra } as never
}

describe('translateRequest', () => {
  it('system + user + assistant(工具调用) + tool 结果翻译为 wire 形状', () => {
    const body = translateRequest({
      ...base,
      system: '你是助手',
      messages: [
        message('user', [{ type: 'text', text: '你好' }]),
        message('assistant', [
          { type: 'reasoning', text: '内心戏' },
          { type: 'text', text: '我来记一条' },
          { type: 'tool-call', id: 'call_9', name: 'note', arguments: '{"t":1}' },
        ]),
        message('tool', [{ type: 'text', text: '已写入' }], { toolCallId: 'call_9' }),
      ],
      tools: [{ name: 'note', description: '记录', parameters: { type: 'object' } }],
      maxTokens: 128,
      temperature: 0.5,
      stop: ['END'],
    } as never)
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      // reasoning 块不可回放，assistant 只带文本 + tool_calls。
      // Reasoning blocks are not replayable; the assistant carries text plus tool_calls.
      { role: 'assistant', content: '我来记一条', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'note', arguments: '{"t":1}' } }] },
      { role: 'tool', tool_call_id: 'call_9', content: '已写入' },
    ])
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'note', description: '记录', parameters: { type: 'object' } } }])
    expect(body.max_tokens).toBe(128)
    expect(body.temperature).toBe(0.5)
    expect(body.stop).toEqual(['END'])
  })

  it('图片块投影为占位文本（v1 文本面，明确可见）', () => {
    const body = translateRequest({
      ...base,
      messages: [message('user', [{ type: 'image', attachment: {} }])],
    } as never)
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '[image omitted]' }] },
    ])
  })
})

describe('buildRequestHeaders', () => {
  it('鉴权 + 会话路由 + 归因头齐备；harness 归因名赢 UA 碰撞（归因契约）；无 sessionId 落匿名稳定头', () => {
    const headers = buildRequestHeaders('sk-test', 'sess_1')
    expect(headers.authorization).toBe('Bearer sk-test')
    expect(headers['x-opencode-session']).toBe('sess_1')
    // harness 归因 UA 是面向网关的自报家门（harness-owned 名字赢碰撞）。
    // The harness attribution UA is the gateway-facing identity (harness-owned names win collisions).
    expect(headers['user-agent']).toContain('deepseek-harness/')
    const anonymous = buildRequestHeaders('sk-test', undefined)
    expect(anonymous['x-opencode-session']).toBe('dsh-opencode-go-anonymous')
  })
})

describe('wireError', () => {
  it.each([[401, 'KEY_INVALID'], [402, 'QUOTA_EXCEEDED'], [403, 'ROUTE_FORBIDDEN'], [500, 'UPSTREAM_ERROR']])(
    'HTTP %i → %s', async (status, code) => {
      const response = new Response('{"error":{"message":"no"}}', { status })
      const error = await wireError(response, 'model x')
      expect(error.code).toBe(code)
      expect(error.message).toContain(`HTTP ${status}`)
    },
  )
})
