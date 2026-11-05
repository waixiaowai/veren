/**
 * The new-conversation picker: one optional title, a 私聊 / 群聊 switch, and the
 * member list it seats (agents from the roster, humans from the people
 * directory).
 *
 * A direct room takes exactly one agent and always wakes it; a group room takes
 * any mix and wakes an agent only when the message mentions it, which the hint
 * says out loud.
 *
 * 新建会话选择器：一个可选标题、私聊/群聊切换，以及要入座的成员（智能体来自名册，人来自
 * 人员目录）。
 *
 * 私聊只能选一个智能体，且它必定被唤醒；群聊可任意组合，但只有被 @ 提及才会唤醒智能体，
 * 这一点写在提示里。
 *
 * @module @veren/im-ui/client/new-room
 */

import { useState } from 'react'
import { Avatar } from './avatar.tsx'
import type { ImKey } from './locales.ts'
import { personLabel } from './person-label.ts'
import type { ImPersonView } from './remote.ts'

/** What the picker hands back. */
export interface NewRoomInput {
  readonly title?: string
  readonly kind: 'direct' | 'group'
  readonly memberIds: readonly string[]
}

/** One selectable member. */
export interface MemberOption {
  readonly id: string
  readonly label: string
  readonly kind: 'human' | 'agent'
}

/** Props of {@link NewRoomPicker}. */
export interface NewRoomPickerProps {
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  /** Agent participant ids already seated somewhere, plus the default one. */
  readonly agentIds: readonly string[]
  readonly onCreate: (input: NewRoomInput) => void
  readonly onCancel: () => void
}

/** Collect the agents already seated anywhere, plus the synthesized default one. */
function agentOptions(agentIds: readonly string[], t: (key: ImKey) => string): readonly MemberOption[] {
  const ids = new Set(['agent:default', ...agentIds])
  return [...ids].map(id => ({
    id,
    label: id === 'agent:default' ? t('participantAssistant') : id.slice('agent:'.length),
    kind: 'agent' as const,
  }))
}

/** The new-room form. */
export function NewRoomPicker(props: NewRoomPickerProps): React.JSX.Element {
  const { t, people } = props
  const agents = agentOptions(props.agentIds, t)
  const [kind, setKind] = useState<'direct' | 'group'>('direct')
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<readonly string[]>(['agent:default'])
  const toggle = (id: string): void => {
    if (kind === 'direct') { setPicked([id]); return }
    setPicked(picked.includes(id) ? picked.filter(item => item !== id) : [...picked, id])
  }
  const ready = kind === 'direct'
    ? picked.filter(id => id.startsWith('agent:')).length === 1
    : picked.length > 0
  const submit = (): void => {
    if (!ready) return
    const trimmed = title.trim()
    props.onCreate({ kind, ...(trimmed === '' ? {} : { title: trimmed }), memberIds: ['human:owner', ...picked] })
  }
  return (
    <form className="im-newroom" onSubmit={event => { event.preventDefault(); submit() }}>
      <div className="im-kind-switch" role="group" aria-label={t('roomKindLabel')}>
        <KindButton active={kind === 'direct'} label={t('roomDirect')}
          onClick={() => { setKind('direct'); setPicked(['agent:default']) }} />
        <KindButton active={kind === 'group'} label={t('roomGroup')}
          onClick={() => { setKind('group'); setPicked(['agent:default']) }} />
      </div>
      <input
        className="im-input"
        value={title}
        placeholder={t('roomTitlePlaceholder')}
        aria-label={t('roomTitlePlaceholder')}
        onChange={event => setTitle(event.target.value)}
      />
      <p className="im-hint">{kind === 'direct' ? t('newRoomHint') : t('groupHint')}</p>
      <MemberList title={t('membersPick')} options={agents} picked={picked} onToggle={toggle} />
      {people.length > 0 && (
        <MemberList
          title={t('people')}
          options={people.map(person => ({
            id: `human:${person.id}`,
            label: personLabel(person, t),
            kind: 'human' as const,
          }))}
          picked={picked}
          onToggle={id => { if (kind === 'group') toggle(id) }}
          disabled={kind === 'direct'}
        />
      )}
      <div className="im-row">
        <button type="submit" className="im-button im-button-primary" disabled={!ready}>{t('createRoom')}</button>
        <button type="button" className="im-button" onClick={props.onCancel}>{t('cancel')}</button>
      </div>
    </form>
  )
}

/** One kind switch button. */
function KindButton(props: { readonly active: boolean; readonly label: string; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={props.active ? 'im-kind im-kind-active' : 'im-kind'}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

/** One selectable member group. */
function MemberList(props: {
  readonly title: string
  readonly options: readonly MemberOption[]
  readonly picked: readonly string[]
  readonly onToggle: (id: string) => void
  readonly disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="im-member-pick">
      <span className="im-label">{props.title}</span>
      <ul className="im-pick-list" role="list">
        {props.options.map(option => {
          const active = props.picked.includes(option.id)
          return (
            <li key={option.id}>
              <button
                type="button"
                className={active ? 'im-pick im-pick-active' : 'im-pick'}
                aria-pressed={active}
                disabled={props.disabled === true && !active}
                onClick={() => props.onToggle(option.id)}
              >
                <Avatar name={option.label} kind={option.kind} size="sm" glyph />
                <span>{option.label}</span>
                {active && <span className="im-pick-mark" aria-hidden="true">✓</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
