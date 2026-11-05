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
import type { ImKey } from './locales.ts'
import { MessageRow } from './message-row.tsx'
import { participantLabel } from './participant-label.ts'
import type { ImPersonView, RoomsSnapshot } from './remote.ts'
import { useStickToBottom } from './stick-to-bottom.ts'

/** Props of {@link RoomsMain}. */
export interface RoomsMainProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
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
      <header className="im-room-head">
        <h2 className="im-heading">{open.title ?? t('roomUntitled')}</h2>
        <p className="im-room-members">
          {t('membersLabel')}：{open.members.map(id => participantLabel(id, props.people, t)).join('、')}
        </p>
      </header>
      <Timeline {...props} />
      <Composer room={open} t={t} people={props.people} sending={state.sending} onSend={props.onSend} />
      {state.status === 'error' && (
        <div className="im-error-row">
          <p className="im-error">{t('errorPrefix')}：{state.error}</p>
          <button type="button" className="im-button" onClick={props.onRefresh}>{t('retry')}</button>
        </div>
      )}
    </section>
  )
}

/** The message list with the pinning rule and the jump-to-latest pill. */
function Timeline(props: RoomsMainProps): React.JSX.Element {
  const { state, t } = props
  const stick = useStickToBottom(state.messages.length)
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
          />
        ))}
        {state.messages.length === 0 && state.status === 'loading' && <SkeletonLines />}
        {state.messages.length === 0 && state.status !== 'loading' && <p className="im-muted">{t('timelineEmpty')}</p>}
      </ol>
      {!stick.pinned && (
        <button type="button" className="im-jump" onClick={stick.jump}>{t('jumpLatest')}</button>
      )}
    </div>
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
