/**
 * The agents tab: the deployment's participants as cards.
 *
 * An agent *is* a DSH preset (`agent:<presetId>`), so the roster comes from the
 * host's participant list — every declared preset appears, whether or not it has
 * joined a room yet. Room counts and last activity are joined from the rooms
 * this page already polls; the reference product's presence counters are absent
 * because the host publishes no presence fact.
 *
 * 智能体页签：把部署的参与者渲染成卡片。
 *
 * 智能体就是 DSH preset（`agent:<presetId>`），所以名册来自宿主的参与者列表——声明的
 * preset 无论是否进过房间都会出现。会话数与最近活动从本页已轮询的房间数据里连接；参考产品
 * 的在场计数没有实现，因为宿主尚未发布在场事实。
 *
 * @module @veren/im-ui/client/views-agents
 */

import { useMemo } from 'react'
import { Avatar } from './avatar.tsx'
import { fill, roomStampOf } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import { participantLabel } from './participant-label.ts'
import type { ImParticipant, ImPersonView, Room } from './remote.ts'

/** Props of the agents tab: the body face plus the room actions. */
export interface AgentsViewProps extends ImBodyProps {
  readonly rooms: readonly Room[]
  readonly participants: readonly ImParticipant[]
  readonly unread: number
  readonly onOpenRoom: (roomId: string) => void
  readonly onCreateRoom: (input: {
    readonly title?: string
    readonly kind: 'direct'
    readonly memberIds: readonly string[]
  }) => void
}

/** One agent card's facts: identity plus the rooms it sits in. */
interface AgentCardModel {
  readonly id: string
  readonly name: string
  readonly presetId?: string
  readonly description?: string
  readonly roomCount: number
  readonly lastActive: number
  readonly directRoom?: Room
}

/** Join the roster with the rooms to build one card per agent. */
function cardsOf(
  participants: readonly ImParticipant[],
  rooms: readonly Room[],
  people: readonly ImPersonView[],
  t: (key: ImKey) => string,
): readonly AgentCardModel[] {
  return participants
    .filter(participant => participant.kind === 'agent')
    .map(participant => {
      const seated = rooms.filter(room => room.members.includes(participant.id))
      const direct = seated.find(room => room.kind === 'direct')
      return {
        id: participant.id,
        name: participantLabel(participant.id, people, t, participants),
        ...(participant.presetId === undefined ? {} : { presetId: participant.presetId }),
        ...(participant.description === undefined ? {} : { description: participant.description }),
        roomCount: seated.length,
        lastActive: seated.reduce((latest, room) => Math.max(latest, room.updatedAt), 0),
        ...(direct === undefined ? {} : { directRoom: direct }),
      }
    })
}

/** The agents tab body. */
export function AgentsView(props: AgentsViewProps): React.JSX.Element {
  const { t, rooms } = props
  const cards = useMemo(
    () => cardsOf(props.participants, rooms, props.state.catalog.people, t),
    [props.participants, rooms, props.state.catalog.people, t],
  )
  return (
    <section className="im-section">
      <div className="im-hero">
        <h2 className="im-display">{fill(t('headingTeam'), { n: cards.length })}</h2>
        <p className="im-hero-sub">{t('agentsHint')}</p>
      </div>
      <div className="im-summary-row">
        <Summary text={fill(t('summaryAgents'), { n: cards.length })} />
        <Summary text={fill(t('summaryRooms'), { n: rooms.length })} />
        <Summary text={fill(t('summaryUnread'), { n: props.unread })} />
      </div>
      <ul className="im-card-grid" role="list">
        {cards.map(card => (
          <AgentCard
            key={card.id}
            card={card}
            t={t}
            onOpen={roomId => props.onOpenRoom(roomId)}
            onStart={() => props.onCreateRoom({ title: card.name, kind: 'direct', memberIds: ['human:owner', card.id] })}
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
  readonly card: AgentCardModel
  readonly t: (key: ImKey) => string
  readonly onOpen: (roomId: string) => void
  readonly onStart: () => void
}): React.JSX.Element {
  const { card, t } = props
  const role = card.presetId === undefined ? t('agentRoleDefault') : `${t('agentPreset')} · ${card.presetId}`
  return (
    <li className="im-card im-agent-card">
      <Avatar name={card.name} kind="agent" size="lg" />
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-name">{card.name}</span>
          <span className="im-badge">{role}</span>
        </div>
        {card.description !== undefined && <p className="im-quote">{card.description}</p>}
        <div className="im-chip-row">
          <span className="im-chip">{fill(t('agentRooms'), { n: card.roomCount })}</span>
          {card.lastActive > 0 && (
            <span className="im-chip">{fill(t('agentLastActive'), { time: roomStampOf(card.lastActive) })}</span>
          )}
        </div>
        <div className="im-card-actions">
          <button
            type="button"
            className="im-button im-button-primary"
            onClick={() => { if (card.directRoom === undefined) props.onStart(); else props.onOpen(card.directRoom.id) }}
          >
            {t('chatAction')}
          </button>
        </div>
      </div>
    </li>
  )
}
