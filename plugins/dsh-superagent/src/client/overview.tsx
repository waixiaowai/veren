/** Overview page: system pulse verdict first, then pending Tickets, active problems, 24-hour flow, and Executor load. */
/* 概览页：先给系统脉冲判决，再依次是待处理工单、系统问题、24 小时流量与执行器负载。 */
import type { ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { usePoll, type Problem, type SetupView } from './api.ts'
import { Button, Dot, Icon } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { TicketLine } from './rows.tsx'
import { healthText, localized, reasonLabel, valueLabel, readableMarkers } from './text.ts'
import { CheckSetupButton, ConfirmButton, Hint, LoadState, Metrics, Section, SetupMessage, type MetricItem } from './widgets.tsx'

type OverviewView = ApiResponse<'GET overview'>
type PulseTone = 'ok' | 'degraded' | 'paused' | 'error'
/** Pulse tone → status dot color; quiet is a calm success green, not gray. 判决色→状态点；安静用沉静的绿而不是灰。 */
const PULSE_DOT: Record<PulseTone, 'done' | 'warning' | 'error'> = { ok: 'done', degraded: 'warning', paused: 'warning', error: 'error' }

/** Derives the system verdict: halting setup > paused > any other problem > quiet. 判决推导：阻断性设置 > 已暂停 > 其他问题 > 安静。 */
function pulseOf(problems: Problem[]): { tone: PulseTone; count: number } {
  // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
  const halted = problems.some(problem => problem.kind === 'setup' && problem.place !== 'feishu')
  if (halted) return { tone: 'error', count: problems.length }
  if (problems.some(problem => problem.kind === 'executor-paused')) return { tone: 'paused', count: problems.length }
  return problems.length ? { tone: 'degraded', count: problems.length } : { tone: 'ok', count: 0 }
}

function ProblemLine({ problem, onChanged }: { problem: Problem; onChanged: () => Promise<void> }) {
  const { t, call, navigate } = usePanel()
  const post = useAction((request: () => Promise<unknown>) => request(), { reload: onChanged })
  const row = (title: string, detail: ReactNode, route: Route | undefined, hint?: string, actions?: ReactNode) => <li
    className="dt-row dt-link dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">{route ? <button type="button" className="dt-open dt-open-wrap"
        onClick={() => navigate(route)}>{title}</button> : title}</div>
      {detail}{hint && <Hint>{hint}</Hint>}{actions && <div className="dt-row-meta dt-row-buttons">{actions}</div>}
    </div>
  </li>
  const go = (label: string, route: Route) => <Button variant="outline" size="sm" icon={<Icon name="settings"
    size={14} />} onClick={() => navigate(route)}>{label}</Button>
  const raw = (text: string | undefined) => text && <p className="dt-error dt-clamp dt-mono">{text}</p>
  const worded = (text: string) => <p className="dt-error">{text}</p>
  switch (problem.kind) {
    // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
    case 'setup': return row(t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup'), <p className="dt-error"><SetupMessage
      problem={problem} /></p>,
      setupPage(problem.place), t(`problemSetupFix.${problem.place}`), <CheckSetupButton />)
    case 'no-source': return row(t('problemNoSource'), undefined, settingsRoute('source'), undefined, go(t('actionOpenSources'),
      settingsRoute('source')))
    case 'no-allowed': return row(t('problemNoAllowed'), undefined, settingsRoute('eval'), undefined, go(t('actionAddAllowed'),
      settingsRoute('eval')))
    case 'executor-paused': return row(t('problemPaused'), undefined, { page: 'execution' }, undefined,
      <ConfirmButton variant="outline" icon="play" label={t('resumeProcessing')} title={t('resumeProcessing')}
        message={t('resumeProcessingConfirm')}
        onConfirm={async () => { await call('POST executor/pause', { body: { paused: false } }); await onChanged() }} />)
    case 'runtime-error': return row(t('problemRuntime', { name: valueLabel(t, 'health', problem.name) }), raw(problem.detail), undefined)
    case 'source-error': {
      const health = problem.source.health
      return row(t('sourceError', { source: localized(t, problem.source.title) }), health.code ? worded(healthText(t, health))
        : raw(health.detail), { page: 'source' }, t('sourceErrorHint'))
    }
    case 'eval-overdue': return row(t('problemEvalOverdue', { thread: readableMarkers(t, problem.thread.title) }), undefined, { page: 'trigger',
      id: problem.thread.key })
    case 'eval-unavailable': return row(t('problemEvalUnavailable', { thread: readableMarkers(t, problem.thread.title) }), raw(reasonLabel(t,
      problem.reason)),
      { page: 'trigger', id: problem.thread.key, query: { trigger: problem.triggerId } }, undefined, <>
        <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST triggers/:id/requeue', { id: problem.triggerId })) }}>{t('requeue')}</Button>
        <Button variant="outline" size="sm" icon={<Icon name="dismiss" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST decisions/:id/dismiss', { id: problem.decisionId })) }}>{t('dismiss')}</Button>
      </>)
    case 'outgoing': return row(t('problemReply', { source: valueLabel(t, 'source', problem.outgoing.channel.source),
      attempts: problem.outgoing.attempts }),
      raw(problem.outgoing.error), undefined)
  }
}

/** The system pulse: a one-glance verdict band with quick counts; resuming is offered inline only when paused. */
/* 系统脉冲：一眼可读的判决条 + 快捷计数；仅暂停时内联提供恢复入口。 */
function Pulse({ data, onChanged }: { data: OverviewView; onChanged: () => Promise<void> }) {
  const { t, call } = usePanel()
  const { tone, count } = pulseOf(data.problems)
  const title = tone === 'ok' ? t('pulseOk') : tone === 'paused' ? t('processingPaused')
    : tone === 'error' ? t('pulseSetupTitle') : t('pulseDegraded', { count })
  const note = tone === 'ok' ? t('pulseOkNote') : tone === 'paused' ? t('pulsePausedNote')
    : tone === 'error' ? t('pulseSetupNote') : undefined
  const stat = (label: string, value: ReactNode) => <span className="dt-stat"><span className="dt-stat-label">{label}</span>
    <span className="dt-stat-value">{value}</span></span>
  return <section className="dt-pulse" data-tone={tone}>
    <div className="dt-pulse-head">
      <h2 className="dt-pulse-title" data-tone={tone}><Dot state={PULSE_DOT[tone]} />{title}</h2>
      {tone === 'paused' && <span className="dt-pulse-action">
        <ConfirmButton variant="outline" icon="play" label={t('resumeProcessing')} title={t('resumeProcessing')}
          message={t('resumeProcessingConfirm')}
          onConfirm={async () => { await call('POST executor/pause', { body: { paused: false } }); await onChanged() }} /></span>}
    </div>
    {note && <p className="dt-pulse-note">{note}</p>}
    <div className="dt-pulse-stats">
      {stat(t('flowReceivedLabel'), data.flow.received)}
      {stat(t('flowJudgedLabel'), data.flow.judged)}
      {stat(t('flowAcceptedLabel'), data.flow.accepted)}
      {stat(t('executingLabel'), `${data.executor.running} / ${data.executor.maxWorkers}`)}
    </div>
  </section>
}

/** 24-hour flow as metric tiles; link targets follow the original stat contract exactly. 24 小时流量瓦片；链接目标与原 stat 契约一致。 */
function FlowSection({ flow, more }: { flow: OverviewView['flow']; more: ReactNode }) {
  const { t } = usePanel()
  // Received and evaluated counts operate on Triggers rather than Threads or Decisions, so they do not link to filtered views.
  const items: MetricItem[] = [
    { label: t('flowReceivedLabel'), value: flow.received, state: flow.received ? undefined : 'muted' },
    { label: t('flowFilteredLabel'), value: flow.filtered, state: flow.filtered ? 'error' : 'muted',
      to: flow.filtered ? { page: 'source' } : undefined },
    { label: t('flowJudgedLabel'), value: flow.judged, state: flow.judged ? undefined : 'muted' },
    { label: t('flowAcceptedLabel'), value: flow.accepted, state: flow.accepted ? undefined : 'muted',
      to: { page: 'eval', query: { window: '24h' } } },
  ]
  if (flow.dropped > 0) items.push({ label: t('flowDroppedLabel'), value: flow.dropped, state: 'error', to: { page: 'source' } })
  return <Section title={t('lastDay')} action={more}><Metrics items={items} /></Section>
}

/** Executor load tiles; while setup waits nothing runs, so the section keeps its waiting hint. 执行器负载瓦片；等待部署检查时保留提示。 */
function ExecutorSection({ executor, setup, more }: { executor: OverviewView['executor']; setup: SetupView | undefined; more: ReactNode }) {
  const { t } = usePanel()
  // Pauses surface in `problems` above, so Executor counts render the same in both states; while setup waits, nothing runs.
  return <Section title={t('term.executor')} action={more}>
    {setup?.problem ? <Hint>{t('executorWaitingSetup')}</Hint> : <Metrics items={[
      { label: t('executingLabel'), value: `${executor.running} / ${executor.maxWorkers}`, state: executor.running ? undefined : 'muted' },
      { label: t('queuedLabel'), value: executor.queued, state: executor.queued ? 'error' : 'muted' },
      { label: t('idleLabel'), value: executor.idle, state: executor.idle ? undefined : 'muted' },
    ]} />}
  </Section>
}

export function OverviewPage() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET overview'), [])
  if (!data) return <LoadState error={error} loading />
  const more = (route: Route) => <button type="button" className="dt-textlink dt-more-link"
    onClick={() => navigate(route)}>{t('details')}</button>
  return <>
    {error && <LoadState error={error} loading={false} />}
    <Pulse data={data} onChanged={reload} />
    <Section title={t('pendingTickets')} count={data.person.length}>
      {data.person.length ? <ul className="dt-list dt-cards">{data.person.map(ticket => <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reload} />)}</ul>
        : <p className="dt-empty">{t('needsYouNone')}</p>}
    </Section>
    {data.problems.length > 0 && <Section title={t('problems')} count={data.problems.length}>
      <ul className="dt-list dt-cards">{data.problems.map((problem, index) => <ProblemLine key={index} problem={problem}
        onChanged={reload} />)}</ul>
    </Section>}
    <FlowSection flow={data.flow} more={more({ page: 'trigger', query: { filter: 'recent' } })} />
    <ExecutorSection executor={data.executor} setup={setup} more={more({ page: 'execution' })} />
  </>
}
