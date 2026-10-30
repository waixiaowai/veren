/**
 * 翻译层规格：模型 id 前缀面、档位映射、消息词汇翻译。
 * Translation specs: the model-id prefix face, effort mapping, message
 * vocabulary translation.
 */
import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { composeModelId, parseModelId, translateEffort, translateRequest } from '../src/translate.ts'
import { CN_SYSTEM_STAND_IN } from '@veren/workbuddy-protocol'

describe('模型 id 面 / model-id face', () => {
  it('前缀往返：cn:/global: 组装与解析互逆，wire 拿裸上游 id', () => {
    expect(parseModelId(composeModelId('cn', 'glm-5.3'))).toEqual({ region: 'cn', upstreamId: 'glm-5.3' })
    expect(parseModelId(composeModelId('global', 'gpt-5.6-luna'))).toEqual({ region: 'global', upstreamId: 'gpt-5.6-luna' })
  })

  it('无前缀 id 显式拒绝（区域绝不猜）', () => {
    expect(() => parseModelId('glm-5.3')).toThrow(LlmError)
    try {
      parseModelId('glm-5.3')
    } catch (error) {
      expect((error as LlmError).code).toBe('INVALID_REQUEST')
    }
  })
})

describe('档位映射 / effort mapping', () => {
  it('off/minimal 整个省略（两区域都拒 off；minimal 不在上游词表）；声明档位放行', () => {
    expect(translateEffort(undefined)).toBeUndefined()
    expect(translateEffort('off')).toBeUndefined()
    expect(translateEffort('minimal')).toBeUndefined()
    expect(translateEffort('high')).toBe('high')
    expect(translateEffort('xhigh')).toBe('xhigh')
  })
})

describe('请求体翻译 / request translation', () => {
  it('system 提示、用户文本、assistant 工具调用、tool 结果各归其位', () => {
    const body = translateRequest({
      provider: 'workbuddy',
      model: 'cn:glm-5.3',
      system: 'be brief',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [
          { type: 'text', text: '读文件' },
          { type: 'reasoning', text: '想' },
          { type: 'tool-call', id: 'c1' as never, name: 'read_file', arguments: '{"p":1}' } as never,
        ] },
        { role: 'tool', toolCallId: 'c1' as never, content: [{ type: 'text', text: '内容' }] } as never,
      ],
    }, 'glm-5.3', 'high', 'cn') as {
      model: string
      stream: boolean
      reasoning_effort?: string
      messages: { role: string; content: unknown; tool_calls?: { id: string }[]; tool_call_id?: string }[]
    }
    expect(body.model).toBe('glm-5.3')
    expect(body.stream).toBe(true)
    expect(body.reasoning_effort).toBe('high')
    // CN 方言：system 携带自有短句，完整提示包 runtime_context 走首条 user 前段。
    expect(body.messages[0]).toEqual({ role: 'system', content: CN_SYSTEM_STAND_IN })
    expect(body.messages[1]).toEqual({ role: 'user', content: [
      { type: 'text', text: expect.stringContaining('<runtime_context>') },
      { type: 'text', text: 'hi' },
    ] })
    expect(String((body.messages[1]!.content as { text: string }[])[0]!.text)).toContain('be brief')
    // reasoning 块不可回放，丢弃；tool_calls 挂在 assistant 上。
    expect(body.messages[2]!.role).toBe('assistant')
    expect(body.messages[2]!.tool_calls).toEqual([{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"p":1}' } }])
    expect(JSON.stringify(body.messages[2]!.content)).not.toContain('想')
    expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
  })

  it('图片投影为占位文本（v1 文本面）；工具声明翻译', () => {
    const body = translateRequest({
      provider: 'workbuddy',
      model: 'cn:glm-5.3',
      messages: [{ role: 'user', content: [
        { type: 'text', text: '看图' },
        { type: 'image', mime: 'image/png', data: '' } as never,
      ] }],
      tools: [{ name: 't1', description: 'd', parameters: {} }],
    }, 'glm-5.3', undefined, 'global') as { messages: { content: { type: string; text: string }[] }[]; tools: unknown[] }
    expect(body.messages[0]!.content[1]).toEqual({ type: 'text', text: '[image omitted]' })
    expect(body.tools).toEqual([{ type: 'function', function: { name: 't1', description: 'd', parameters: {} } }])
  })
})
