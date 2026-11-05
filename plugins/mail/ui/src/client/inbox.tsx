/**
 * The inbox view: one filterable list of what reached the station.
 *
 * The list is flat — hairline dividers between rows, no per-row cards — and
 * an unread row is expressed by the dot, the weight, and one quiet badge,
 * never by a tinted background. The row actions live in the meta line's
 * reserved right slot, so they can never cover anything.
 *
 * 收件箱视图：抵达站内的内容的可筛选列表。
 *
 * 列表是扁平的——行间只有发丝分隔线，没有逐行卡片；未读用「圆点 + 字重 + 一枚安静徽标」
 * 表达，绝不用整行底色。行操作住在 meta 行右侧的保留槽位里，物理上不可能遮挡任何内容。
 *
 * @module @veren/mail-ui/client/inbox
 */

import { useState } from 'react'
import type { MailKey } from './locales.ts'
import {
  channelKeyOf,
  deliveryBadgeOf,
  fillCount,
  inboxCounts,
  matchesFilter,
  relativeTimeLabel,
  type InboxFilter,
} from './format.ts'
import type { MailPanelInjected, MailSnapshot, MessageView } from './remote.ts'

/** Everything the inbox needs: the data, the copy, and the actions. / 收件箱所需：数据、文案与动作。 */
export interface InboxViewProps {
  /** The snapshot's messages, newest first. / 快照里的消息，最新在前。 */
  readonly messages: MailSnapshot['messages']
  /** The localized copy. / 本地化文案。 */
  readonly t: (key: MailKey) => string
  /** The panel's callbacks. / 面板回调。 */
  readonly actions: Omit<MailPanelInjected, 'hooks'>
}

/** The three slices the filter tabs offer, in display order. / 筛选页签提供的三个切片，按展示顺序。 */
const FILTERS: readonly InboxFilter[] = ['all', 'unread', 'archived']

/** The dictionary key each slice's tab shows. / 每个切片页签展示的词典键。 */
const FILTER_LABELS: Record<InboxFilter, MailKey> = {
  all: 'filterAll',
  unread: 'filterUnread',
  archived: 'filterArchived',
}

/**
 * The inbox: filter chips, then the matching rows, then the right empty state.
 *
 * 收件箱：筛选芯片、匹配的行、以及正确的空态。
 *
 * @param props - the view's props / 视图属性
 * @returns the view / 视图
 */
export function InboxView(props: InboxViewProps): React.JSX.Element {
  const { messages, t, actions } = props
  const [filter, setFilter] = useState<InboxFilter>('all')
  const counts = inboxCounts(messages)
  const shown = messages.filter((message) => matchesFilter(message, filter))
  if (messages.length === 0) {
    return <EmptyState title={t('inboxEmpty')} sub={t('inboxEmptySub')} />
  }
  return (
    <div className="mail-inbox">
      <FilterTabs counts={counts} filter={filter} t={t} onPick={setFilter} />
      {shown.length === 0
        ? <EmptyState title={t('filterEmpty')} sub={t('filterEmptySub')} />
        : (
            <ul className="mail-list">
              {shown.map((message) => (
                <MessageRow key={message.messageId} message={message} t={t} onMark={actions.onMark} onOpenSession={actions.onOpenSession} now={Date.now()} />
              ))}
            </ul>
          )}
    </div>
  )
}

/**
 * The filter chip row: the three slices, each with its live count.
 *
 * 筛选芯片行：三个切片，各带实时计数。
 *
 * @param props - the row's props / 行属性
 * @returns the row / 行
 */
function FilterTabs(props: {
  readonly counts: ReturnType<typeof inboxCounts>
  readonly filter: InboxFilter
  readonly t: (key: MailKey) => string
  readonly onPick: (filter: InboxFilter) => void
}): React.JSX.Element {
  const { counts, filter, t, onPick } = props
  return (
    <div className="mail-filter" role="group" aria-label={t('filterAll')}>
      {FILTERS.map((slice) => (
        <button
          key={slice}
          type="button"
          className={slice === filter ? 'mail-filter-tab mail-filter-tab-active' : 'mail-filter-tab'}
          aria-pressed={slice === filter}
          onClick={() => { onPick(slice) }}
        >
          {t(FILTER_LABELS[slice])}
          <span className="mail-filter-count">{counts[slice]}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * One inbox message. An unread row shows the dot, the heavier subject, and
 * the quiet badge; everything else stays silent.
 *
 * 一条收件箱消息。未读行显示圆点、更重的标题与一枚安静徽标；其余一切保持沉默。
 *
 * @param props - the row's props / 行属性
 * @returns the row / 行
 */
function MessageRow(props: {
  readonly message: MessageView
  readonly t: (key: MailKey) => string
  readonly onMark: MailPanelInjected['onMark']
  readonly onOpenSession: MailPanelInjected['onOpenSession']
  /** Rendering time, injected so the relative label stays pure. / 渲染时刻，注入以保持相对时间标签纯净。 */
  readonly now: number
}): React.JSX.Element {
  const { message, t, onMark, onOpenSession, now } = props
  const time = relativeTimeLabel(message.createdAt, now)
  const unread = !message.read && !message.archived
  const delivery = deliveryBadgeOf(message)
  return (
    <li className={unread ? 'mail-item mail-item-unread' : 'mail-item'}>
      <div className="mail-item-body">
        <div className="mail-item-top">
          {unread && <span className="mail-unread-dot" aria-hidden="true" />}
          <p className="mail-item-subject">{message.subject ?? message.content}</p>
          {unread && <span className="mail-badge mail-badge-quiet">{t('unread')}</span>}
          {message.archived && <span className="mail-badge mail-badge-quiet">{t('archived')}</span>}
          {delivery !== undefined && <span className={`mail-badge mail-badge-${delivery.tone}`}>{t(delivery.key)}</span>}
        </div>
        {message.subject !== undefined && <p className="mail-item-content">{message.content}</p>}
        <div className="mail-item-meta">
          <span className="mail-item-channel">{t(channelKeyOf(message.channel))}</span>
          <span className="mail-item-time">{fillCount(t(time.key), time.n)}</span>
          <span className="mail-item-spacer" />
          <RowActions message={message} t={t} onMark={onMark} onOpenSession={onOpenSession} />
        </div>
      </div>
    </li>
  )
}

/**
 * The visible-state actions, living in the meta line's reserved right slot:
 * they occupy layout space, so nothing is ever covered. A message that names
 * its source session earns the "open session" jump ahead of the rest.
 *
 * 可见状态操作，住在 meta 行右侧的保留槽位：它们占据布局空间，因此永远不会遮住任何内容。
 * 指明来源会话的消息，把「打开会话」跳转排在其余操作之前。
 *
 * @param props - the actions' props / 操作属性
 * @returns the actions / 操作
 */
function RowActions(props: {
  readonly message: MessageView
  readonly t: (key: MailKey) => string
  readonly onMark: MailPanelInjected['onMark']
  readonly onOpenSession: MailPanelInjected['onOpenSession']
}): React.JSX.Element {
  const { message, t, onMark, onOpenSession } = props
  return (
    <span className="mail-item-actions">
      {message.sourceSessionId !== undefined && (
        <button
          type="button"
          className="mail-action"
          onClick={() => onOpenSession(message.sourceSessionId as string)}
        >
          {t('openSession')}
        </button>
      )}
      <button
        type="button"
        className="mail-action"
        onClick={() => onMark(message.messageId, message.read ? 'unread' : 'read')}
      >
        {message.read ? t('markUnread') : t('markRead')}
      </button>
      <button
        type="button"
        className="mail-action"
        onClick={() => onMark(message.messageId, message.archived ? 'unarchive' : 'archive')}
      >
        {message.archived ? t('unarchive') : t('archive')}
      </button>
    </span>
  )
}

/**
 * The empty state: one main line, one quiet sub line, no illustration.
 *
 * 空态：一行主文案、一行弱色副文案，无插画。
 *
 * @param props - the title and the sub line / 主文案与副文案
 * @returns the empty state / 空态
 */
function EmptyState(props: { readonly title: string; readonly sub: string }): React.JSX.Element {
  return (
    <div className="mail-empty">
      <p className="mail-empty-title">{props.title}</p>
      <p className="mail-empty-sub">{props.sub}</p>
    </div>
  )
}
