/**
 * The conversations tab: the two-pane workspace with its info rail, or the
 * empty state before the first room exists.
 *
 * 会话页：带信息侧栏的两栏工作区；还没有任何房间时换成空态。
 *
 * @module @veren/im-ui/client/views-rooms
 */

import { EmptyState } from './empty-state.tsx'
import type { ImKey } from './locales.ts'
import type { ImParticipant, ImPersonView, RoomsSnapshot } from './remote.ts'
import { RoomInfo } from './room-info.tsx'
import { RoomsMain } from './rooms-main.tsx'
import { RoomsSide } from './rooms-side.tsx'
import type { RoomActivity } from './turn-remote.ts'

/** Props of {@link RoomsView}: the rooms snapshot plus the locale seat. */
export interface RoomsViewProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
  /** Live turns, so the open room can show its working row. */
  /** 实时回合，打开的房间据此显示工作行。 */
  readonly activities: readonly RoomActivity[]
  readonly onOpenRoom: (roomId: string | undefined) => void
  readonly onRefresh: () => void
  readonly onSend: (body: string) => Promise<boolean>
  readonly onCreateRoom: (input: {
    readonly title?: string
    readonly kind?: 'direct' | 'group'
    readonly memberIds?: readonly string[]
  }) => void
}

/** Render the workspace, or the empty state before the first room exists. */
export function RoomsView(props: RoomsViewProps) {
  if (props.state.status === 'ready' && props.state.rooms.length === 0) {
    return (
      <EmptyState
        title={props.t('emptyTitle')}
        hint={props.t('emptyHint')}
        actionLabel={props.t('newRoom')}
        onAction={() => props.onCreateRoom({})}
      />
    )
  }
  const open = props.state.rooms.find(room => room.id === props.state.openRoomId)
  return (
    <div className="im-rooms">
      <RoomsSide
        state={props.state}
        t={props.t}
        people={props.people}
        participants={props.participants}
        onOpenRoom={props.onOpenRoom}
        onCreateRoom={props.onCreateRoom}
      />
      <div className="im-chat-area">
        <RoomsMain
          state={props.state}
          t={props.t}
          people={props.people}
          participants={props.participants}
          activities={props.activities}
          onSend={props.onSend}
          onRefresh={props.onRefresh}
        />
        {open !== undefined && (
          <RoomInfo room={open} t={props.t} people={props.people} participants={props.participants} />
        )}
      </div>
    </div>
  )
}
