/**
 * The conversations tab's left pane: the room list and the "new conversation"
 * entry.
 *
 * Pure presentation over the rooms observable: it owns only the new-room form's
 * open/title state and never touches `ctx`.
 *
 * 会话页左栏：房间列表与「新建会话」入口。
 *
 * 纯展示组件，只持有新建表单的开关与标题状态，不碰 `ctx`。
 *
 * @module @veren/im-ui/client/rooms-side
 */

import { useState } from 'react'
import type { ImKey } from './locales.ts'
import type { RoomsSnapshot } from './remote.ts'

/** Props of {@link RoomsSide}. */
export interface RoomsSideProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly onOpenRoom: (roomId: string | undefined) => void
  readonly onCreateRoom: (title: string | undefined) => void
}

/** The room list plus the new-room entry. */
export function RoomsSide(props: RoomsSideProps): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  return (
    <aside className="im-rooms-side">
      <div className="im-row im-row-split">
        <h2 className="im-heading">{props.t('tabRooms')}</h2>
        <button type="button" className="im-button im-button-primary" onClick={() => setCreating(value => !value)}>
          {props.t('newRoom')}
        </button>
      </div>
      {creating && (
        <NewRoomForm t={props.t} onCreate={title => { props.onCreateRoom(title); setCreating(false) }} />
      )}
      <ul className="im-room-list" role="list">
        {props.state.rooms.map(room => (
          <li key={room.id}>
            <button
              type="button"
              className={room.id === props.state.openRoomId ? 'im-room im-room-open' : 'im-room'}
              onClick={() => props.onOpenRoom(room.id === props.state.openRoomId ? undefined : room.id)}
            >
              <span className="im-room-title">{room.title ?? props.t('roomUntitled')}</span>
              <span className="im-room-kind">
                {room.kind === 'direct' ? props.t('roomDirect') : props.t('roomGroup')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {props.state.rooms.length === 0 && props.state.status === 'ready' && (
        <p className="im-muted">{props.t('roomsEmpty')}</p>
      )}
    </aside>
  )
}

/** The new-room form: one optional title, then create. */
/** 新建会话表单：一个可选标题，然后创建。 */
function NewRoomForm(props: {
  readonly t: (key: ImKey) => string
  readonly onCreate: (title: string | undefined) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const submit = (): void => {
    const trimmed = title.trim()
    props.onCreate(trimmed === '' ? undefined : trimmed)
  }
  return (
    <form
      className="im-newroom"
      onSubmit={event => { event.preventDefault(); submit() }}
    >
      <input
        className="im-input"
        value={title}
        placeholder={props.t('roomTitlePlaceholder')}
        onChange={event => setTitle(event.target.value)}
      />
      <p className="im-muted">{props.t('newRoomHint')}</p>
      <button type="submit" className="im-button im-button-primary">{props.t('createRoom')}</button>
    </form>
  )
}
