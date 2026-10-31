/**
 * The detail pane's read-only facts and its status line.
 *
 * Read-only facts stay visible so the operator can compare the draft with what
 * the Host actually committed; the status line reports the last operation in
 * the danger tone on failure and the neutral one otherwise.
 *
 * 详情面板的只读事实与状态行。只读事实始终可见，便于把草稿与宿主真正提交的结果对照；
 * 状态行汇报上一次操作：失败用警示色，其余用中性色。
 *
 * @module @veren/startup-autostart/client/detail-facts
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupItemView } from './remote.ts'
import { Field } from './detail-fields.tsx'

/** The committed facts of one item: instants, last outcome, and the run count. */
export function DetailFacts(props: {
  readonly item: StartupItemView
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  const { item, t } = props
  const outcome = item.lastOutcome
  return (
    <>
      <Field label={t('panel.detail.field.createdAt')} value={item.createdAt} />
      <Field label={t('panel.detail.field.updatedAt')} value={item.updatedAt} />
      <Field label={t('panel.detail.field.lastRunAt')} value={item.lastRunAt ?? t('panel.run.never')} />
      <Field label={t('panel.detail.field.lastOutcome')} value={outcome === undefined
        ? t('panel.detail.unset')
        : `${t(outcome.status === 'ok' ? 'panel.run.ok' : 'panel.run.failed')} · ${outcome.detail}`} />
      <Field label={t('panel.detail.field.runCount')} value={String(item.runCount)} />
    </>
  )
}

/** The pane's status line: a failure uses the danger tone, a success the neutral one. */
export function statusNote(
  note: string | undefined,
  bad: boolean,
  t: PropsLocale<'startup.panel'>['t'],
): React.ReactElement | null {
  if (note === undefined) return null
  return <p className={bad ? 'sa-note-bad' : 'sa-note'}>{bad ? t('panel.detail.failed', { message: note }) : note}</p>
}
