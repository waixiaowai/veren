/**
 * The forum's Session seam: the preset→session map and notice delivery.
 *
 * A notice handed to a live Session must become a real user message with the
 * forum's source tag; a preset with no live Session must not be woken, and a
 * message the Session log refuses to persist must not be reported as delivered.
 * These specs pin exactly those promises, plus the "newer session takes over"
 * rule that keeps a reload from routing notices into a dead conversation.
 *
 * 论坛与会话的接缝：预设→会话映射与通知投递。
 *
 * 交给活会话的通知必须成为带论坛来源标记的真正用户消息；没有活会话的预设不能被唤醒；会话日志
 * 拒绝持久化的消息不能被报告为已投递。这些用例正是钉住这些承诺，以及“新会话接管”规则——它
 * 保证重载后通知不会再被送进已经死掉的对话。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { FORUM_MESSAGE_SOURCE, notificationText, SessionLink } from '../src/session-link.ts'
import type { NotificationRecord } from '../src/domain.ts'

/** One stored notification. 一条已存通知。 */
function notification(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'n1',
    recipient: 'ada',
    author: 'bob',
    reason: 'mention',
    boardId: 'ws-1',
    postId: 'p1',
    summary: 'bob mentioned you in "hello"',
    mode: 'inbox',
    state: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** One fake Agent recording the two inbox operations the link performs. 记录链接所执行两个收件箱操作的假 Agent。 */
function fakeAgent() {
  const followup: Array<{ content: ReadonlyArray<{ text: string }>, source: { kind: string } }> = []
  const inject: Array<{ content: ReadonlyArray<{ text: string }>, source: { kind: string } }> = []
  return {
    followup,
    inject,
    agent: {
      session: { id: 'session-1' },
      followup: (message: typeof followup[number]) => { followup.push(message) },
      inject: (message: typeof inject[number]) => { inject.push(message) },
      // The link only touches `session`, `followup`, and `inject`; the rest of
      // the Agent face is irrelevant to this seam.
      // 链接只触及 `session`、`followup` 与 `inject`；Agent 的其余面与此接缝无关。
    } as unknown as Agent,
  }
}

/** Mount a context whose agents/sessions the spec controls. 挂载由用例控制 agents/sessions 的上下文。 */
function host(options: { agent?: unknown, flushed?: boolean } = {}) {
  const ctx = new Context()
  const flush = vi.fn(async () => options.flushed ?? true)
  ctx.provide('agents', { get: () => options.agent })
  ctx.provide('sessions', { flush })
  return { ctx, flush }
}

describe('notification text / 通知文本', () => {
  it('names the author, board, post, summary, the page tools, and the panel url', () => {
    const text = notificationText(notification(), 'http://127.0.0.1:3080')

    expect(text).toContain('[forum] bob mentioned you')
    expect(text).toContain('board "ws-1"')
    expect(text).toContain('post p1')
    expect(text).toContain('bob mentioned you in "hello"')
    // 只点页面作用域工具（forum__*），不再引用已退役的全局 forum_* 名。
    // / only page-scoped tools (forum__*) are named; the retired global forum_* names are gone.
    expect(text).toContain('forum__read')
    expect(text).toContain('forum__comment')
    expect(text).toContain('forum__inbox')
    expect(text).toContain('forum page session')
    expect(text).not.toMatch(/(?<!_)forum_(list|read|post|comment|vote|inbox)\b/)
    expect(text).toContain('http://127.0.0.1:3080')
  })

  it('says "replied to you" for a reply', () => {
    expect(notificationText(notification({ reason: 'reply' }), '')).toContain('replied to you')
  })
})

describe('preset to session map / 预设到会话的映射', () => {
  it('remembers both directions and forgets one session', () => {
    const { ctx } = host()
    const link = new SessionLink(ctx, () => '')

    link.remember(SessionId('s1'), 'ada')
    expect(link.presetFor(SessionId('s1'))).toBe('ada')
    expect(link.sessionFor('ada')).toBe(SessionId('s1'))

    link.forget(SessionId('s1'))
    expect(link.presetFor(SessionId('s1'))).toBeUndefined()
    expect(link.sessionFor('ada')).toBeUndefined()
  })

  it('ignores a session with no preset', () => {
    const { ctx } = host()
    const link = new SessionLink(ctx, () => '')

    link.remember(SessionId('s1'), undefined)
    link.remember(SessionId('s2'), '')

    expect(link.presetFor(SessionId('s1'))).toBeUndefined()
    expect(link.sessionFor('')).toBeUndefined()
  })

  it('lets a newer session take the preset over without the old one clearing it', () => {
    const { ctx } = host()
    const link = new SessionLink(ctx, () => '')

    link.remember(SessionId('old'), 'ada')
    link.remember(SessionId('new'), 'ada')
    expect(link.sessionFor('ada')).toBe(SessionId('new'))

    link.forget(SessionId('old'))
    expect(link.sessionFor('ada')).toBe(SessionId('new'))

    link.forget(SessionId('new'))
    expect(link.sessionFor('ada')).toBeUndefined()
  })
})

describe('waking one preset / 唤醒一个预设', () => {
  it('leaves the notice in the inbox when no session is live', async () => {
    const { ctx, flush } = host()
    const link = new SessionLink(ctx, () => '')

    await expect(link.wake(notification())).resolves.toMatchObject({
      status: 'inboxed',
      recipient: 'ada',
    })
    expect(flush).not.toHaveBeenCalled()
  })

  it('leaves the notice in the inbox when the mapped session is gone', async () => {
    const { ctx } = host({ agent: undefined })
    const link = new SessionLink(ctx, () => '')
    link.remember(SessionId('s1'), 'ada')

    await expect(link.wake(notification())).resolves.toMatchObject({
      status: 'inboxed',
      sessionId: 's1',
    })
  })

  it('delivers a real user message and confirms it with a flush', async () => {
    const session = fakeAgent()
    const { ctx, flush } = host({ agent: session.agent })
    const link = new SessionLink(ctx, () => 'http://panel')
    link.remember(SessionId('session-1'), 'ada')

    await expect(link.wake(notification())).resolves.toEqual({
      id: 'n1',
      recipient: 'ada',
      status: 'woken',
      sessionId: 'session-1',
    })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(session.followup).toHaveLength(1)
    expect(session.followup[0]?.source.kind).toBe(FORUM_MESSAGE_SOURCE)
    expect(session.followup[0]?.content[0]?.text).toContain('http://panel')
  })

  it('reports an unacknowledged message instead of claiming delivery', async () => {
    const session = fakeAgent()
    const { ctx } = host({ agent: session.agent, flushed: false })
    const link = new SessionLink(ctx, () => '')
    link.remember(SessionId('session-1'), 'ada')

    await expect(link.wake(notification())).resolves.toMatchObject({
      status: 'inboxed',
      detail: expect.stringContaining('did not acknowledge'),
    })
  })
})

describe('injecting pending notices / 注入待读通知', () => {
  it('does nothing when the inbox is empty', () => {
    const session = fakeAgent()
    const { ctx } = host()
    const link = new SessionLink(ctx, () => '')

    link.injectPending(session.agent, [])
    expect(session.inject).toHaveLength(0)
  })

  it('joins every pending notice into one injected message', () => {
    const session = fakeAgent()
    const { ctx } = host()
    const link = new SessionLink(ctx, () => '')
    const records = [
      notification({ id: 'n1', summary: 'first' }),
      notification({ id: 'n2', summary: 'second', reason: 'reply' }),
    ]

    link.injectPending(session.agent, records)

    expect(session.inject).toHaveLength(1)
    const text = session.inject[0]?.content[0]?.text ?? ''
    expect(text).toContain('first')
    expect(text).toContain('second')
    expect(text.split('\n\n')).toHaveLength(2)
    expect(session.inject[0]?.source.kind).toBe(FORUM_MESSAGE_SOURCE)
  })
})