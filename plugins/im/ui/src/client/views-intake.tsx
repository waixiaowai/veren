/**
 * The intake tab, laid out from three jobs in priority order.
 *
 * IA decision (2026-10-28) —
 * 1. Triage「有没有人等我」: counts.asked is the only number allowed to shout.
 *    asked>0 → the waiting card is accent-bordered; asked=0 → the pipeline
 *    stays quiet.
 *    分诊「有没有人等我」：counts.asked 是唯一允许抢眼的数字。asked>0 时等待卡片带强调
 *    边框；asked=0 时整条管道保持安静。
 * 2. Health「管道是否健康」: counts render as a four-cell funnel strip in the
 *    fixed order asked→answered/declined→expired — a funnel, not a list.
 *    expired is a legacy terminal state (rows are no longer marked expired), so
 *    it is counted, never explained as live flow.
 *    健康「管道是否健康」：counts 以四格漏斗条呈现，固定顺序 asked→answered/declined
 *    →expired——是漏斗不是清单。expired 是遗留终态（行不再被打成 expired），只计数，
 *    不当活流程解释。
 * 3. Audit「审计追溯」: recent rows split by status — waiting rows feed job 1,
 *    settled rows land in the audit list with every fact the host already
 *    carries (claimed name, outcome, reply excerpt, timeline). The host has no
 *    intake action face, so the tab invents none: no allow/block/re-ask buttons.
 *    审计「审计追溯」：recent 按状态分流——等待行进 job 1，已收尾行进审计列表，渲染宿主
 *    已携带的全部事实（自称、收尾所得、回复摘录、时间线）。宿主没有任何 intake 动作面，
 *    因此本页不发明：无允许/拉黑/重发按钮。
 *
 * The safety bounds (replyWindowMs / maxAsksPerHour / minAskIntervalMs) are the
 * pipeline's running contract and render as fact chips.
 * 安全边界（replyWindowMs / maxAsksPerHour / minAskIntervalMs）是管道的运行契约，
 * 以事实条呈现。
 *
 * State matrix — loading is the shell's; here: error before the first read →
 * the explanatory IntakeNoData (never a fake "off"); error after settle →
 * stale data plus the shell's error line; all-zero counts with no rows → the
 * designed empty block; otherwise funnel + waiting + audit.
 * 状态矩阵——loading 由壳层接管；此处：未落定即出错 → 解释态 IntakeNoData（绝不谎报
 * 「已关闭」）；落定后出错 → 陈旧数据 + 壳层错误行；全零且无行 → 专门设计的空态；
 * 其余 → 漏斗 + 等待 + 审计。
 *
 * @module @veren/im-ui/client/views-intake
 */

import type { ImBodyProps } from './panel.tsx'
import type { ImKey } from './locales.ts'
import type { ImIntakeStatusView, ImSnapshot } from './remote.ts'
import {
  EMPTY_INTAKE_COUNTS, auditRows, funnelCells, intakeUntouched, pendingRows, splitDuration,
} from './intake-derive.ts'
import type { IntakeFunnelCell, IntakeRow, IntakeStatus } from './intake-derive.ts'

/** The dictionary face a section needs. */
type Translate = ImBodyProps['t']

/** The closed status → copy mapping; a Record over the union, so exhaustive. */
const STATUS_KEYS: Record<IntakeStatus, ImKey> = {
  asked: 'statusAsked', answered: 'statusAnswered', declined: 'statusDeclined', expired: 'statusExpired',
}

/** The closed outcome → copy mapping. */
const OUTCOME_KEYS: Record<NonNullable<IntakeRow['outcome']>, ImKey> = {
  name: 'intakeOutcomeName', contact: 'intakeOutcomeContact', both: 'intakeOutcomeBoth',
}

/** The intake tab body: state dispatch first, then the three-job composition. */
export function IntakeView(props: ImBodyProps): React.JSX.Element {
  const { state, t } = props
  if (state.status === 'error' && !state.settled) return <IntakeNoData t={t} />
  return <IntakeData state={state} t={t} />
}

/** Explanatory state: the channel errored before the first read ever landed. */
function IntakeNoData(props: { t: Translate }): React.JSX.Element {
  const { t } = props
  return (
    <section className="im-section">
      <h2 className="im-heading">{t('intake')}</h2>
      <p className="im-muted">{t('intakeNoData')}</p>
      <p className="im-muted">{t('intakeNoDataHint')}</p>
    </section>
  )
}

/** The data-backed body: switch card, then funnel, waiting triage, and audit. */
function IntakeData(props: { state: ImSnapshot; t: Translate }): React.JSX.Element {
  const { state, t } = props
  const intake = state.catalog.intake
  const recent = intake.recent ?? []
  const waiting = pendingRows(recent)
  return (
    <section className="im-section">
      <IntakeSwitchCard intake={intake} t={t} />
      {state.status === 'error' && <p className="im-status">{t('intakeStale')}</p>}
      {intakeUntouched(intake.counts ?? EMPTY_INTAKE_COUNTS, recent)
        ? <IntakeEmpty t={t} />
        : (
            <>
              <IntakeFunnel intake={intake} t={t} />
              {waiting.length > 0 && <IntakeWaiting rows={waiting} t={t} />}
              <IntakeAudit rows={auditRows(recent)} t={t} />
            </>
          )}
    </section>
  )
}

/** The switch card: on/off, the exact question strangers receive, the bounds. */
function IntakeSwitchCard(props: { intake: ImIntakeStatusView; t: Translate }): React.JSX.Element {
  const { intake, t } = props
  return (
    <>
      <p className={intake.enabled ? 'im-status im-status-online' : 'im-status'}>
        {intake.enabled ? t('intakeOn') : t('intakeOff')}
      </p>
      {intake.enabled && (
        <>
          {intake.askText !== '' && <p className="im-quote">{t('intakeAskPreview')}{intake.askText}</p>}
          <div className="im-chip-row">
            <span className="im-chip">{t('boundsReplyWindow')} {duration(intake.replyWindowMs, t)}</span>
            <span className="im-chip">{t('boundsMaxAsks')} {intake.maxAsksPerHour}</span>
            <span className="im-chip">{t('boundsMinGap')} ≥ {duration(intake.minAskIntervalMs, t)}</span>
          </div>
        </>
      )}
    </>
  )
}

/** The four-cell funnel; only the waiting head may glow, and only when hot. */
function IntakeFunnel(props: { intake: ImIntakeStatusView; t: Translate }): React.JSX.Element {
  const { intake, t } = props
  const cellClass = (cell: IntakeFunnelCell): string =>
    cell.status === 'asked' && cell.count > 0 ? 'im-funnel-cell im-funnel-hot' : 'im-funnel-cell'
  return (
    <>
      <h3 className="im-heading">{t('intakePipe')}</h3>
      <div className="im-funnel">
        {funnelCells(intake.counts ?? EMPTY_INTAKE_COUNTS).map(cell => (
          <div key={cell.status} className={cellClass(cell)}>
            <span className="im-funnel-label">{t(STATUS_KEYS[cell.status])}</span>
            <span className="im-funnel-num">{cell.count}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** The waiting card: job 1's surface, rendered only when someone is waiting. */
function IntakeWaiting(props: { rows: readonly IntakeRow[]; t: Translate }): React.JSX.Element {
  const { rows, t } = props
  return (
    <>
      <h3 className="im-heading">{t('intakeWaiting')}</h3>
      <p className="im-muted">{t('intakeWaitingHint')}</p>
      <ul className="im-list">
        {rows.map(row => <IntakeRecord key={`${row.personId}-${row.askedAt}`} row={row} t={t} waiting />)}
      </ul>
    </>
  )
}

/** The audit trail: settled rows with every fact the host already carries. */
function IntakeAudit(props: { rows: readonly IntakeRow[]; t: Translate }): React.JSX.Element {
  const { rows, t } = props
  return (
    <>
      <h3 className="im-heading">{t('intakeRecent')}</h3>
      {rows.length === 0 && <p className="im-muted">{t('intakeAuditEmpty')}</p>}
      <ul className="im-list">
        {rows.map(row => <IntakeRecord key={`${row.personId}-${row.askedAt}`} row={row} t={t} />)}
      </ul>
    </>
  )
}

/** One record row: name, claim, status, outcome, timeline, and the reply. */
function IntakeRecord(props: { row: IntakeRow; t: Translate; waiting?: boolean }): React.JSX.Element {
  const { row, t } = props
  return (
    <li className={props.waiting === true ? 'im-item im-item-hot' : 'im-item'}>
      <div className="im-name-row">
        <span className="im-strong">{row.personName}</span>
        {row.claimedName !== undefined && <span className="im-muted">{t('unverifiedClaim')} {row.claimedName}</span>}
        <span className="im-badge">{t(STATUS_KEYS[row.status])}</span>
        {row.outcome !== undefined && <span className="im-badge im-badge-on">{t(OUTCOME_KEYS[row.outcome])}</span>}
      </div>
      <div className="im-name-row">
        <span className="im-muted">{t('askedAt')} {new Date(row.askedAt).toLocaleString()}</span>
        {props.waiting === true
          && <span className="im-muted">{t('intakeDeadline')} {new Date(row.expiresAt).toLocaleString()}</span>}
        {row.settledAt !== undefined
          && <span className="im-muted">{t('intakeSettledAt')} {new Date(row.settledAt).toLocaleString()}</span>}
      </div>
      {row.replyExcerpt !== undefined && <p className="im-quote">{row.replyExcerpt}</p>}
    </li>
  )
}

/** The designed empty block: the tab's normal state deserves real design. */
function IntakeEmpty(props: { t: Translate }): React.JSX.Element {
  const { t } = props
  return (
    <div className="im-empty">
      <p className="im-empty-title">{t('intakeEmptyTitle')}</p>
      <p className="im-muted">{t('intakeEmptyHint')}</p>
    </div>
  )
}

/** One duration as dictionary words, e.g. 「2 分钟」 / "2 min". */
function duration(ms: number, t: Translate): string {
  const { value, unit } = splitDuration(ms)
  return `${value} ${t(unit === 'minutes' ? 'unitMinutes' : 'unitSeconds')}`
}
