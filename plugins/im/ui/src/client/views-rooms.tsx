/**
 * The conversations tab: the room list on the left, the open room's timeline
 * on the right. A pure presentation component over the rooms observable; it
 * holds no state and never touches `ctx`.
 *
 * 会话页：左侧房间列表，右侧打开房间的时间线。纯展示组件，由 rooms 可观察对象驱动；
 * 不持有状态，不碰 `ctx`。
 *
 * @module @veren/im-ui/client/views-rooms
 */

import type { ImKey } from './locales.ts'
import type { RoomsSnapshot } from './remote.ts'

/** Props of {@link RoomsView}: the resolved inject face plus the locale bind. */
export interface RoomsViewProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly onOpenRoom: (roomId: string | undefined) => void
  readonly onRefresh: () => void
}

/** Render the two-pane rooms view. */
export function RoomsView(props: RoomsViewProps) {
  return (
    <div className="im-rooms">
      <RoomsSide {...props} />
      <RoomsMain {...props} />
    </div>
  )
}

/** The left pane: the room list. */
/** 左侧面板：房间列表。 */
function RoomsSide(props: RoomsViewProps) {
  const { state, t } = props
  return (
    <div className="im-rooms-side">
      <ul className="im-room-list" role="list">
        {state.rooms.map(room => (
          <li key={room.id}>
            <button
              type="button"
              className={room.id === state.openRoomId ? 'im-room im-room-open' : 'im-room'}
              onClick={() => props.onOpenRoom(room.id === state.openRoomId ? undefined : room.id)}
            >
              <span className="im-room-title">{room.title ?? room.id}</span>
              <span className="im-room-kind">{room.kind === 'direct' ? t('roomDirect') : t('roomGroup')}</span>
            </button>
          </li>
        ))}
      </ul>
      {state.rooms.length === 0 && state.status === 'ready' && (
        <p className="im-muted">{t('roomsEmpty')}</p>
      )}
    </div>
  )
}

/** The right pane: the open room's timeline (or the pick hint). */
/** 右侧面板：打开房间的时间线（或选择提示）。 */
function RoomsMain(props: RoomsViewProps) {
  const { state, t } = props
  return (
    <div className="im-rooms-main">
      {state.openRoomId === undefined && <p className="im-muted">{t('roomsPick')}</p>}
      {state.openRoomId !== undefined && <Timeline {...props} />}
      {state.status === 'error' && <p className="im-error">{t('errorPrefix')}：{state.error}</p>}
      <button type="button" className="im-button" onClick={props.onRefresh}>{t('refresh')}</button>
    </div>
  )
}

/** One room's messages, oldest first. */
/** 一个房间的消息，从旧到新。 */
function Timeline(props: RoomsViewProps) {
  const { state, t } = props
  return (
    <>
      <ol className="im-timeline" role="list">
        {state.messages.map(message => (
          <li key={message.id} className={message.kind === 'system' ? 'im-line im-line-system' : 'im-line'}>
            <span className="im-line-meta">
              #{message.sequence} · {message.kind === 'system' ? t('lineSystem') : message.authorId}
            </span>
            <span className="im-line-body">{message.body}</span>
          </li>
        ))}
      </ol>
      {state.messages.length === 0 && <p className="im-muted">{t('timelineEmpty')}</p>}
    </>
  )
}
