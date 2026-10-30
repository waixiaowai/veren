/**
 * 会话追踪头规格：回合稳定、工具结果跳过、调用方头保留、原始会话 id 不外发。
 * Conversation-tracking specs: turn stability, tool-result skipping,
 * caller-header preservation, raw session ids never forwarded.
 */
import { describe, expect, it } from 'vitest'
import { conversationKeyOf, turnKeyOf, withGatewayChatHeaders } from '../src/conversation-ids.ts'

const CHAT = JSON.stringify({
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '第一句' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'tool', tool_call_id: 'c1', content: '结果' },
    { role: 'user', content: '第二句' },
  ],
})

describe('回合键 / turn key', () => {
  it('取倒数第一条真实用户消息；纯工具结果消息被跳过', () => {
    expect(turnKeyOf(JSON.parse(CHAT))).toContain('第二句')
    expect(turnKeyOf(JSON.parse(CHAT))).not.toContain('结果')
  })

  it('同一体重复派生同值（重试/工具续跑/换账号保持同一回合）', () => {
    const a = withGatewayChatHeaders({}, CHAT)
    const b = withGatewayChatHeaders({}, CHAT)
    expect(a['X-Conversation-Request-ID']).toBe(b['X-Conversation-Request-ID'])
    expect(a['X-Conversation-ID']).toBe(b['X-Conversation-ID'])
  })

  it('用户下一条消息换新回合', () => {
    const next = JSON.stringify({ messages: [...JSON.parse(CHAT).messages, { role: 'assistant', content: '答' }, { role: 'user', content: '第三句' }] })
    expect(withGatewayChatHeaders({}, next)['X-Conversation-Request-ID'])
      .not.toBe(withGatewayChatHeaders({}, CHAT)['X-Conversation-Request-ID'])
  })

  it('没有可签消息时每请求新 id（安全失败：绝不静默复用旧回合）', () => {
    const empty = JSON.stringify({ messages: [{ role: 'tool', tool_call_id: 'c', content: 'x' }] })
    const a = withGatewayChatHeaders({}, empty)
    const b = withGatewayChatHeaders({}, empty)
    expect(a['X-Conversation-Request-ID']).not.toBe(b['X-Conversation-Request-ID'])
  })
})

describe('红线 / red lines', () => {
  it('原始会话键绝不外发：派生 id 是盐化 32 hex，读不回原文', () => {
    const sessionKey = 'sess-abcdef-12345'
    const headers = withGatewayChatHeaders({}, CHAT, sessionKey)
    expect(JSON.stringify(headers)).not.toContain(sessionKey)
    expect(headers['X-Conversation-ID']).toMatch(/^[0-9a-f]{32}$/)
    // 会话键派生的会话 id 与首条消息派生的不同（显式键优先）。
    expect(headers['X-Conversation-ID']).not.toBe(withGatewayChatHeaders({}, CHAT)['X-Conversation-ID'])
  })

  it('每条消息全新 X-Conversation-Message-ID / X-Request-ID 对（二者同值）', () => {
    const a = withGatewayChatHeaders({}, CHAT)
    const b = withGatewayChatHeaders({}, CHAT)
    expect(a['X-Request-ID']).toBe(a['X-Conversation-Message-ID'])
    expect(b['X-Request-ID']).not.toBe(a['X-Request-ID'])
  })

  it('调用方已带的头保留（HTTP 头名大小写不敏感，不加变体重名）', () => {
    const headers = { 'x-conversation-id': 'caller-chose', 'X-Request-ID': 'caller-req' }
    const merged = withGatewayChatHeaders(headers, CHAT)
    expect(merged['x-conversation-id']).toBe('caller-chose')
    expect(merged['X-Request-ID']).toBe('caller-req')
    expect(Object.keys(merged).filter(key => key.toLowerCase() === 'x-request-id')).toHaveLength(1)
  })

  it('conversationKeyOf：显式会话键优先，回退首条真实用户消息', () => {
    expect(conversationKeyOf(JSON.parse(CHAT), 'sess-1')).toBe('session:sess-1')
    expect(conversationKeyOf(JSON.parse(CHAT), undefined)).toContain('第一句')
    expect(conversationKeyOf(undefined, undefined)).toBe('')
  })
})
