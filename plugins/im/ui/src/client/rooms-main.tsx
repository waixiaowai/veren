/**
 * The conversations tab's right pane: room header, timeline, and composer.
 *
 * Presentation only. The composer owns its draft (the design keeps a failed
 * send's text in the input) and hands the body up; the source owns the write.
 *
 * 会话页右栏：房间页头、时间线与输入区。
 *
 * 纯展示。输入区自己持有草稿（设计要求发送失败时正文仍留在输入框），把正文交给上层；
 * 写入由 source 负责。
 *
 * @module @veren/im-ui/client/rooms-main
 */

import { useState } from 'react'
import type { ImKey } from './locales.ts'
import type { ImPersonView, RoomsSnapshot } from './remote.ts'
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
  return (
    <section className="im-rooms-main">
      {open === undefined && <p className="im-muted">{t('roomsPick')}</p>}
      {open !== undefined && (
        <>
          <header className="im-room-head">
            <h2 className="im-heading">{open.title ?? t('roomUntitled')}</h2>
            <p className="im-muted">
              {t('membersLabel')}：{open.members.map(id => participantLabel(id, props.people, t)).join('、')}
            </p>
          </header>
          <Timeline {...props} />
          <Composer {...props} />
        </>
      )}
      {state.status === 'error' && <p className="im-error">{t('errorPrefix')}：{state.error}</p>}
    </section>
  )
}

/** One room's messages, oldest first. */
/** 一个房间的消息，从旧到新。 */
function Timeline(props: RoomsMainProps): React.JSX.Element {
  const { state, t } = props
  return (
    <ol className="im-timeline" role="list">
      {state.messages.map(message => (
        <li key={message.id} className={message.kind === 'system' ? 'im-line im-line-system' : 'im-line'}>
          <span className="im-line-meta">
            #{message.sequence} · {message.kind === 'system'
              ? t('lineSystem')
              : participantLabel(message.authorId, props.people, t)}
          </span>
          <span className="im-line-body">{message.body}</span>
        </li>
      ))}
      {state.messages.length === 0 && <p className="im-muted">{t('timelineEmpty')}</p>}
    </ol>
  )
}

/** The composer: Enter sends, Shift+Enter breaks the line, IME composition never sends. */
/** 输入区：回车发送，Shift+回车换行，输入法组合期间不发送。 */
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
      <textarea
        className="im-input im-composer-input"
        rows={2}
        value={draft}
        placeholder={t('composerPlaceholder')}
        disabled={state.sending}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          void submit()
        }}
      />
      <button type="submit" className="im-button im-button-primary" disabled={state.sending || draft.trim() === ''}>
        {state.sending ? t('sending') : t('send')}
      </button>
    </form>
  )
}
