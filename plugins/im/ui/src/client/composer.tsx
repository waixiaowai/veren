/**
 * The composer: Enter sends, Shift+Enter breaks the line, IME composition never
 * sends, and typing `@` opens the room's member picker (↑↓ to move, Enter to
 * accept, Escape to dismiss). The draft survives a failed send (design §26.3).
 *
 * 输入区：回车发送、Shift+回车换行、输入法组合期间不发送；输入 `@` 打开房间成员选择器
 * （↑↓ 移动、回车选中、Esc 关闭）。发送失败时草稿仍留在输入框（设计 §26.3）。
 *
 * @module @veren/im-ui/client/composer
 */

import { useMemo, useState } from 'react'
import type { ImKey } from './locales.ts'
import type { ImParticipant, ImPersonView, Room } from './remote.ts'
import { participantLabel } from './participant-label.ts'

/** The trailing mention token being typed, if any. */
const TRAILING_MENTION = /(^|\s)@([^\s@]*)$/u

/** Props of {@link Composer}. */
export interface ComposerProps {
  readonly room: Room
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
  readonly sending: boolean
  readonly onSend: (body: string) => Promise<boolean>
}

/** One mention candidate. */
interface Candidate {
  readonly label: string
  readonly id: string
}

/** The framed input with its send button and mention picker. */
export function Composer(props: ComposerProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [picked, setPicked] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const { t, room } = props
  const candidates = useMemo(
    () => room.members
      .filter(id => id !== 'human:owner')
      .map(id => ({ id, label: participantLabel(id, props.people, t, props.participants) })),
    [room.members, props.people, props.participants, t],
  )
  const matches = mentionMatches(draft, candidates, dismissed)
  const submit = useSubmit(props, draft, setDraft)
  const accept = useAccept(draft, setDraft, setPicked)
  return (
    <form className="im-composer" onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="im-composer-box">
        <ComposerInput props={props} draft={draft} setDraft={setDraft} matches={matches} picked={picked} setPicked={setPicked} setDismissed={setDismissed} accept={accept} submit={submit} />
        <ComposerBar props={props} draft={draft} />
      </div>
      {matches.length > 0 && (
        <MentionList matches={matches} picked={picked} t={t} accept={accept} />
      )}
    </form>
  )
}

/** The mention candidates matching the trailing `@` query; dismissed hides them. / The mention candidates matching the trailing `@` query; dismissed hides them. */
function mentionMatches(draft: string, candidates: readonly Candidate[], dismissed: boolean): readonly Candidate[] {
  const query = TRAILING_MENTION.exec(draft)?.[2]
  if (query === undefined || dismissed) return []
  return candidates.filter(candidate => candidate.label.toLowerCase().includes(query.toLowerCase()))
}

/** Send the trimmed draft; a failed send keeps it (design §26.3). / Send the trimmed draft; a failed send keeps it (design §26.3). */
function useSubmit(props: ComposerProps, draft: string, setDraft: (draft: string) => void): () => Promise<void> {
  return async () => {
    const body = draft.trim()
    if (body === '' || props.sending) return
    if (await props.onSend(body)) setDraft('')
  }
}

/** Replace the trailing mention token with the picked candidate's label. / Replace the trailing mention token with the picked candidate's label. */
function useAccept(draft: string, setDraft: (draft: string) => void, setPicked: (picked: number) => void): (candidate: Candidate) => void {
  return (candidate) => {
    setDraft(draft.replace(TRAILING_MENTION, (_match: string, lead: string) => `${lead}@${candidate.label} `))
    setPicked(0)
  }
}

/** The textarea: draft value, mention-aware keys and the IME guard. */
function ComposerInput(props: {
  readonly props: ComposerProps
  readonly draft: string
  readonly setDraft: (draft: string) => void
  readonly matches: readonly Candidate[]
  readonly picked: number
  readonly setPicked: (picked: number) => void
  readonly setDismissed: (dismissed: boolean) => void
  readonly accept: (candidate: Candidate) => void
  readonly submit: () => Promise<void>
}): React.JSX.Element {
  const { t, sending } = props.props
  return (
    <textarea
      className="im-composer-input"
      rows={2}
      value={props.draft}
      placeholder={t('composerPlaceholder')}
      aria-label={t('composerPlaceholder')}
      disabled={sending}
      onChange={event => { props.setDraft(event.target.value); props.setPicked(0); props.setDismissed(false) }}
      onKeyDown={event => {
        if (props.matches.length > 0) {
          if (event.key === 'ArrowDown') { event.preventDefault(); props.setPicked((props.picked + 1) % props.matches.length); return }
          if (event.key === 'ArrowUp') { event.preventDefault(); props.setPicked((props.picked - 1 + props.matches.length) % props.matches.length); return }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            const candidate = props.matches[props.picked]
            if (candidate !== undefined) props.accept(candidate)
            return
          }
          if (event.key === 'Escape') { event.preventDefault(); props.setDismissed(true); return }
        }
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        void props.submit()
      }}
    />
  )
}

/** The hint line and the send button. */
function ComposerBar(props: { readonly props: ComposerProps, readonly draft: string }): React.JSX.Element {
  const { t, sending } = props.props
  return (
    <div className="im-composer-bar">
      <span className="im-hint">{t('composerHint')}</span>
      <button type="submit" className="im-button im-button-primary" disabled={sending || props.draft.trim() === ''}>
        {sending ? t('sending') : t('send')}
      </button>
    </div>
  )
}

/** The mention candidate list, shown under the input while a query is typed. */
function MentionList(props: {
  readonly matches: readonly Candidate[]
  readonly picked: number
  readonly t: (key: ImKey) => string
  readonly accept: (candidate: Candidate) => void
}): React.JSX.Element {
  return (
    <ul className="im-mentions" role="listbox" aria-label={props.t('mentionTitle')}>
      {props.matches.map((candidate, index) => (
        <li key={candidate.id} role="option" aria-selected={index === props.picked}>
          <button
            type="button"
            className={index === props.picked ? 'im-mention im-mention-active' : 'im-mention'}
            onClick={() => props.accept(candidate)}
          >
            {candidate.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
