/**
 * The agents tab: the roster derived from room seats, with the counters the
 * page can honestly show (agent count, room count, unread count) and one action
 * per card that opens or starts a direct conversation.
 *
 * The reference product also shows presence (working / thinking / online /
 * resting); this host exposes no presence fact yet, so the page does not invent
 * one — the counters are all derived from durable room data.
 *
 * 智能体页签：从房间座位推导出的名册，只显示页面能诚实给出的计数（智能体数、会话数、
 * 未读数）与每张卡片的「聊天」动作（打开或新建一个私聊）。
 *
 * 参考产品还有在场态（工作/思考/在线/休息）；本宿主尚未暴露在场事实，因此页面不虚构，
 * 计数全部来自持久房间数据。
 *
 * @module @veren/im-ui/client/views-agents
 */

import { useMemo } from 'react'
import { Avatar } from './avatar.tsx'
import { fill, roomStampOf } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import type { ImPersonView, Room } from './remote.ts'
import { participantLabel } from './participant-label.ts'

/** Props of the agents tab: the body face plus the room actions. */
export interface AgentsViewProps extends ImBodyProps {
  readonly rooms: readonly Room[]
  readonly unread: number
  readonly onOpenRoom: (roomId: string) => void
  readonly onCreateRoom: (input: { readonly agentId?: string }) => void
}

/** One agent seat: how many rooms seat it and when it last moved. */
interface AgentSeat {
  readonly id: string
  readonly rooms: readonly string[]
  readonly lastActive: number
}

/** Collect every agent seat across the rooms. */
function seatsOf(rooms: readonly Room[]): readonly AgentSeat[] {
  const seats = new Map<string, { rooms: string[]; lastActive: number }>()
  for (const room of rooms) {
    for (const id of room.members) {
      if (!id.startsWith('agent:')) continue
      const seat = seats.get(id) ?? { rooms: [], lastActive: 0 }
      seat.rooms.push(room.id)
      seat.lastActive = Math.max(seat.lastActive, room.updatedAt)
      seats.set(id, seat)
    }
  }
  return [...seats.entries()]
    .map(([id, seat]) => ({ id, rooms: seat.rooms, lastActive: seat.lastActive }))
    .sort((left, right) => right.lastActive - left.lastActive)
}

/** The agents tab body. */
export function AgentsView(props: AgentsViewProps): React.JSX.Element {
  const { t, rooms } = props
  const seats = useMemo(() => seatsOf(rooms), [rooms])
  const unreadTotal = props.unread
  return (
    <section className="im-section">
      <div className="im-hero">
        <h2 className="im-display">
          {fill(t('headingTeam'), { n: seats.length })}
        </h2>
        <p className="im-hero-sub">{t('agentsHint')}</p>
      </div>
      <div className="im-summary-row">
        <Summary text={fill(t('summaryAgents'), { n: seats.length })} />
        <Summary text={fill(t('summaryRooms'), { n: rooms.length })} />
        <Summary text={fill(t('summaryUnread'), { n: unreadTotal })} />
      </div>
      {seats.length === 0 && (
        <div className="im-empty-inline">
          <h3 className="im-heading">{t('noAgents')}</h3>
          <p className="im-muted">{t('noAgentsHint')}</p>
        </div>
      )}
      <ul className="im-card-grid" role="list">
        {seats.map(seat => (
          <AgentCard
            key={seat.id}
            seat={seat}
            rooms={rooms}
            people={props.state.catalog.people}
            t={t}
            onOpenRoom={props.onOpenRoom}
            onCreateRoom={props.onCreateRoom}
          />
        ))}
      </ul>
    </section>
  )
}

/** One summary chip. */
function Summary(props: { readonly text: string }): React.JSX.Element {
  return <span className="im-summary">{props.text}</span>
}

/** One agent card: identity, seat facts, and the chat action. */
function AgentCard(props: {
  readonly seat: AgentSeat
  readonly rooms: readonly Room[]
  readonly people: readonly ImPersonView[]
  readonly t: (key: ImKey) => string
  readonly onOpenRoom: (roomId: string) => void
  readonly onCreateRoom: (agentId: string) => void
}): React.JSX.Element {
  const { seat, t } = props
  const name = participantLabel(seat.id, props.people, t)
  const room = props.rooms.find(candidate => candidate.id === seat.rooms[0])
  const role = seat.id === 'agent:default' ? t('agentRoleDefault') : t('agentRole')
  return (
    <li className="im-card im-agent-card">
      <Avatar name={name} kind="agent" />
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-name">{name}</span>
          <span className="im-badge">{role}</span>
        </div>
        <div className="im-chip-row">
          <span className="im-chip">{fill(t('agentRooms'), { n: seat.rooms.length })}</span>
          {seat.lastActive > 0 && (
            <span className="im-chip">{fill(t('agentLastActive'), { time: roomStampOf(seat.lastActive) })}</span>
          )}
        </div>
        <div className="im-card-actions">
          <button
            type="button"
            className="im-button im-button-primary"
            onClick={() => { if (room === undefined) props.onCreateRoom({ agentId: seat.id }); else props.onOpenRoom(room.id) }}
          >
            {t('chatAction')}
          </button>
        </div>
      </div>
    </li>
  )
}
