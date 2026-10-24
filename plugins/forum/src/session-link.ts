/**
 * Where the forum meets the Session machinery the Harness already owns.
 *
 * Two things live here and nothing else: the live map from a preset to the
 * Session currently working for it, and the one function that hands a notice to
 * such a Session as a real user message. A notice handed to a *live* Session is
 * a durable entry in that Session's own log — the recipient reads it in the
 * conversation it already has, using the inbox/prompt path it already has.
 * Nothing is woken implicitly: a preset the user did not start keeps its notice
 * in the durable inbox until the next time it runs.
 *
 * 论坛与 Harness 既有会话机制相接的地方。
 *
 * 这里只有两件事：预设 → 当前为它工作的会话的活映射，以及把一个通知作为真正的用户消息交给
 * 该会话的唯一函数。交给**活着**会话的通知，会成为该会话自身日志里的持久条目——收件人在它
 * 已有的对话里、用它已有的 inbox/提示路径读到它。这里不会隐式唤醒任何会话：用户没有启动的
 * 预设，其通知留在持久化收件箱里，直到它下次运行。
 *
 * @module @veren/forum/session-link
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NotificationRecord } from './domain.ts'
import type { DeliveryOutcome } from './types.ts'
import type { ForumStore } from './storage.ts'
import { inboxOf, notificationTablesOf } from './notifications.ts'
import { inboxLine } from './views.ts'

/** The message-source tag every forum notice carries into a Session log. */
export const FORUM_MESSAGE_SOURCE = 'forum-notification'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A forum mention or reply notice delivered into a Session. @persistenceSource user */
    'forum-notification': { kind: 'forum-notification'; notificationId: string; postId: string }
  }
}

/**
 * Render the model-facing text of one notice.
 *
 * The text names the board, the post, the cause, and the way in: the forum app
 * URL always, plus the page-scoped `forum__*` tools a forum page session holds
 * (the only sessions that carry forum tools since the 0.2 app-only migration).
 * @param record - the stored notification.
 * @param url - the Web GUI URL, so the recipient can point the user at it.
 * @returns the message text.
 */
export function notificationText(record: NotificationRecord, url: string): string {
  const cause = record.reason === 'mention' ? 'mentioned you' : 'replied to you'
  return [
    `[forum] ${record.author} ${cause} on board "${record.boardId}", post ${record.postId}.`,
    record.summary,
    `Open the thread in the forum app: ${url}. In a forum page session, read it with `
      + 'forum__read, answer with forum__comment, and clear notices with forum__inbox.',
  ].join('\n')
}

/** Live mapping between presets and the Sessions working for them. */
export class SessionLink {
  private readonly byPreset = new Map<string, SessionId>()
  private readonly presetOf = new Map<string, string>()

  /**
   * @param ctx - Host services used to reach a live Agent and flush its log.
   * @param url - callback resolving the Web GUI URL printed in each notice.
   */
  constructor(
    private readonly ctx: Context,
    private readonly url: () => string,
  ) {}

  /**
   * Remember which preset one Session works for.
   * @param sessionId - the Session that just started.
   * @param preset - its agent preset, when it has one.
   */
  remember(sessionId: SessionId, preset: string | undefined): void {
    if (preset === undefined || preset === '') return
    this.presetOf.set(sessionId, preset)
    this.byPreset.set(preset, sessionId)
  }

  /**
   * Forget one Session, unless a newer Session already took its preset over.
   * @param sessionId - the Session that left the registry.
   */
  forget(sessionId: SessionId): void {
    const preset = this.presetOf.get(sessionId)
    this.presetOf.delete(sessionId)
    if (preset === undefined) return
    if (this.byPreset.get(preset) === sessionId) this.byPreset.delete(preset)
  }

  /**
   * The preset one Session works for.
   * @param sessionId - the Session to look up.
   * @returns its preset, or `undefined` when it has none recorded.
   */
  presetFor(sessionId: SessionId): string | undefined {
    return this.presetOf.get(sessionId)
  }

  /**
   * The live Session currently working for one preset.
   * @param preset - the preset to look up.
   * @returns its Session id, or `undefined` when none is live.
   */
  sessionFor(preset: string): SessionId | undefined {
    return this.byPreset.get(preset)
  }

  /**
   * Hand one notice to a preset's live Session, as a real user message.
   *
   * A preset with no live Session is not woken: the caller's durable inbox row
   * already reaches it on the next run, so degrading here is honest and costs
   * nothing. A live Session is woken through `followup`, and the delivery is
   * confirmed by flushing the Session log — an unacknowledged message is
   * reported instead of being claimed as delivered.
   * @param record - the stored notification.
   * @returns what the delivery did.
   */
  async wake(record: NotificationRecord): Promise<DeliveryOutcome> {
    const sessionId = this.byPreset.get(record.recipient)
    if (sessionId === undefined) {
      return {
        id: record.id,
        recipient: record.recipient,
        status: 'inboxed',
        detail: `no live session for preset "${record.recipient}"; the notice stays in its durable inbox.`,
      }
    }
    const agent = this.requireAgent(sessionId)
    if (agent === undefined) {
      return {
        id: record.id,
        recipient: record.recipient,
        status: 'inboxed',
        sessionId,
        detail: `session ${sessionId} is no longer live; the notice stays in the durable inbox.`,
      }
    }
    const flushed = await this.handOver(agent, createUserMessage({
      content: [{ type: 'text', text: notificationText(record, this.url()) }],
      source: { kind: FORUM_MESSAGE_SOURCE, notificationId: record.id, postId: record.postId },
    }))
    if (!flushed) {
      return {
        id: record.id,
        recipient: record.recipient,
        status: 'inboxed',
        sessionId,
        detail: `session ${sessionId} did not acknowledge the message; the notice stays in the durable inbox.`,
      }
    }
    return { id: record.id, recipient: record.recipient, status: 'woken', sessionId }
  }

  /**
   * Hand one plain text notice to a preset's live Session, as a real user
   * message. The same delivery contract as {@link wake}, for notices that are
   * not stored rows (the auto-post runner's author notice).
   * 把一条纯文本通知作为真正的用户消息交给预设的活会话。与 {@link wake} 相同的投递契约，
   * 用于不是存储行的通知（自动发帖运行器给作者的回执）。
   * @param recipient - the preset to reach.
   * @param text - the notice body.
   * @returns the delivery outcome.
   */
  async deliverText(recipient: string, text: string): Promise<DeliveryOutcome> {
    const sessionId = this.byPreset.get(recipient)
    const agent = sessionId === undefined ? undefined : this.requireAgent(sessionId)
    if (agent === undefined || sessionId === undefined) {
      return { id: '', recipient, status: 'inboxed', detail: 'no live session for this preset' }
    }
    const flushed = await this.handOver(agent, createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: FORUM_MESSAGE_SOURCE, notificationId: '', postId: '' },
    }))
    return flushed
      ? { id: '', recipient, status: 'woken', sessionId }
      : { id: '', recipient, status: 'inboxed', sessionId, detail: 'session did not acknowledge the message' }
  }

  /**
   * Hand pending notices to a Session that has just started.
   *
   * `inject` adds model-facing context without waking an idle driver, so a
   * Session the user opened but has not prompted yet spends nothing.
   * @param agent - the Agent that just entered the registry.
   * @param records - its preset's pending notices, newest first.
   */
  injectPending(agent: Agent, records: readonly NotificationRecord[]): void {
    if (records.length === 0) return
    const text = records.map(record => notificationText(record, this.url())).join('\n\n')
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: FORUM_MESSAGE_SOURCE, notificationId: records[0]?.id ?? '', postId: records[0]?.postId ?? '' },
    }))
  }

  /** Resolve one Session to its live Agent, when it still has one. `agents` is a declared hard inject of the owning service (G13): the merged face is read directly, never probed. `agents` 是所属服务声明的硬 inject（G13）：直接读合并后的服务面，不做运行期探测。 */
  private requireAgent(sessionId: SessionId): Agent | undefined {
    return this.ctx.agents.get(sessionId)
  }

  /** Hand one user message to a live Agent and report whether its log took it. 把一条用户消息交给活着的 Agent，并报告其日志是否接收。 */
  private async handOver(agent: Agent, message: ReturnType<typeof createUserMessage>): Promise<boolean> {
    agent.followup(message)
    return this.ctx.sessions.flush(agent.session)
  }
}

/**
 * Follow Session creation and disposal, and inject pending notices on start.
 *
 * The forum service calls this once per activation: each new Session for a
 * preset is remembered, and its preset's pending notices are injected as soon
 * as the forum domain finishes opening — a Session that starts before storage
 * is up still receives them. Disposal forgets the Session unless a newer one
 * already took its preset over.
 * 跟随会话的创建与销毁，并在会话启动时注入未送达通知。论坛服务每次激活调用一次：记住每个
 * 预设的新会话，并等论坛域打开完成后注入该预设的未送达通知——先于存储就绪启动的会话也能
 * 收到。销毁时遗忘该会话，除非更新的会话已接管其预设。
 * @param ctx - Host context whose `agent/created` and `agent/disposed` events are followed.
 * @param link - the live preset→Session map to maintain.
 * @param opened - resolves with the open forum domain, or undefined when storage is down.
 */
export function watchSessionLifecycle(
  ctx: Context,
  link: SessionLink,
  opened: Promise<ForumStore | undefined>,
): void {
  ctx.effect(() => {
    const offCreated = ctx.on('agent/created', ({ agent }) => {
      const preset = agent.session.header.agentPreset
      link.remember(agent.session.id, preset)
      void opened.then((domain) => {
        if (domain === undefined || preset === undefined) return undefined
        link.injectPending(agent, inboxOf(notificationTablesOf(domain), preset, 'pending'))
        return undefined
      }, () => undefined)
    })
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => { link.forget(agent.session.id) })
    return () => { offCreated(); offDisposed() }
  }, 'forum.sessions()')
}

/**
 * The one-line prompt context announcing unread notices, or `''`.
 * @param link - the live preset→Session map, resolving the reading Session's preset.
 * @param domain - the open forum domain, or undefined while storage is down.
 * @param sessionId - the Session being assembled.
 * @returns the line, or `''` when there is nothing to announce.
 */
export function promptLine(
  link: SessionLink, domain: ForumStore | undefined, sessionId: SessionId | undefined,
): string {
  if (sessionId === undefined || domain === undefined) return ''
  const preset = link.presetFor(sessionId)
  if (preset === undefined) return ''
  return inboxLine(preset, inboxOf(notificationTablesOf(domain), preset, 'pending').length)
}
