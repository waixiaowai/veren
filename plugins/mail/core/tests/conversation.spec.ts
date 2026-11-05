/**
 * The conversation layer and the content pipeline, against the design's
 * acceptance rules.
 *
 * 会话层与内容流水线，对照设计的验收规则。
 */

import { describe, expect, it } from 'vitest'
import { renderContent, sanitize } from '../src/content.ts'
import { evaluateConditions } from '../src/conditions.ts'
import { handleInbound, recordOutbound, setConversationStatus } from '../src/conversation.ts'
import {
  conversationEventFixture,
  conversationFixture,
  fakeDomain,
  fakeStore,
  subscriberFixture,
} from './fixtures.ts'

/** A monotonically increasing identifier generator. / 单调递增的标识生成器。 */
function counter(): () => string {
  let next = 0
  return () => `id-${++next}`
}

describe('mail conversation', () => {
  it('records an inbound message and counts it', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putConversation(conversationFixture())
    const result = await handleInbound(store, {
      channel: 'in_app',
      threadId: 'thread-1',
      platformMessageId: 'pm-1',
      from: 'user-1',
      content: 'hello',
      occurredAt: 10,
    }, counter(), counter(), 10)
    expect(result.duplicate).toBe(false)
    const conversation = store.getConversation('conv-1')
    expect(conversation?.messageCount).toBe(1)
    expect(conversation?.lastMessagePreview).toBe('hello')
  })

  it('treats a repeated platform message as the same message', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putConversation(conversationFixture())
    const message = {
      channel: 'in_app' as const,
      threadId: 'thread-1',
      platformMessageId: 'pm-1',
      from: 'user-1',
      content: 'hello',
      occurredAt: 10,
    }
    await handleInbound(store, message, counter(), counter(), 10)
    const second = await handleInbound(store, message, counter(), counter(), 10)
    expect(second.duplicate).toBe(true)
    expect(store.conversationEvents('conv-1')).toHaveLength(1)
  })

  it('refuses a repeated platform message whose content differs', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putConversation(conversationFixture())
    await handleInbound(store, {
      channel: 'in_app',
      threadId: 'thread-1',
      platformMessageId: 'pm-1',
      from: 'user-1',
      content: 'hello',
      occurredAt: 10,
    }, counter(), counter(), 10)
    await expect(handleInbound(store, {
      channel: 'in_app',
      threadId: 'thread-1',
      platformMessageId: 'pm-1',
      from: 'user-1',
      content: 'something else',
      occurredAt: 11,
    }, counter(), counter(), 11)).rejects.toThrowError(
      expect.objectContaining({ code: 'MAIL_CONVERSATION_EVENT_DUPLICATE' }),
    )
  })

  it('refuses a reply to a resolved conversation', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putConversation(conversationFixture({ status: 'resolved' }))
    await expect(recordOutbound(store, 'conv-1', 'pm-2', 'hi', counter(), 10)).rejects.toThrowError(
      expect.objectContaining({ code: 'MAIL_CONVERSATION_CLOSED' }),
    )
  })

  it('reopens a resolved conversation only when asked explicitly', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putConversation(conversationFixture({ status: 'resolved' }))
    await expect(recordOutbound(store, 'conv-1', 'pm-2', 'hi', counter(), 10)).rejects.toThrowError(
      expect.objectContaining({ code: 'MAIL_CONVERSATION_CLOSED' }),
    )
    const reopened = await setConversationStatus(store, 'conv-1', 'active')
    expect(reopened.status).toBe('active')
    const event = await recordOutbound(store, 'conv-1', 'pm-2', 'hi', counter(), 10)
    expect(event.direction).toBe('outbound')
  })

  it('refuses a reply to a conversation that does not exist', async () => {
    const store = fakeStore(fakeDomain())
    await expect(recordOutbound(store, 'conv-x', 'pm-2', 'hi', counter(), 10)).rejects.toThrowError(
      expect.objectContaining({ code: 'MAIL_CONVERSATION_NOT_FOUND' }),
    )
  })

  it('orders a conversation by the platform timestamp, not the write order', async () => {
    const domain = fakeDomain()
    const store = fakeStore(domain)
    await store.putConversation(conversationFixture())
    await store.putConversationEvent(conversationEventFixture({ eventId: 'e-2', occurredAt: 20, content: 'second' }))
    await store.putConversationEvent(conversationEventFixture({ eventId: 'e-1', occurredAt: 10, content: 'first' }))
    expect(store.conversationEvents('conv-1').map((event) => event.content)).toEqual(['first', 'second'])
  })
})

describe('mail content', () => {
  it('renders the payload into the body', async () => {
    const rendered = await renderContent({ body: 'Order {{orderId}} paid' }, { orderId: 'o-1' })
    expect(rendered.body).toContain('o-1')
  })

  it('strips executable markup from the rendered body', () => {
    const cleaned = sanitize('<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>')
    expect(cleaned).not.toContain('script')
    expect(cleaned).not.toContain('onerror')
    expect(cleaned).toContain('ok')
  })

  it('drops a javascript: link', () => {
    expect(sanitize('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })

  it('wraps the body in a layout', async () => {
    const rendered = await renderContent({ body: 'inner' }, {}, { layout: '<main>{{body}}</main>' })
    expect(rendered.body).toContain('<main>')
    expect(rendered.body).toContain('inner')
  })
})

describe('mail step conditions', () => {
  it('passes when no condition is declared', () => {
    expect(evaluateConditions(undefined, { payload: {} })).toBe(true)
    expect(evaluateConditions([], { payload: {} })).toBe(true)
  })

  it('reads the payload, the recipient, and the previous step', () => {
    expect(evaluateConditions(
      [{ source: 'payload', field: 'vip', operator: 'equals', value: true }],
      { payload: { vip: true } },
    )).toBe(true)
    expect(evaluateConditions(
      [{ source: 'subscriber', field: 'email', operator: 'exists' }],
      { payload: {}, subscriber: subscriberFixture() },
    )).toBe(true)
    expect(evaluateConditions(
      [{ source: 'previousStep', field: 'status', operator: 'equals', value: 'ok' }],
      { payload: {}, previousStep: { status: 'ok' } },
    )).toBe(true)
  })

  it('fails a condition whose source is missing', () => {
    expect(evaluateConditions(
      [{ source: 'previousStep', field: 'status', operator: 'equals', value: 'ok' }],
      { payload: {} },
    )).toBe(false)
  })

  it('treats the groups as alternatives', () => {
    const filters = [
      { source: 'payload' as const, field: 'a', operator: 'equals' as const, value: 1 },
      { source: 'payload' as const, field: 'b', operator: 'equals' as const, value: 2 },
    ]
    expect(evaluateConditions(filters, { payload: { b: 2 } })).toBe(true)
    expect(evaluateConditions(filters, { payload: { c: 3 } })).toBe(false)
  })
})
