/**
 * The people tab: the directory the inbound side feeds automatically.
 *
 * 人员页签：入站侧自动收录的人员目录。
 *
 * @module @veren/im-ui/client/views-people
 */

import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'

/** The people tab body. */
export function PeopleView(props: ImBodyProps): React.JSX.Element {
  const { state, t } = props
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('people')}</h2>
      <p className="im-muted">{t('peopleHint')}</p>
      {state.catalog.people.length === 0 && <p className="im-muted">{t('noPeople')}</p>}
      <ul className="im-list">
        {state.catalog.people.map(person => (
          <li key={person.id} className="im-item">
            <span className="im-strong">{person.displayName}</span>
            {person.claimedName !== undefined && (
              <span className="im-badge">{t('unverifiedClaim')}：{person.claimedName}</span>
            )}
            <span className="im-muted">{person.id}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
