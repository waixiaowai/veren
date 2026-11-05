/**
 * The conversations tab's right pane: the room header, the timeline, and the
 * composer.
 *
 * Presentation only. The composer owns its draft (design §26.3 keeps a failed
 * send's text in the input); the source owns the write.
 *
 * 会话页右栏：房间页头、时间线与输入区。
 *
 * 纯展示。输入区自己持有草稿（设计 §26.3：发送失败时正文留在输入框），写入由 source 负责。
 *
 * @module @veren/im-ui/client/rooms-main
 */

import { useState } from 'react'
import { Avatar } from './avatar.tsx'
import { clockOf, dayLabelOf } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImPersonView, Message, RoomsSnapshot } from './remote.ts'
import { participantLabel } from './participant-label.ts'

/** Props of {@link RoomsMain}. */
export interface RoomsMainProps {
  readonly state: RoomsSnapshot
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly onSend: (body: string) => Promise<boolean>
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
        <div className="im-room-head-line">
          <h2 className="im-heading">{open.title ?? t('roomUntitled')}</h2>
        </div>
        <p className="im-room-members">
          {t('membersLabel')}：{open.members.map(id => participantLabel(id, props.people, t)).join('、')}
        </p>
      </header>
      <Timeline {...props} />
      <Composer {...props} />
      {state.status === 'error' && <p className="im-error">{t('errorPrefix')}：{state.error}</p>}
    </section>
  )
}

/** One room's messages, oldest first, with a divider per day. */
function Timeline(props: RoomsMainProps): React.JSX.Element {
  const { state, t } = props
  return (
    <ol className="im-timeline" role="list">
      {state.messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          startOfDay={index === 0 || !sameDay(message.createdAt, state.messages[index - 1]!.createdAt)}
          t={t}
          people={props.people}
        />
      ))}
      {state.messages.length === 0 && <p className="im-muted">{t('timelineEmpty')}</p>}
    </ol>
  )
}

/** One message row, or the system line, plus its day divider when it starts a day. */
function MessageItem(props: {
  readonly message: Message
  readonly startOfDay: boolean
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
}): React.JSX.Element {
  const { message, t } = props
  const divider = props.startOfDay
    ? <li className="im-day">{dayLabelOf(message.createdAt, t)}</li>
    : null
  if (message.kind === 'system') {
    return <>{divider}<li className="im-line im-line-system"><span className="im-system">{message.body}</span></li></>
  }
  const author = participantLabel(message.authorId, props.people, t)
  const own = message.authorId === 'human:owner'
  const agent = message.authorId.startsWith('agent:')
  return (
    <>
      {divider}
      <li className={own ? 'im-line im-line-own' : 'im-line'}>
        {!own && <Avatar name={author} kind={agent ? 'agent' : 'human'} size="sm" />}
        <span className="im-line-text">
          <span className="im-line-meta">{author} · {clockOf(message.createdAt)}</span>
          <span className={own ? 'im-bubble im-bubble-own' : 'im-bubble'}>{message.body}</span>
        </span>
      </li>
    </>
  )
}

/** The composer: Enter sends, Shift+Enter breaks the line, IME composition never sends. */
function Composer(props: RoomsMainProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const { state, t } = props
  const submit = async (): Promise<void> => {
    const body = draft.trim()
    if (body === '' || state.sending) return
    if (await props.onSend(body)) setDraft('')
  }
  return (
    <form className="im-composer" onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="im-composer-box">
        <textarea
          className="im-composer-input"
          rows={2}
          value={draft}
          placeholder={t('composerPlaceholder')}
          aria-label={t('composerPlaceholder')}
          disabled={state.sending}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void submit()
          }}
        />
        <div className="im-composer-bar">
          <span className="im-hint">{t('composerHint')}</span>
          <button type="submit" className="im-button im-button-primary" disabled={state.sending || draft.trim() === ''}>
            {state.sending ? t('sending') : t('send')}
          </button>
        </div>
      </div>
    </form>
  )
}

/** Whether two timestamps fall on the same local day. */
function sameDay(left: number, right: number): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString()
}
