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
import type { ImKey } from './locales.ts'
import { MemberPickList } from './member-pick-list.tsx'
import type { MemberOption } from './member-pick-list.tsx'
import { personLabel } from './person-label.ts'
import type { ImPersonView } from './remote.ts'

/** What the picker hands back. */
export interface NewRoomInput {
  readonly title?: string
  readonly kind: 'direct' | 'group'
  readonly memberIds: readonly string[]
}

/** One selectable member is the shared row type. */
export type { MemberOption } from './member-pick-list.tsx'

/** Props of {@link NewRoomPicker}. */
export interface NewRoomPickerProps {
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  /** The agent options to offer: the host roster, already labeled. */
  readonly agents: readonly MemberOption[]
  readonly onCreate: (input: NewRoomInput) => void
  readonly onCancel: () => void
}

/** The new-room form. */
export function NewRoomPicker(props: NewRoomPickerProps): React.JSX.Element {
  const { t, people } = props
  const agents = props.agents
  const [kind, setKind] = useState<'direct' | 'group'>('direct')
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<readonly string[]>(() => [agents[0]?.id ?? 'agent:default'])
  const toggle = (id: string): void => {
    if (kind === 'direct') { setPicked([id]); return }
    setPicked(picked.includes(id) ? picked.filter(item => item !== id) : [...picked, id])
  }
  const ready = kind === 'direct'
    ? picked.filter(id => id.startsWith('agent:')).length === 1
    : picked.length > 0
  const submit = useNewRoomSubmit(props, kind, title, picked, ready)
  return (
    <form className="im-newroom" onSubmit={event => { event.preventDefault(); submit() }}>
      <KindSwitch kind={kind} setKind={setKind} setPicked={setPicked} t={t} agents={agents} />
      <NewRoomTitle title={title} setTitle={setTitle} t={t} />
      <p className="im-hint">{kind === 'direct' ? t('newRoomHint') : t('groupHint')}</p>
      <MemberPickList title={t('membersPick')} options={agents} picked={picked} onToggle={toggle} />
      <PeopleMemberList people={people} t={t} kind={kind} picked={picked} toggle={toggle} />
      <div className="im-row">
        <button type="submit" className="im-button im-button-primary" disabled={!ready}>{t('createRoom')}</button>
        <button type="button" className="im-button" onClick={props.onCancel}>{t('cancel')}</button>
      </div>
    </form>
  )
}

/** The create action: an untitled direct room takes the other side's name. */
function useNewRoomSubmit(
  props: NewRoomPickerProps,
  kind: 'direct' | 'group',
  title: string,
  picked: readonly string[],
  ready: boolean,
): () => void {
  return () => {
    if (!ready) return
    const trimmed = title.trim()
    // 未命名私聊用对方的名字，列表里才不是一排「未命名会话」。
    // An untitled direct room takes the other side's name, so the list never
    // fills with rows that all read "Untitled".
    const fallback = kind === 'direct' ? props.agents.find(agent => agent.id === picked[0])?.label : undefined
    const named = trimmed === '' ? fallback : trimmed
    props.onCreate({ kind, ...(named === undefined ? {} : { title: named }), memberIds: ['human:owner', ...picked] })
  }
}

/** The optional room title input. */
function NewRoomTitle(props: {
  readonly title: string
  readonly setTitle: (title: string) => void
  readonly t: (key: ImKey) => string
}): React.JSX.Element {
  const { t } = props
  return (
    <input
      className="im-input"
      value={props.title}
      placeholder={t('roomTitlePlaceholder')}
      aria-label={t('roomTitlePlaceholder')}
      onChange={event => props.setTitle(event.target.value)}
    />
  )
}

/** The direct/group switch; either choice resets the pick to the first agent. */
function KindSwitch(props: {
  readonly kind: 'direct' | 'group'
  readonly setKind: (kind: 'direct' | 'group') => void
  readonly setPicked: (picked: readonly string[]) => void
  readonly t: (key: ImKey) => string
  readonly agents: readonly { id: string }[]
}): React.JSX.Element {
  const { kind, setKind, setPicked, t } = props
  const first = props.agents[0]?.id ?? 'agent:default'
  return (
    <div className="im-kind-switch" role="group" aria-label={t('roomKindLabel')}>
      <KindButton active={kind === 'direct'} label={t('roomDirect')}
        onClick={() => { setKind('direct'); setPicked([first]) }} />
      <KindButton active={kind === 'group'} label={t('roomGroup')}
        onClick={() => { setKind('group'); setPicked([first]) }} />
    </div>
  )
}

/** The human contacts row; a direct room seats nobody else, so it stays disabled. */
function PeopleMemberList(props: {
  readonly people: readonly { id: string }[]
  readonly t: (key: ImKey) => string
  readonly kind: 'direct' | 'group'
  readonly picked: readonly string[]
  readonly toggle: (id: string) => void
}): React.JSX.Element | null {
  const { people, t, kind, picked, toggle } = props
  if (people.length === 0) return null
  return (
    <MemberPickList
      title={t('people')}
      options={people.map(person => ({
        id: `human:${person.id}`,
        label: personLabel(person as never, t),
        kind: 'human' as const,
      }))}
      picked={picked}
      onToggle={id => { if (kind === 'group') toggle(id) }}
      disabled={kind === 'direct'}
    />
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
