/**
 * The people tab: an address book, not an id list.
 *
 * Humans browse names; provider ids are plumbing. A profile still carrying the
 * raw provider id as its name renders as "WeChat user" plus a short handle,
 * the raw-id echo between contacts and addresses collapses into one short
 * address chip, the internal person id leaves the card (it survives as the
 * hover title), and a rename control lets a human finish what the intake chat
 * started.
 *
 * 人员页签：通讯录，而不是 id 列表。
 *
 * 人浏览的是名字；provider id 是管道。仍以裸 provider id 为名字的档案渲染成「微信用户」
 * 加短码，联系方式与地址之间的裸 id 重复收成一条短地址芯片，内部 person id 离开卡片
 * （保留为悬停标题），备注控件让人补完采集对话没问出来的名字。
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
      <span className={'im-avatar' + avatarTone(person.identityStatus)}>{initialOf(name)}</span>
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-strong">{name}</span>
          <IdentityBadge person={person} t={t} />
        </div>
        <ContactChips person={person} />
        <RenameControl person={person} t={t} onRename={onRename} />
      </div>
    </li>
  )
}

/**
 * Chips of one card: meaningful contacts only — a contact that merely echoes
 * the provider id shrinks away, and each address renders once as a short
 * handle with the full id on hover.
 * 卡片上的芯片：只留有意义的联系方式——单纯复述 provider id 的联系方式收掉，每个地址
 * 渲染成一条短码芯片，完整 id 放在悬停提示里。
 */
function ContactChips(props: { readonly person: ImPersonView }): React.JSX.Element | null {
  const { person } = props
  const contacts = person.contacts.filter(contact => !isSameId(contact.value, person))
  if (contacts.length === 0 && person.addresses.length === 0) return null
  return (
    <div className="im-chip-row">
      {contacts.map(contact => (
        <span key={contact.kind + contact.value} className="im-chip">{contact.value}</span>
      ))}
      {person.addresses.map(address => (
        <span key={address.conversationId} className="im-chip im-chip-addr" title={address.externalId}>
          {shortHandleOf(address.externalId)}
        </span>
      ))}
    </div>
  )
}

/**
 * The rename control: one quiet button that opens an inline editor. Saving
 * fires the remote rename and the panel's poll loop brings the new name back.
 * 备注控件：一个安静的按钮展开行内编辑器。保存触发远端改名，面板轮询把新名字带回来。
 */
function RenameControl(props: {
  readonly person: ImPersonView
  readonly t: (key: ImKey) => string
  readonly onRename: (personId: string, displayName: string) => void
}): React.JSX.Element {
  const { person, t, onRename } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  if (!editing) {
    return (
      <div className="im-rename-row">
        <button
          type="button"
          className="im-link-button"
          onClick={() => { setDraft(isUnnamed(person) ? '' : person.displayName); setEditing(true) }}
        >
          {t('rename')}
        </button>
      </div>
    )
  }
  const commit = (): void => {
    const name = draft.trim()
    if (name === '') return
    onRename(person.id, name)
    setEditing(false)
  }
  return (
    <div className="im-rename-row">
      <input
        className="im-input im-rename-input"
        value={draft}
        placeholder={t('renamePlaceholder')}
        autoFocus
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setEditing(false)
        }}
      />
      <button type="button" className="im-button" disabled={draft.trim() === ''} onClick={commit}>
        {t('save')}
      </button>
      <button type="button" className="im-button" onClick={() => setEditing(false)}>{t('cancel')}</button>
    </div>
  )
}

/** How much the name can be trusted, as one badge. */
function IdentityBadge(props: { readonly person: ImPersonView; readonly t: (key: ImKey) => string }): React.JSX.Element | null {
  const { person, t } = props
  if (person.identityStatus === 'verified') {
    return <span className="im-badge im-badge-on">{person.realName ?? person.displayName}</span>
  }
  if (person.identityStatus === 'self-reported' && person.claimedName !== undefined) {
    return <span className="im-badge">{t('unverifiedClaim')}：{person.claimedName}</span>
  }
  return null
}

/** Whether the stored name is still the raw provider id, not a human's word. */
function isUnnamed(person: ImPersonView): boolean {
  return person.addresses.some(address => address.externalId === person.displayName)
    || person.contacts.some(contact => contact.value === person.displayName && person.displayName.includes('@'))
}

/** The name a human sees: the stored name, or "WeChat user" plus a short handle. */
function humanNameOf(person: ImPersonView, t: (key: ImKey) => string): string {
  if (!isUnnamed(person)) return person.displayName
  const handle = person.addresses[0]?.externalId ?? person.displayName
  return `${t('unnamedPerson')} ${shortHandleOf(handle)}`
}

/** Whether a contact value is this person's raw provider id (plumbing, not a phone number). */
function isSameId(value: string, person: ImPersonView): boolean {
  return person.addresses.some(address => address.externalId === value) || person.displayName === value
}

/** Short human handle of one raw provider id: the tail of its pre-@ part. */
function shortHandleOf(externalId: string): string {
  const handle = externalId.split('@')[0] ?? externalId
  return handle.length <= 6 ? handle : handle.slice(-6)
}

/** The avatar's single character: the first grapheme of the display name. */
function initialOf(displayName: string): string {
  return Array.from(displayName.trim())[0]?.toUpperCase() ?? '?'
}

/** Verified people get the accent avatar; strangers stay neutral. */
function avatarTone(identityStatus: ImPersonView['identityStatus']): string {
  return identityStatus === 'verified' ? ' im-avatar-verified' : ''
}
