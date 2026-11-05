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
  const { t, room, sending } = props
  const candidates = useMemo(
    () => room.members
      .filter(id => id !== 'human:owner')
      .map(id => ({ id, label: participantLabel(id, props.people, t, props.participants) })),
    [room.members, props.people, props.participants, t],
  )
  const query = TRAILING_MENTION.exec(draft)?.[2]
  const matches = query === undefined || dismissed
    ? []
    : candidates.filter(candidate => candidate.label.toLowerCase().includes(query.toLowerCase()))
  const submit = async (): Promise<void> => {
    const body = draft.trim()
    if (body === '' || sending) return
    if (await props.onSend(body)) setDraft('')
  }
  const accept = (candidate: Candidate): void => {
    setDraft(draft.replace(TRAILING_MENTION, (_match: string, lead: string) => `${lead}@${candidate.label} `))
    setPicked(0)
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
          disabled={sending}
          onChange={event => { setDraft(event.target.value); setPicked(0); setDismissed(false) }}
          onKeyDown={event => {
            if (matches.length > 0) {
              if (event.key === 'ArrowDown') { event.preventDefault(); setPicked((picked + 1) % matches.length); return }
              if (event.key === 'ArrowUp') { event.preventDefault(); setPicked((picked - 1 + matches.length) % matches.length); return }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                const candidate = matches[picked]
                if (candidate !== undefined) accept(candidate)
                return
              }
              if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return }
            }
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void submit()
          }}
        />
        <div className="im-composer-bar">
          <span className="im-hint">{t('composerHint')}</span>
          <button type="submit" className="im-button im-button-primary" disabled={sending || draft.trim() === ''}>
            {sending ? t('sending') : t('send')}
          </button>
        </div>
      </div>
      {matches.length > 0 && (
        <ul className="im-mentions" role="listbox" aria-label={t('mentionTitle')}>
          {matches.map((candidate, index) => (
            <li key={candidate.id} role="option" aria-selected={index === picked}>
              <button
                type="button"
                className={index === picked ? 'im-mention im-mention-active' : 'im-mention'}
                onClick={() => accept(candidate)}
              >
                {candidate.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
