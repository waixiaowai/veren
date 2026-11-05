/**
 * The inbox view: one filterable list of what reached the station.
 *
 * The filter is view state (Novu's all / unread / archived slices with
 * counts); archived records stay visible under "all" because archiving
 * never deletes. Rows earn emphasis only when their state earns it — an
 * unread row gets the triple (dot + word + tinted card), a read row stays
 * quiet.
 *
 * 收件箱视图：抵达站内的内容的可筛选列表。
 *
 * 筛选是视图状态（Novu 的 全部 / 未读 / 已归档 切片带计数）；归档从不删除，已归档记录在
 * 「全部」下仍然可见。行只在状态值得强调时才被强调——未读行拿三重表达（点 + 词 + 底色），
 * 已读行保持安静。
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
  messageBadgeOf,
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
 * The inbox: filter tabs, then the matching rows, then the right empty state.
 *
 * 收件箱：筛选页签、匹配的行、以及正确的空态。
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
                <MessageRow key={message.messageId} message={message} t={t} onMark={actions.onMark} now={Date.now()} />
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
 * One inbox message: unread rows earn the triple, archived rows dim, and the
 * actions surface on hover or keyboard focus.
 *
 * 一条收件箱消息：未读行拿三重表达，归档行弱化，操作在悬停或键盘聚焦时浮现。
 *
 * @param props - the row's props / 行属性
 * @returns the row / 行
 */
function MessageRow(props: {
  readonly message: MessageView
  readonly t: (key: MailKey) => string
  readonly onMark: MailPanelInjected['onMark']
  /** Rendering time, injected so the relative label stays pure. / 渲染时刻，注入以保持相对时间标签纯净。 */
  readonly now: number
}): React.JSX.Element {
  const { message, t, onMark, now } = props
  const time = relativeTimeLabel(message.createdAt, now)
  const state = message.archived ? 'mail-item-archived' : !message.read ? 'mail-item-unread' : ''
  const suffix = state === '' ? '' : ` ${state}`
  return (
    <li className={`mail-item${suffix}`}>
      <span className="mail-item-marker" aria-hidden="true" />
      <div className="mail-item-body">
        <div className="mail-item-top">
          <p className="mail-item-subject">{message.subject ?? message.content}</p>
          <MessageBadges message={message} t={t} />
        </div>
        {message.subject !== undefined && <p className="mail-item-content">{message.content}</p>}
        <div className="mail-item-meta">
          <span className="mail-item-channel">{t(channelKeyOf(message.channel))}</span>
          <span className="mail-item-time">{fillCount(t(time.key), time.n)}</span>
        </div>
        <RowActions message={message} t={t} onMark={onMark} />
      </div>
    </li>
  )
}

/**
 * The badges one message earns: its visible state, then its delivery state.
 *
 * 一条消息挣得的徽标：先是可见状态，再是投递状态。
 *
 * @param props - the badges' props / 徽标属性
 * @returns the badges / 徽标
 */
function MessageBadges(props: {
  readonly message: MessageView
  readonly t: (key: MailKey) => string
}): React.JSX.Element {
  const { message, t } = props
  const badge = messageBadgeOf(message)
  const delivery = deliveryBadgeOf(message)
  return (
    <span className="mail-item-badges">
      {badge !== undefined && <span className={`mail-badge mail-badge-${badge.tone}`}>{t(badge.key)}</span>}
      {delivery !== undefined && <span className={`mail-badge mail-badge-${delivery.tone}`}>{t(delivery.key)}</span>}
    </span>
  )
}

/**
 * The visible-state actions: read/unread first, then archive/unarchive.
 *
 * 可见状态操作：先已读/未读，再归档/取消归档。
 *
 * @param props - the actions' props / 操作属性
 * @returns the actions / 操作
 */
function RowActions(props: {
  readonly message: MessageView
  readonly t: (key: MailKey) => string
  readonly onMark: MailPanelInjected['onMark']
}): React.JSX.Element {
  const { message, t, onMark } = props
  return (
    <div className="mail-item-actions">
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
    </div>
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
