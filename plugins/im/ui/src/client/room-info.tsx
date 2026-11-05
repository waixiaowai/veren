/**
 * The conversation info rail: kind, creation time, and the seated members.
 *
 * Mirrors the design's right slot (a single panel at a time); v1 shows the room
 * facts the host already exposes — nothing inferred, no presence state.
 *
 * 会话信息侧栏：类型、创建时间与已入座成员。
 *
 * 对应设计里的右槽（同一时刻只一个面板）；v1 只显示宿主已经暴露的房间事实——不推断、
 * 不虚构在线状态。
 *
 * @module @veren/im-ui/client/room-info
 */

import { Avatar } from './avatar.tsx'
import { roomStampOf } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImPersonView, Room } from './remote.ts'
import { participantLabel } from './participant-label.ts'

/** Props of {@link RoomInfo}. */
export interface RoomInfoProps {
  readonly room: Room
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
}

/** One room's information panel. */
export function RoomInfo(props: RoomInfoProps): React.JSX.Element {
  const { room, t, people } = props
  return (
    <aside className="im-room-rail">
      <h3 className="im-heading">{t('roomInfo')}</h3>
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
      <h4 className="im-info-sub">{t('membersLabel')}</h4>
      <ul className="im-member-list" role="list">
        {room.members.map(id => (
          <li key={id} className="im-member">
            <Avatar name={participantLabel(id, people, t)} kind={id.startsWith('agent:') ? 'agent' : 'human'} size="sm" glyph />
            <span>{participantLabel(id, people, t)}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
