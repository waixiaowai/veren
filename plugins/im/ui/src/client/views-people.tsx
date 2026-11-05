/**
 * The people tab: an address book a human can actually manage.
 *
 * Search narrows the list; "new person" opens the editor on an empty profile;
 * every card can be edited or removed. Contacts that still carry the raw
 * provider id as their name render as "WeChat user" plus a short handle, and a
 * profile with no reachable address is marked as such instead of pretending it
 * can receive messages.
 *
 * 人员页签：一本真正可管理的通讯录。
 *
 * 搜索框收窄名单；「新增人员」在空档案上打开编辑器；每张卡片都能编辑或删除。仍以裸 provider
 * id 为名字的档案渲染成「微信用户」加短码；没有可达地址的档案会被明确标注，而不是假装能收消息。
 *
 * @module @veren/im-ui/client/views-people
 */

import { useMemo, useState } from 'react'
import { Avatar } from './avatar.tsx'
import { fill } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import { PersonEditor } from './person-editor.tsx'
import { filterPeople } from './people-filter.ts'
import { contactKindKey, isUnnamedPerson, personLabel, shortHandle } from './person-label.ts'
import type { ImPersonView, PersonDraft } from './remote.ts'

/** Named contacts first, unnamed regulars after, then by name. */
/** 有名字的联系人在前，未命名常客在后，再按名字排序。 */
function byPerson(left: ImPersonView, right: ImPersonView): number {
  return Number(isUnnamedPerson(left)) - Number(isUnnamedPerson(right))
    || left.displayName.localeCompare(right.displayName, 'zh')
}

/** The people tab body. */
export function PeopleView(props: ImBodyProps): React.JSX.Element {
  const { state, t, actions } = props
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | 'new' | undefined>(undefined)
  const [error, setError] = useState('')
  const people = useMemo(() => [...state.catalog.people].sort(byPerson), [state.catalog.people])
  const shown = useMemo(() => filterPeople(people, query), [people, query])
  const edited = editing === undefined || editing === 'new'
    ? undefined
    : people.find(person => person.id === editing)
  const close = (): void => { setEditing(undefined); setError('') }
  const submit = usePersonSubmit(editing, edited, actions, t)
  const remove = usePersonRemove(actions, t, setError)
  return (
    <section className="im-section">
      <PeopleHero count={people.length} t={t} onNew={() => { setError(''); setEditing('new') }} />
      <div className="im-search">
        <input className="im-input" value={query} placeholder={t('searchPeople')}
          aria-label={t('searchPeople')}
          onChange={event => setQuery(event.target.value)} />
      </div>
      {error !== '' && <p className="im-error">{error}</p>}
      {editing !== undefined && (
        <PersonEditor key={editing} person={edited} t={t}
          onSubmit={submit} onCancel={close} onFinished={close} />
      )}
      <PeopleList total={people.length} shown={shown} t={t}
        onEdit={id => { setError(''); setEditing(id) }} onDelete={remove} />
    </section>
  )
}

/** The contact grid plus its two empty states. / The contact grid plus its two empty states. */
function PeopleList(props: {
  readonly total: number
  readonly shown: readonly ImPersonView[]
  readonly t: (key: ImKey) => string
  readonly onEdit: (id: string) => void
  readonly onDelete: (person: ImPersonView) => void
}): React.JSX.Element {
  const { total, shown, t } = props
  return (
    <>
      {total === 0 && <p className="im-muted">{t('noPeople')}</p>}
      {total > 0 && shown.length === 0 && <p className="im-muted">{t('peopleSearchEmpty')}</p>}
      <ul className="im-card-grid" role="list">
        {shown.map(person => (
          <PersonCard key={person.id} person={person} t={t}
            onEdit={props.onEdit} onDelete={props.onDelete} />
        ))}
      </ul>
    </>
  )
}

/** The submit path: create for a new contact, update for an edited one. / The submit path: create for a new contact, update for an edited one. */
function usePersonSubmit(
  editing: string | 'new' | undefined,
  edited: ImPersonView | undefined,
  actions: ImBodyProps['actions'],
  t: (key: ImKey) => string,
): (draft: PersonDraft) => Promise<string | undefined> {
  return (draft) => {
    if (editing === 'new') return actions.onCreatePerson(draft)
    if (edited === undefined) return Promise.resolve(t('noPeople'))
    return actions.onUpdatePerson(edited.id, draft)
  }
}

/** The delete path: confirm first, then surface a failure inline. / The delete path: confirm first, then surface a failure inline. */
function usePersonRemove(
  actions: ImBodyProps['actions'],
  t: (key: ImKey) => string,
  setError: (error: string) => void,
): (person: ImPersonView) => void {
  return (person) => {
    if (!window.confirm(fill(t('confirmDeletePerson'), { name: personLabel(person, t) }))) return
    void actions.onDeletePerson(person.id).then(failure => {
      if (failure !== undefined) setError(failure)
    })
  }
}

/** The tab hero: the heading with the contact count and the new-contact action. */
function PeopleHero(props: {
  readonly count: number
  readonly t: (key: ImKey) => string
  readonly onNew: () => void
}): React.JSX.Element {
  const { count, t } = props
  return (
    <div className="im-hero im-hero-row">
      <div>
        <h2 className="im-display">{fill(t('headingPeople'), { n: count })}</h2>
        <p className="im-hero-sub">{t('peopleHint')}</p>
      </div>
      <button type="button" className="im-button im-button-primary" onClick={props.onNew}>
        {t('newPerson')}
      </button>
    </div>
  )
}

/** One address-book contact card: identity, contacts, and the two actions. */
function PersonCard(props: {
  readonly person: ImPersonView
  readonly t: (key: ImKey) => string
  readonly onEdit: (personId: string) => void
  readonly onDelete: (person: ImPersonView) => void
}): React.JSX.Element {
  const { person, t, onEdit, onDelete } = props
  const name = personLabel(person, t)
  const note = person.notes ?? person.bio
  return (
    <li className="im-card" title={person.id}>
      <Avatar name={name} kind="human" size="lg" />
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-strong">{name}</span>
          {person.identityStatus === 'self-reported' && <span className="im-badge">{t('unverifiedClaim')}</span>}
          {person.addresses.length === 0 && <span className="im-badge">{t('profileOnly')}</span>}
        </div>
        <ContactChips person={person} t={t} />
        {note !== undefined && note !== '' && <p className="im-muted im-person-note">{note}</p>}
        <div className="im-card-actions">
          <button type="button" className="im-button" onClick={() => onEdit(person.id)}>{t('edit')}</button>
          <button type="button" className="im-button im-button-danger" onClick={() => onDelete(person)}>
            {t('delete')}
          </button>
        </div>
      </div>
    </li>
  )
}

/** Contacts that carry information (a bare echo of the display name is noise). */
/** 有信息量的联系方式（与显示名相同的裸值不算）。 */
function ContactChips(props: {
  readonly person: ImPersonView
  readonly t: (key: ImKey) => string
}): React.JSX.Element | null {
  const { person, t } = props
  const contacts = person.contacts.filter(contact => contact.value !== person.displayName)
  if (contacts.length === 0) return null
  return (
    <div className="im-chip-row">
      {contacts.map(contact => (
        <span key={`${contact.kind}:${contact.value}`} className="im-chip" title={contact.value}>
          {t(contactKindKey(contact.kind))} · {shortHandle(contact.value)}
        </span>
      ))}
    </div>
  )
}
