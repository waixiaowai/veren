/**
 * The people tab: an address book, not an id list.
 *
 * Humans browse names; provider ids are plumbing. A profile still carrying the
 * raw provider id as its name renders as "WeChat user" plus a short handle, and
 * a rename control lets a human finish what the intake chat started.
 *
 * 人员页签：通讯录，而不是 id 列表。
 *
 * 人浏览的是名字；provider id 是管道。仍以裸 provider id 为名字的档案渲染成「微信用户」
 * 加短码，备注控件让人补完采集对话没问出来的名字。
 *
 * @module @veren/im-ui/client/views-people
 */

import { useState } from 'react'
import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import type { ImPersonView } from './remote.ts'

/** The people tab body: named contacts first, unnamed regulars after. */
export function PeopleView(props: ImBodyProps): React.JSX.Element {
  const { state, t, actions } = props
  const people = [...state.catalog.people].sort((left, right) =>
    Number(isUnnamed(left)) - Number(isUnnamed(right))
    || left.displayName.localeCompare(right.displayName, 'zh'))
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('people')}</h2>
      <p className="im-muted">{t('peopleHint')}</p>
      {people.length === 0 && <p className="im-muted">{t('noPeople')}</p>}
      <ul className="im-list">
        {people.map(person => (
          <PersonCard key={person.id} person={person} t={t} onRename={actions.onRenamePerson} />
        ))}
      </ul>
    </section>
  )
}

/** One address-book contact card. */
function PersonCard(props: {
  readonly person: ImPersonView
  readonly t: (key: ImKey) => string
  readonly onRename: (personId: string, displayName: string) => void
}): React.JSX.Element {
  const { person, t, onRename } = props
  const name = humanNameOf(person, t)
  return (
    <li className="im-card" title={person.id}>
      <span className={person.identityStatus === 'unverified' ? 'im-avatar' : 'im-avatar im-avatar-known'}>
        {initialOf(name)}
      </span>
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-strong">{name}</span>
          {person.identityStatus === 'self-reported' && <span className="im-badge">{t('unverifiedClaim')}</span>}
        </div>
        <ContactChips person={person} />
        <RenameControl person={person} t={t} onRename={onRename} />
      </div>
    </li>
  )
}

/** Contacts that carry information (a bare echo of the display name is noise). */
/** 有信息量的联系方式（与显示名相同的裸值不算）。 */
function ContactChips(props: { readonly person: ImPersonView }): React.JSX.Element | null {
  const contacts = props.person.contacts.filter(contact => contact.value !== props.person.displayName)
  if (contacts.length === 0) return null
  return (
    <div className="im-chip-row">
      {contacts.map(contact => (
        <span key={`${contact.kind}:${contact.value}`} className="im-chip" title={contact.value}>
          {contact.kind === 'wechat' ? '微信' : contact.kind} · {shortHandle(contact.value)}
        </span>
      ))}
    </div>
  )
}

/** Inline rename: a human completes the name the intake chat could not. */
/** 就地改名：把人补上采集对话没能问出来的名字。 */
function RenameControl(props: {
  readonly person: ImPersonView
  readonly t: (key: ImKey) => string
  readonly onRename: (personId: string, displayName: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const { person, t, onRename } = props
  if (!editing) {
    return (
      <button type="button" className="im-link" onClick={() => { setName(person.displayName); setEditing(true) }}>
        {t('rename')}
      </button>
    )
  }
  return (
    <div className="im-row">
      <input className="im-input" value={name} placeholder={t('renamePlaceholder')}
        onChange={event => setName(event.target.value)} />
      <button type="button" className="im-button im-button-primary" disabled={name.trim() === ''}
        onClick={() => { onRename(person.id, name.trim()); setEditing(false) }}>
        {t('save')}
      </button>
      <button type="button" className="im-button" onClick={() => setEditing(false)}>{t('cancel')}</button>
    </div>
  )
}

/** Whether the profile still shows the raw provider id as its name. */
/** 档案是否仍以裸 provider id 作名字。 */
function isUnnamed(person: ImPersonView): boolean {
  return person.identityStatus === 'unverified' && person.realName === undefined
}

/** The name a human should see. */
/** 人应该看到的名字。 */
function humanNameOf(person: ImPersonView, t: (key: ImKey) => string): string {
  if (!isUnnamed(person)) return person.realName ?? person.displayName
  return `${t('unnamedPerson')} · ${shortHandle(person.displayName)}`
}

/** Whether the name is one of ours or a raw handle. */
function shortHandle(value: string): string {
  const at = value.indexOf('@')
  const head = at === -1 ? value : value.slice(0, at)
  return head.length <= 10 ? head : `${head.slice(0, 6)}…${head.slice(-2)}`
}

/** The avatar's single character. */
function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
