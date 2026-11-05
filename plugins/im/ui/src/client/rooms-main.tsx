/**
 * The conversations tab's right pane: the room header, the timeline, and the
 * composer.
 *
 * Presentation only. New messages follow the reader's position (stuck to the
 * bottom or offered as a "jump to latest" pill), and a failed load keeps the
 * pane with a retry action (design §27.4: failures keep context and offer retry).
 *
 * 会话页右栏：房间页头、时间线与输入区。
 *
 * 纯展示。新消息跟随读者的位置（贴底或给出「回到最新」胶囊），读取失败保留上下文并给重试
 * （设计 §27.4：失败保留上下文并给重试）。
 *
 * @module @veren/im-ui/client/rooms-main
 */

import { Composer } from './composer.tsx'
import { ActivityRow } from './activity-row.tsx'
import { visibleActivities } from './activity-filter.ts'
import { Avatar } from './avatar.tsx'
import type { ImKey } from './locales.ts'
import type { ImParticipant } from './remote.ts'
import { MessageRow } from './message-row.tsx'
import { participantLabel } from './participant-label.ts'
import type { ImPersonView, RoomsSnapshot } from './remote.ts'
import { useStickToBottom } from './stick-to-bottom.ts'
import type { RoomActivity } from './turn-remote.ts'

/** Props of {@link RoomsMain}. */
export interface RoomsMainProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
  /** Live turns across every room; the open room's rows render as the working row. */
  /** 所有房间的实时回合；打开房间的那些渲染成工作行。 */
  readonly activities: readonly RoomActivity[]
  readonly onSend: (body: string) => Promise<boolean>
  readonly onRefresh: () => void
}

/** The open room: header, timeline, composer. */
export function RoomsMain(props: RoomsMainProps): React.JSX.Element {
  const { state, t } = props
  const open = state.rooms.find(room => room.id === state.openRoomId)
  if (open === undefined) {
    return <section className="im-rooms-main"><p className="im-muted">{t('roomsPick')}</p></section>
  }
  return (
    <section className="im-rooms-main">
      <RoomHead room={open} props={props} />
      <Timeline {...props} />
      <Composer room={open} t={t} people={props.people} participants={props.participants} sending={state.sending} onSend={props.onSend} />
      {state.status === 'error' && (
        <div className="im-error-row">
          <p className="im-error">{t('errorPrefix')}：{state.error}</p>
          <button type="button" className="im-button" onClick={props.onRefresh}>{t('retry')}</button>
        </div>
      )}
    </section>
  )
}

/** The room header: title, the first four member avatars and the member line. */
function RoomHead({ room, props }: { room: { title?: string, members: readonly string[] }, props: RoomsMainProps }): React.JSX.Element {
  const { t } = props
  return (
    <header className="im-room-head">
      <div className="im-room-head-line">
        <h2 className="im-heading">{room.title ?? t('roomUntitled')}</h2>
        <span className="im-stack">
          {room.members.slice(0, 4).map(id => (
            <Avatar
              key={id}
              name={participantLabel(id, props.people, t, props.participants)}
              kind={id.startsWith('agent:') ? 'agent' : 'human'}
              size="sm"
            />
          ))}
        </span>
      </div>
      <p className="im-room-members">
        {t('membersLabel')}：{room.members.map(id => participantLabel(id, props.people, t, props.participants)).join('、')}
      </p>
    </header>
  )
}

/** The message list with the pinning rule and the jump-to-latest pill. */
function Timeline(props: RoomsMainProps): React.JSX.Element {
  const { state, t } = props
  // 工作行也算新内容：它出现时读者若贴底，应当跟着滚到底。用「消息数:工作行数」作签名，
  // 工作行被回复替换时签名仍会变化，回复因此一定会滚进视野。
  // A working row is new content too: a reader at the bottom follows it. The
  // signature carries both counts, so replacing the row with its reply still
  // changes it and the reply scrolls into view.
  const working = visibleActivities(props.activities, state.messages, state.openRoomId)
  const stick = useStickToBottom(`${state.messages.length}:${working.length}`)
  return (
    <div className="im-timeline-wrap">
      <ol className="im-timeline" role="list" ref={stick.ref}>
        {state.messages.map((message, index) => (
          <MessageRow
            key={message.id}
            message={message}
            startOfDay={index === 0 || !sameDay(message.createdAt, state.messages[index - 1]!.createdAt)}
            t={t}
            people={props.people}
            participants={props.participants}
          />
        ))}
        <WorkingRows working={working} t={t} people={props.people} participants={props.participants} />
        {state.messages.length === 0 && state.status === 'loading' && <SkeletonLines />}
        {state.messages.length === 0 && state.status !== 'loading' && <p className="im-muted">{t('timelineEmpty')}</p>}
      </ol>
      {!stick.pinned && (
        <button type="button" className="im-jump" onClick={stick.jump}>{t('jumpLatest')}</button>
      )}
    </div>
  )
}

/** One working row per live turn in the open room. */
/** 打开房间里每个实时回合一条工作行。 */
function WorkingRows(props: {
  readonly working: readonly RoomActivity[]
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
}): React.JSX.Element {
  return (
    <>
      {props.working.map(activity => (
        <ActivityRow
          key={activity.runId}
          activity={activity}
          t={props.t}
          people={props.people}
          participants={props.participants}
        />
      ))}
    </>
  )
}

/** Three placeholder bubbles while the first read is in flight. */
function SkeletonLines(): React.JSX.Element {
  return (
    <>
      <li className="im-skeleton im-skeleton-wide" aria-hidden="true" />
      <li className="im-skeleton im-skeleton-short" aria-hidden="true" />
      <li className="im-skeleton im-skeleton-mid" aria-hidden="true" />
    </>
  )
}

/** Whether two timestamps fall on the same local day. */
function sameDay(left: number, right: number): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString()
}
