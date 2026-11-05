/**
 * The conversations tab's left pane: search, the kind filter, the room list,
 * and the new-conversation card.
 *
 * The list is a view over the snapshot; search and filter are view state that
 * never reaches the host (design §27.3: filters are presentation, the facts are
 * server-side).
 *
 * 会话页左栏：搜索、类型筛选、房间列表与「新建会话」卡片。
 *
 * 列表是快照上的视图；搜索与筛选属于视图状态，绝不上送宿主（设计 §27.3：筛选是呈现，
 * 事实在服务端）。
 *
 * @module @veren/im-ui/client/rooms-side
 */

import { useState } from 'react'
import { Avatar } from './avatar.tsx'
import { roomStampOf } from './format.ts'
import type { ImKey } from './locales.ts'
import { NewRoomPicker } from './new-room.tsx'
import type { ImPersonView, RoomsSnapshot } from './remote.ts'

/** The list filters the design's seven collapse to in v1. */
type Filter = 'all' | 'unread' | 'direct' | 'group'

/** Props of {@link RoomsSide}. */
export interface RoomsSideProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly onOpenRoom: (roomId: string | undefined) => void
  readonly onCreateRoom: (input: {
    readonly title?: string
    readonly kind?: 'direct' | 'group'
    readonly memberIds?: readonly string[]
  }) => void
}

/** The room list plus search, filter, and the new-room entry. */
export function RoomsSide(props: RoomsSideProps): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const { t, state } = props
  const unreadOf = (roomId: string): number =>
    state.unread.find(count => count.roomId === roomId)?.unread ?? 0
  const rooms = state.rooms.filter(room =>
    matchesFilter(room.kind, unreadOf(room.id), filter)
    && (query.trim() === '' || (room.title ?? '').toLowerCase().includes(query.trim().toLowerCase())))
  return (
    <aside className="im-rooms-side">
      <div className="im-side-head">
        <div className="im-search">
          <input
            className="im-input"
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="im-icon-button"
          aria-label={t('newRoom')}
          title={t('newRoom')}
          onClick={() => setCreating(value => !value)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="im-filters" role="group">
        <FilterButton active={filter === 'all'} label={t('filterAll')} onClick={() => setFilter('all')} />
        <FilterButton active={filter === 'unread'} label={t('filterUnread')} onClick={() => setFilter('unread')} />
        <FilterButton active={filter === 'direct'} label={t('filterDirect')} onClick={() => setFilter('direct')} />
        <FilterButton active={filter === 'group'} label={t('filterGroup')} onClick={() => setFilter('group')} />
      </div>
      {creating && (
        <NewRoomPicker
          t={t}
          people={props.people}
          agentIds={agentIdsOf(state.rooms)}
          onCreate={input => { props.onCreateRoom(input); setCreating(false) }}
          onCancel={() => setCreating(false)}
        />
      )}
      <ul className="im-room-list" role="list">
        {state.status === 'loading' && state.rooms.length === 0 && (
          <>
            <li><span className="im-skeleton im-skeleton-row" aria-hidden="true" /></li>
            <li><span className="im-skeleton im-skeleton-row" aria-hidden="true" /></li>
            <li><span className="im-skeleton im-skeleton-row" aria-hidden="true" /></li>
          </>
        )}
        {rooms.map(room => (
          <li key={room.id}>
            <RoomRow
              title={room.title ?? t('roomUntitled')}
              kind={room.kind}
              agentSeated={room.members.some(id => id.startsWith('agent:'))}
              stamp={roomStampOf(room.updatedAt)}
              members={room.members.length}
              unread={state.unread.find(count => count.roomId === room.id)?.unread ?? 0}
              open={room.id === state.openRoomId}
              t={t}
              onClick={() => props.onOpenRoom(room.id === state.openRoomId ? undefined : room.id)}
            />
          </li>
        ))}
      </ul>
      {rooms.length === 0 && state.rooms.length > 0 && <p className="im-muted">{t('noMatches')}</p>}
    </aside>
  )
}

/** Whether one room passes the active filter. */
function matchesFilter(kind: 'direct' | 'group', unread: number, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'unread') return unread > 0
  return kind === filter
}

/** One room row: avatar, title, and the kind/activity line. */
function RoomRow(props: {
  readonly title: string
  readonly kind: 'direct' | 'group'
  readonly agentSeated: boolean
  readonly stamp: string
  readonly members: number
  readonly unread: number
  readonly open: boolean
  readonly t: (key: ImKey) => string
  readonly onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={props.open ? 'im-room im-room-open' : 'im-room'} onClick={props.onClick}>
      <Avatar name={props.title} kind={props.kind === 'group' || props.agentSeated ? 'agent' : 'human'} size="sm" />
      <span className="im-room-text">
        <span className="im-room-title">{props.title}</span>
        <span className="im-room-meta">
          {props.kind === 'direct' ? props.t('roomDirect') : props.t('roomGroup')} · {props.members}
        </span>
      </span>
      {props.unread > 0
        ? <span className="im-room-unread">{props.unread > 99 ? '99+' : props.unread}</span>
        : <span className="im-room-stamp">{props.stamp}</span>}
    </button>
  )
}

/** One filter chip. */
function FilterButton(props: { readonly active: boolean; readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className={props.active ? 'im-filter im-filter-active' : 'im-filter'} onClick={props.onClick}>
      {props.label}
    </button>
  )
}

/** Every agent id already seated in some room. */
function agentIdsOf(rooms: RoomsSnapshot['rooms']): readonly string[] {
  const ids = new Set<string>()
  for (const room of rooms) for (const id of room.members) if (id.startsWith('agent:')) ids.add(id)
  return [...ids]
}
