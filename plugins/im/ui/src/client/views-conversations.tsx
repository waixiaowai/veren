/**
 * The conversations tab: every known conversation with its queue state.
 *
 * Bindings are gone (2.1.8) — the gateway holds a private session per
 * conversation, so a row shows the human's name, how many messages are queued
 * or consuming, and the newest message's outcome. The people directory
 * resolves each conversation to a person so a row reads "杨明明 · 处理中",
 * not a raw p2p id; the raw id survives as the hover title.
 *
 * 会话页签：每个已知会话及其队列状态。
 *
 * 绑定已删除（2.1.8）——网关按会话私有持有 Session，行展示人名、排队/消费中的条数与
 * 最新消息的结局。人员目录把每个会话解析成人，行读作「杨明明 · 处理中」而不是裸
 * p2p id；裸 id 保留为悬停标题。
 *
 * @module @veren/im-ui/client/views-conversations
 */

import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import type { ImConversationView } from './remote.ts'

/** The conversations tab body, newest activity first. */
export function ConversationsView(props: ImBodyProps): React.JSX.Element {
  const { state, t } = props
  const names = nameDirectoryOf(state)
  const rows = [...state.catalog.conversations]
    .sort((left, right) => (right.lastReceivedAt ?? 0) - (left.lastReceivedAt ?? 0))
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('conversations')}</h2>
      <p className="im-muted">{t('conversationsHint')}</p>
      {rows.length === 0 && <p className="im-muted">{t('noConversations')}</p>}
      <ul className="im-list">
        {rows.map(row => (
          <ConversationRow key={row.conversationId} row={row} name={names.get(row.conversationId)} t={t} />
        ))}
      </ul>
    </section>
  )
}

/** One conversation row: name, queue depth, newest outcome. */
function ConversationRow(props: {
  readonly row: ImConversationView
  readonly name: string | undefined
  readonly t: (key: ImKey) => string
}): React.JSX.Element {
  const { row, name, t } = props
  const label = name ?? row.conversationId
  return (
    <li className="im-card" title={row.conversationId}>
      <span className="im-avatar">{initialOf(label)}</span>
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-strong">{label}</span>
          {row.pending > 0 && (
            <span className="im-badge im-badge-on">{row.pending} {t('pendingSuffix')}</span>
          )}
          {row.lastStatus !== undefined && (
            <span className="im-badge">{statusLabel(row.lastStatus, t)}</span>
          )}
        </div>
        {row.lastExcerpt !== undefined && <div className="im-muted">{row.lastExcerpt}</div>}
      </div>
    </li>
  )
}

/** One queue status in human words. */
function statusLabel(status: ImConversationView['lastStatus'] & string, t: (key: ImKey) => string): string {
  switch (status) {
    case 'queued': return t('statusQueued')
    case 'consuming': return t('statusConsuming')
    case 'replied': return t('statusReplied')
    case 'failed': return t('statusFailed')
    case 'dead': return t('statusDead')
    default: return status
  }
}

/**
 * conversationId → the person's display name, from the directory's addresses.
 * 会话 id → 人员显示名，来自目录里的可达地址。
 */
function nameDirectoryOf(state: ImBodyProps['state']): Map<string, string> {
  const names = new Map<string, string>()
  for (const person of state.catalog.people) {
    for (const address of person.addresses) {
      if (!names.has(address.conversationId)) names.set(address.conversationId, person.displayName)
    }
  }
  return names
}

/** The avatar's single character. */
function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
