/**
 * The intake tab: the stranger-intake switch, counts, and the audit window.
 *
 * 采集页签：陌生人采集的开关、计数与审计窗口。
 *
 * @module @veren/im-ui/client/views-intake
 */

import type { ImBodyProps } from './panel.tsx'

/** The intake tab body. */
export function IntakeView(props: ImBodyProps): React.JSX.Element {
  const { state, t } = props
  const intake = state.catalog.intake
  const counts = intake.counts ?? {}
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('intake')}</h2>
      <p className={intake.enabled ? 'im-status im-status-online' : 'im-status'}>
        {intake.enabled ? t('intakeOn') : t('intakeOff')}
      </p>
      <h3 className="im-heading">{t('intakeCounts')}</h3>
      <ul className="im-list">
        {Object.entries(counts).map(([status, count]) => (
          <li key={status} className="im-item">
            <span className="im-badge">{status}</span>
            <span className="im-strong">{count}</span>
          </li>
        ))}
      </ul>
      <h3 className="im-heading">{t('intakeRecent')}</h3>
      {(intake.recent ?? []).length === 0 && <p className="im-muted">{t('noIntakeRows')}</p>}
      <ul className="im-list">
        {(intake.recent ?? []).map(row => (
          <li key={`${row.personId}-${row.askedAt}`} className="im-item">
            <span className="im-strong">{row.personName}</span>
            <span className="im-badge">{row.status}</span>
            <span className="im-muted">{t('askedAt')} {new Date(row.askedAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
