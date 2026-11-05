/**
 * The conversation info rail: kind, creation time, the seated members, and the
 * invite control every group room carries.
 *
 * Mirrors the design's right slot (a single panel at a time); v1 shows the room
 * facts the host already exposes — nothing inferred, no presence state.
 *
 * 会话信息侧栏：类型、创建时间、已入座成员，以及每个群聊都带的邀请控件。
 *
 * 对应设计里的右槽（同一时刻只一个面板）；v1 只显示宿主已经暴露的房间事实——不推断、
 * 不虚构在线状态。
 *
 * @module @veren/im-ui/client/room-info
 */

import { Avatar } from './avatar.tsx'
import { roomStampOf } from './format.ts'
import { InviteMembers } from './invite-members.tsx'
import type { ImKey } from './locales.ts'
import type { ImParticipant, ImPersonView, Room } from './remote.ts'
import { participantLabel } from './participant-label.ts'

/** Props of {@link RoomInfo}. */
export interface RoomInfoProps {
  readonly room: Room
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
  /** Seat picked ids into this room; the rail only offers it for a group. */
  /** 让选中的 id 进入这个房间；侧栏只对群聊提供。 */
  readonly onInvite: (roomId: string, memberIds: readonly string[]) => Promise<boolean>
}

/** One room's information panel. */
export function RoomInfo(props: RoomInfoProps): React.JSX.Element {
  const { room, t, people, participants } = props
  return (
    <aside className="im-room-rail">
      <h3 className="im-heading">{t('roomInfo')}</h3>
      <RoomFacts room={room} t={t} />
      <h4 className="im-info-sub">{t('membersLabel')}</h4>
      <SeatedMembers room={room} t={t} people={people} participants={participants} />
      <InviteMembers
        room={room}
        t={t}
        people={people}
        participants={participants}
        onInvite={props.onInvite}
      />
    </aside>
  )
}

/** The fact rows: the room kind and its creation stamp. */
function RoomFacts(props: { readonly room: Room, readonly t: (key: ImKey) => string }): React.JSX.Element {
  const { room, t } = props
  return (
    <dl className="im-info">
      <div className="im-info-row">
        <dt>{t('roomKindLabel')}</dt>
        <dd>{room.kind === 'direct' ? t('roomDirect') : t('roomGroup')}</dd>
      </div>
      <div className="im-info-row">
        <dt>{t('roomCreatedLabel')}</dt>
        <dd>{roomStampOf(room.createdAt)}</dd>
      </div>
    </dl>
  )
}

/** The seated member list, one row per participant. */
function SeatedMembers(props: {
  readonly room: Room
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
}): React.JSX.Element {
  const { room, t, people, participants } = props
  return (
    <ul className="im-member-list" role="list">
      {room.members.map(id => (
        <li key={id} className="im-member">
          <Avatar name={participantLabel(id, people, t, participants)} kind={id.startsWith('agent:') ? 'agent' : 'human'} size="sm" glyph />
          <span>{participantLabel(id, people, t, participants)}</span>
        </li>
      ))}
    </ul>
  )
}
