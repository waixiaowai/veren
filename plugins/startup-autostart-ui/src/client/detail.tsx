/**
 * One item's detail pane: full fields, editing, deletion, and a manual run.
 *
 * The pane edits a local draft and never writes on its own: a save goes through
 * the injected `onUpdate`, which reaches `startup/update`; a delete confirms
 * first, then reaches `startup/delete`; the run button reaches `startup/run`.
 * Read-only facts stay visible so the operator can compare the draft with what
 * the Host actually committed.
 *
 * 单条启动项的详情面板：完整字段、编辑、删除、手动执行。面板只编辑本地草稿，不会自行
 * 写入：保存走注入的 `onUpdate` → `startup/update`；删除先确认再走 `startup/delete`；
 * 运行按钮走 `startup/run`。只读事实始终可见，便于把草稿与宿主真正提交的结果对照。
 *
 * @module @veren/startup-autostart/client/detail
 */

import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupChoicesSnapshot, StartupModelOption } from './choices.ts'
import type { StartupItemRequest, StartupItemView } from './remote.ts'
import { STARTUP_ACTIONS } from './remote.ts'

/** Actions the detail pane performs through the plugin's injected callbacks. */
export interface StartupDetailActions {
  /** Persist an edit; resolves to a failure message, or `undefined` on success. */
  readonly onUpdate: (request: StartupItemRequest & { readonly id: string }) => Promise<string | undefined>
  /** Delete one item; resolves to a failure message, or `undefined` on success. */
  readonly onDelete: (id: string) => Promise<string | undefined>
  /** Run one item now; resolves to the retained outcome. */
  readonly onRun: (id: string) => Promise<{ readonly ok: boolean; readonly detail: string }>
}

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

/** The editable subset of an item, held as strings so inputs stay controlled. */
interface Draft {
  readonly name: string
  readonly enabled: boolean
  readonly action: StartupItemView['action']
  readonly message: string
  readonly sessionId: string
  readonly cwd: string
  readonly workspaceId: string
  readonly preset: string
  /** Select key of the pinned model route; empty means unset. */
  readonly modelKey: string
}

/** The select key that identifies one model route. */
function modelKeyOf(model: { readonly provider: string; readonly model: string } | undefined): string {
  return model === undefined ? '' : `${model.provider}\u0000${model.model}`
}

/** The request target behind one select key, or `undefined` when unset. */
function modelTargetOf(key: string, models: readonly StartupModelOption[]): StartupItemRequest['model'] {
  if (key === '') return undefined
  const found = models.find(option => modelKeyOf(option) === key)
  return found === undefined ? undefined : { provider: found.provider, model: found.model }
}

/** Seed a draft from the committed item. */
function draftOf(item: StartupItemView): Draft {
  return {
    name: item.name,
    enabled: item.enabled,
    action: item.action,
    message: item.message ?? '',
    sessionId: item.sessionId ?? '',
    cwd: item.cwd ?? '',
    workspaceId: item.workspaceId ?? '',
    preset: item.preset ?? '',
    modelKey: modelKeyOf(item.model),
  }
}

/**
 * Collect only the fields the draft changed, so an untouched field keeps its
 * stored value on the Host and a concurrent edit elsewhere survives.
 *
 * A field is omitted rather than sent as `undefined`, and a cleared target is
 * sent as an empty string, which the Host reads as "remove this target".
 * @param item - committed item the draft started from.
 * @param draft - current draft values.
 * @returns the update request for `startup/update`.
 */
function changedFields(
  item: StartupItemView,
  draft: Draft,
  models: readonly StartupModelOption[],
): StartupItemRequest & { readonly id: string } {
  const committed = draftOf(item)
  /** Spread a field only when the draft actually moved it. */
  const when = <K extends keyof Draft>(key: K): Partial<Pick<Draft, K>> =>
    draft[key] === committed[key] ? {} : { [key]: draft[key] } as Pick<Draft, K>
  // The Host has no "clear model" verb, so the form only ever sends a route:
  // the unset entry is not rendered while the item pins one.
  // 宿主没有"清除模型"动词，因此表单只会提交路由：已设模型时不渲染未设置项。
  const nextModel = modelTargetOf(draft.modelKey, models) ?? item.model
  const model = draft.modelKey === committed.modelKey || nextModel === undefined
    ? {}
    : { model: nextModel }
  return {
    id: item.id,
    ...when('name'),
    ...when('enabled'),
    ...when('action'),
    ...when('message'),
    ...when('sessionId'),
    ...when('cwd'),
    ...when('workspaceId'),
    ...when('preset'),
    ...model,
  }
}

/** One read-only fact row. */
function Field(props: { readonly label: string; readonly value: string }): React.ReactElement {
  return (
    <div className="sa-field">
      <span className="sa-field-label">{props.label}</span>
      <span className="sa-field-value">{props.value}</span>
    </div>
  )
}

/**
 * Render one item's detail pane.
 * @param props - the selected item, localized copy, and the injected actions.
 * @returns the editable detail form with its run and delete affordances.
 */
export function StartupDetail({ item, t, workspaces, choices, onUpdate, onDelete, onRun }: StartupDetailProps): React.ReactElement {
  const [draft, setDraft] = useState<Draft>(() => draftOf(item))
  const [note, setNote] = useState<string | undefined>(undefined)
  const [bad, setBad] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(item))
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }))
    setNote(undefined)
  }
  // The Host accepts cwd or workspaceId, never both, so picking one clears
  // the other in the draft and the save can never send both.
  // 宿主只接受目录或工作区其一，因此选定其一即在草稿里清空另一者，保存时绝不会
  // 同时提交两者。
  const editCwd = (value: string): void => {
    setDraft(current => ({ ...current, cwd: value, workspaceId: '' }))
    setNote(undefined)
  }
  const editWorkspace = (value: string): void => {
    setDraft(current => ({ ...current, workspaceId: value, cwd: '' }))
    setNote(undefined)
  }
  const report = (failure: string | undefined, okText: string): void => {
    setBad(failure !== undefined)
    setNote(failure ?? okText)
  }

  /** Persist the draft, then re-seed it from the Host's answer. */
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      report(await onUpdate(changedFields(item, draft, choices.models)), t('panel.detail.saved'))
    } finally {
      setBusy(false)
    }
  }

  /** Run the item once and surface the retained outcome. */
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const outcome = await onRun(item.id)
      setBad(!outcome.ok)
      setNote(t(outcome.ok ? 'panel.detail.run.ok' : 'panel.detail.run.failed', { detail: outcome.detail }))
    } finally {
      setBusy(false)
    }
  }

  /** Delete after the confirmation, surfacing any failure. */
  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      const failure = await onDelete(item.id)
      setBad(failure !== undefined)
      setNote(failure ?? t('panel.detail.deleted'))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  const outcome = item.lastOutcome
  return (
    <section className="sa-detail" aria-label={t('panel.detail.title')}>
      <header className="sa-detail-head">
        <h3 className="sa-detail-title">{t('panel.detail.title')}</h3>
        <span className="sa-hint">{item.id}</span>
      </header>
      <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-name">{t('panel.detail.field.name')}</label>
        <input id="sa-name" className="sa-field-input" value={draft.name}
          onChange={event => { edit('name', event.target.value) }} />
      </div>
      <label className="sa-field sa-field-check" htmlFor="sa-enabled">
        <input id="sa-enabled" type="checkbox" checked={draft.enabled}
          onChange={event => { edit('enabled', event.target.checked) }} />
        <span className="sa-field-label">{t('panel.detail.field.enabled')}</span>
      </label>
      <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-action">{t('panel.detail.field.action')}</label>
        <select id="sa-action" className="sa-field-select" value={draft.action}
          onChange={event => { edit('action', event.target.value as Draft['action']) }}>
          {STARTUP_ACTIONS.map(action => <option key={action} value={action}>{t(`panel.action.${action}`)}</option>)}
        </select>
      </div>
      {draft.action === 'new_session' && <>
        <div className="sa-field">
          <label className="sa-field-label" htmlFor="sa-cwd">{t('panel.detail.field.cwd')}</label>
          <input id="sa-cwd" className="sa-field-input" value={draft.cwd}
            onChange={event => { editCwd(event.target.value) }} />
        </div>
        <div className="sa-field">
          <label className="sa-field-label" htmlFor="sa-ws">{t('panel.detail.field.workspace')}</label>
          <select id="sa-ws" className="sa-field-select" value={draft.workspaceId}
            onChange={event => { editWorkspace(event.target.value) }}>
            <option value="">{t('panel.detail.unset')}</option>
            {/* A stored id that no longer resolves (deleted workspace) stays selectable until edited. */}
            {/* 已存的 id 若已无法解析（工作区被删），在编辑前仍保持可选。 */}
            {draft.workspaceId !== '' && !workspaces.some(workspace => workspace.value === draft.workspaceId)
              && <option value={draft.workspaceId}>{draft.workspaceId}</option>}
            {workspaces.map(workspace => (
              <option key={workspace.value} value={workspace.value}>{workspace.label}</option>
            ))}
          </select>
        </div>
        <div className="sa-field">
          <label className="sa-field-label" htmlFor="sa-preset">{t('panel.detail.field.preset')}</label>
          <select id="sa-preset" className="sa-field-select" value={draft.preset}
            onChange={event => { edit('preset', event.target.value) }}>
            <option value="">{t('panel.detail.unset')}</option>
            {draft.preset !== '' && !choices.presets.some(preset => preset.value === draft.preset)
              && <option value={draft.preset}>{draft.preset}</option>}
            {choices.presets.map(preset => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
          </select>
          {choices.status === 'loading' && <span className="sa-hint">{t('panel.detail.choicesLoading')}</span>}
          {choices.status === 'error' && <span className="sa-hint">{t('panel.detail.choicesFailed')}</span>}
        </div>
      </>}
      {draft.action !== 'new_session' && <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-session">{t('panel.detail.field.session')}</label>
        <input id="sa-session" className="sa-field-input" value={draft.sessionId}
          onChange={event => { edit('sessionId', event.target.value) }} />
      </div>}
      {draft.action !== 'resume_session' && <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-message">{t('panel.detail.field.message')}</label>
        <textarea id="sa-message" className="sa-field-textarea" value={draft.message}
          onChange={event => { edit('message', event.target.value) }} />
      </div>}
      <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-model">{t('panel.detail.field.model')}</label>
        <select id="sa-model" className="sa-field-select" value={draft.modelKey}
          onChange={event => { edit('modelKey', event.target.value) }}>
          {item.model === undefined && <option value="">{t('panel.detail.unset')}</option>}
          {item.model !== undefined
            && <option value={modelKeyOf(item.model)}>{`${item.model.provider} / ${item.model.model}`}</option>}
          {choices.models.filter(option => modelKeyOf(option) !== modelKeyOf(item.model)).map(option => (
            <option key={`${option.provider}\u0000${option.model}`} value={modelKeyOf(option)}>{option.label}</option>
          ))}
        </select>
        {choices.status === 'loading' && <span className="sa-hint">{t('panel.detail.choicesLoading')}</span>}
        {choices.status === 'error' && <span className="sa-hint">{t('panel.detail.choicesFailed')}</span>}
      </div>
      <Field label={t('panel.detail.field.createdAt')} value={item.createdAt} />
      <Field label={t('panel.detail.field.updatedAt')} value={item.updatedAt} />
      <Field label={t('panel.detail.field.lastRunAt')} value={item.lastRunAt ?? t('panel.run.never')} />
      <Field label={t('panel.detail.field.lastOutcome')} value={outcome === undefined
        ? t('panel.detail.unset')
        : `${t(outcome.status === 'ok' ? 'panel.run.ok' : 'panel.run.failed')} · ${outcome.detail}`} />
      <Field label={t('panel.detail.field.runCount')} value={String(item.runCount)} />
      {debugNote(note, bad, t)}
      <div className="sa-actions">
        <button type="button" className="sa-btn sa-btn-primary" disabled={busy || !dirty} onClick={() => { void save() }}>
          {busy ? t('panel.detail.saving') : t('panel.detail.save')}
        </button>
        <button type="button" className="sa-btn" disabled={busy || !dirty} onClick={() => { setDraft(draftOf(item)); setNote(undefined) }}>
          {t('panel.detail.revert')}
        </button>
        <button type="button" className="sa-btn" disabled={busy} onClick={() => { void run() }}>
          {busy ? t('panel.detail.running') : t('panel.detail.run')}
        </button>
        <button type="button" className="sa-btn sa-btn-danger" disabled={busy} onClick={() => { setConfirming(true) }}>
          {t('panel.detail.delete')}
        </button>
      </div>
      {confirming && <div className="sa-actions" role="alertdialog" aria-label={t('panel.detail.deleteConfirm', { name: item.name })}>
        <span className="sa-note">{t('panel.detail.deleteConfirm', { name: item.name })}</span>
        <button type="button" className="sa-btn sa-btn-danger" disabled={busy} onClick={() => { void remove() }}>
          {t('panel.detail.deleteYes')}
        </button>
        <button type="button" className="sa-btn" disabled={busy} onClick={() => { setConfirming(false) }}>
          {t('panel.detail.deleteNo')}
        </button>
      </div>}
      {dirty && <p className="sa-note">{t('panel.detail.unsaved')}</p>}
    </section>
  )
}

/** The pane's status line: a failure uses the danger tone, a success the neutral one. */
function debugNote(
  note: string | undefined,
  bad: boolean,
  t: PropsLocale<'startup.panel'>['t'],
): React.ReactElement | null {
  if (note === undefined) return null
  return <p className={bad ? 'sa-note-bad' : 'sa-note'}>{bad ? t('panel.detail.failed', { message: note }) : note}</p>
}
