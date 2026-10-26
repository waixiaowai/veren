/**
 * The people tab: an address book, not an id list.
 *
 * A contact card per person: the avatar carries the display name's initial,
 * the name leads, identity trust renders as a badge, contacts and reachable
 * addresses render as chips, and the internal person id shrinks to a footer
 * line — it is plumbing, not identity.
 *
 * 人员页签：通讯录，而不是 id 列表。
 *
 * 每人一张名片：头像取显示名字首字符，名字领先，身份可信度以徽标呈现，联系方式与
 * 可达地址渲染成芯片，内部 person id 缩为末行——它是管道，不是身份。
 *
 * @module @veren/im-ui/client/views-people
 */

import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import type { ImPersonView } from './remote.ts'

/** The people tab body: cards sorted by display name. */
export function PeopleView(props: ImBodyProps): React.JSX.Element {
  const { state, t } = props
  const people = [...state.catalog.people].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'zh'),
  )
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('people')}</h2>
      <p className="im-muted">{t('peopleHint')}</p>
      {people.length === 0 && <p className="im-muted">{t('noPeople')}</p>}
      <ul className="im-list">
        {people.map(person => <PersonCard key={person.id} person={person} t={t} />)}
      </ul>
    </section>
  )
}

/** One address-book contact card. */
function PersonCard(props: { readonly person: ImPersonView; readonly t: (key: ImKey) => string }): React.JSX.Element {
  const { person, t } = props
  return (
    <li className="im-card">
      <span className={'im-avatar' + avatarTone(person.identityStatus)}>{initialOf(person.displayName)}</span>
      <div className="im-card-body">
        <div className="im-name-row">
          <span className="im-strong">{person.displayName}</span>
          <IdentityBadge person={person} t={t} />
        </div>
        {(person.contacts.length > 0 || person.addresses.length > 0) && (
          <div className="im-chip-row">
            {person.contacts.map(contact => (
              <span key={contact.kind + contact.value} className="im-chip">{contact.value}</span>
            ))}
            {person.addresses.map(address => (
              <span key={address.conversationId} className="im-chip im-chip-addr">{address.externalId}</span>
            ))}
          </div>
        )}
        <div className="im-id-mono">{person.id}</div>
      </div>
    </li>
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

/** The avatar's single character: the first grapheme of the display name. */
function initialOf(displayName: string): string {
  return Array.from(displayName.trim())[0]?.toUpperCase() ?? '?'
}

/** Verified people get the accent avatar; strangers stay neutral. */
function avatarTone(identityStatus: ImPersonView['identityStatus']): string {
  return identityStatus === 'verified' ? ' im-avatar-verified' : ''
}
