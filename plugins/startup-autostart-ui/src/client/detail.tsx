/**
 * One item's detail pane: full fields, editing, deletion, and a manual run.
 *
 * The pane edits a local draft and never writes on its own: a save goes through
 * the injected `onUpdate`, which reaches `startup/update`; a delete confirms
 * first, then reaches `startup/delete`; the run button reaches `startup/run`.
 * This module only composes the pane; its state lives in `detail-state.ts`, its
 * editable fields in `detail-fields.tsx` and `detail-targets.tsx`, its facts in
 * `detail-facts.tsx`, and its buttons in `detail-actions.tsx`.
 *
 * 单条启动项的详情面板：完整字段、编辑、删除、手动执行。面板只编辑本地草稿，不会自行
 * 写入：保存走注入的 `onUpdate` → `startup/update`；删除先确认再走 `startup/delete`；
 * 运行按钮走 `startup/run`。本模块只负责组装面板：状态在 `detail-state.ts`，可编辑
 * 字段在 `detail-fields.tsx` 与 `detail-targets.tsx`，只读事实在 `detail-facts.tsx`，
 * 按钮在 `detail-actions.tsx`。
 *
 * @module @veren/startup-autostart/client/detail
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupChoicesSnapshot } from './choices.ts'
import type { StartupItemView } from './remote.ts'
import { ActionField, DetailHeader, EnabledField, NameField } from './detail-fields.tsx'
import { DetailFacts, statusNote } from './detail-facts.tsx'
import { MessageField, ModelField, NewSessionTargets, SessionField } from './detail-targets.tsx'
import { DeleteConfirm, DetailButtons } from './detail-actions.tsx'
import { useStartupDetailPane } from './detail-state.ts'

export type { StartupDetailActions } from './detail-state.ts'
import type { StartupDetailActions } from './detail-state.ts'

/** Props of {@link StartupDetail}. */
export type StartupDetailProps = StartupDetailActions
  & PropsLocale<'startup.panel'>
  & {
    readonly item: StartupItemView
    /** Registered workspaces for the workspace dropdown (`id` + display title). */
    readonly workspaces: readonly { readonly value: string; readonly label: string }[]
    /** Preset and model options for the two other dropdowns. */
    readonly choices: StartupChoicesSnapshot
  }

/**
 * Render one item's detail pane.
 * @param props - the selected item, localized copy, and the injected actions.
 * @returns the editable detail form with its run and delete affordances.
 */
export function StartupDetail(props: StartupDetailProps): React.ReactElement {
  const { item, t, workspaces, choices, onUpdate, onDelete, onRun } = props
  const pane = useStartupDetailPane({ item, t, onUpdate, onDelete, onRun, models: choices.models })
  return (
    <section className="sa-detail" aria-label={t('panel.detail.title')}>
      <DetailHeader item={item} t={t} />
      <NameField draft={pane.draft} edit={pane.edit} t={t} />
      <EnabledField draft={pane.draft} edit={pane.edit} t={t} />
      <ActionField draft={pane.draft} edit={pane.edit} t={t} />
      {pane.draft.action === 'new_session' && (
        <NewSessionTargets draft={pane.draft} edit={pane.edit} t={t} workspaces={workspaces} choices={choices} />
      )}
      {pane.draft.action !== 'new_session' && <SessionField draft={pane.draft} edit={pane.edit} t={t} />}
      {pane.draft.action !== 'resume_session' && <MessageField draft={pane.draft} edit={pane.edit} t={t} />}
      <ModelField item={item} draft={pane.draft} edit={pane.edit} t={t} choices={choices} />
      <DetailFacts item={item} t={t} />
      {statusNote(pane.note, pane.bad, t)}
      <DetailButtons pane={pane} t={t} />
      {pane.confirming && <DeleteConfirm item={item} pane={pane} t={t} />}
      {pane.dirty && <p className="sa-note">{t('panel.detail.unsaved')}</p>}
    </section>
  )
}
