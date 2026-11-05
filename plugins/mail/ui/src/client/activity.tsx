/**
 * The activity view: one card per execution chain, with its step timeline.
 *
 * Every status is word + dot + palette together (Novu's triple); a chain
 * without a finish time shows as still running and earns no duration; a
 * skipped step always names the judgment that stopped it.
 *
 * 执行记录视图：每条执行链一张卡片，附步骤时间线。
 *
 * 每个状态都是词 + 点 + 色板三重表达（Novu 的三重规则）；没有结束时刻的链按仍在执行渲染，
 * 不给耗时；被跳过的步骤永远指明拦下它的那次判定。
 *
 * @module @veren/mail-ui/client/activity
 */

import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MailKey } from './locales.ts'
import {
  durationLabel,
  fillCount,
  runBadgeOf,
  skipReasonKeyOf,
  stepBadgeOf,
} from './format.ts'
import type { MailSnapshot, RunView, StepView } from './remote.ts'

/** Everything the activity view needs: the data and the copy. / 执行记录所需：数据与文案。 */
export interface ActivityViewProps {
  /** The snapshot's runs, newest first. / 快照里的执行链，最新在前。 */
  readonly runs: MailSnapshot['runs']
  /** The localized copy. / 本地化文案。 */
  readonly t: (key: MailKey) => string
}

/**
 * The activity view: the run cards, or the right empty state.
 *
 * 执行记录视图：执行链卡片，或正确的空态。
 *
 * @param props - the view's props / 视图属性
 * @returns the view / 视图
 */
export function ActivityView(props: ActivityViewProps): React.JSX.Element {
  const { runs, t } = props
  if (runs.length === 0) {
    return (
      <div className="mail-empty">
        <p className="mail-empty-title">{t('activityEmpty')}</p>
        <p className="mail-empty-sub">{t('activityEmptySub')}</p>
      </div>
    )
  }
  return (
    <ul className="mail-list">
      {runs.map((run) => <RunCard key={run.runId} run={run} t={t} now={Date.now()} />)}
    </ul>
  )
}

/**
 * One execution chain: who ran, what came of it, and every step's judgment.
 *
 * 一条执行链：谁在跑、结果如何、每一步的判定。
 *
 * @param props - the card's props / 卡片属性
 * @returns the card / 卡片
 */
function RunCard(props: {
  readonly run: RunView
  readonly t: (key: MailKey) => string
  readonly now: number
}): React.JSX.Element {
  const { run, t } = props
  const badge = runBadgeOf(run)
  const duration = durationLabel(run.startedAt, run.finishedAt)
  return (
    <li className="mail-item mail-run">
      <div className="mail-run-head">
        <span className="mail-run-title">{run.workflowName}</span>
        <span className={`mail-badge mail-badge-${badge.tone}`}>
          <StateDot state={badge.dot} size={8} />
          {t(badge.key)}
        </span>
        {duration !== undefined && (
          <span className="mail-item-time">{fillCount(t(duration.key), duration.n)}</span>
        )}
      </div>
      <div className="mail-run-meta">
        <span>{fillCount(t(run.recipientCount === 1 ? 'recipient' : 'recipients'), run.recipientCount)}</span>
        <span className="mail-run-tx">{run.transactionId}</span>
      </div>
      <ol className="mail-timeline">
        {run.steps.map((step) => <StepRow key={step.jobId} step={step} t={t} />)}
      </ol>
    </li>
  )
}

/**
 * One step on the timeline: its state dot, its word, and its skip judgment.
 *
 * 时间线上的一步：状态点、状态词与跳过判定。
 *
 * @param props - the step's props / 步骤属性
 * @returns the row / 行
 */
function StepRow(props: {
  readonly step: StepView
  readonly t: (key: MailKey) => string
}): React.JSX.Element {
  const { step, t } = props
  const badge = stepBadgeOf(step)
  const reason = skipReasonKeyOf(step)
  return (
    <li className="mail-step">
      <span className="mail-step-dot"><StateDot state={badge.dot} size={8} /></span>
      <span className="mail-step-name">{step.stepId}</span>
      <span className={`mail-badge mail-badge-${badge.tone}`}>{t(badge.key)}</span>
      {reason !== undefined && (
        <span className="mail-step-reason">{t('skipReason')}：{t(reason)}</span>
      )}
    </li>
  )
}
