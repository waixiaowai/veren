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
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupChoicesSnapshot, StartupModelOption } from './choices.ts'
import type { StartupItemRequest, StartupItemView } from './remote.ts'
import { STARTUP_ACTIONS } from './remote.ts'
import { SelectMenu } from './select.tsx'

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
 * The required-field marker: a danger asterisk with an accessible title, so a
 * user can tell which fields must be filled before a save is accepted.
 * 必填标识：带无障碍标题的红色星号，用户能看出哪些字段必须填写才能保存。
 */
function RequiredMark(props: { readonly t: PropsLocale<'startup.panel'>['t'] }): React.ReactElement {
  return <span className="sa-required" title={props.t('panel.detail.required')}> *</span>
}

/**
 * A required marker plus the localized label text, for the editable fields.
 * 可编辑字段的标签：必填标识 + 本地化文案。
 */
function FieldLabel(props: {
  readonly required: boolean
  readonly text: string
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return <>{props.text}{props.required && <RequiredMark t={props.t} />}</>
}

/**
 * Client-side validation mirroring the Host's required-field rules, so a save
 * is rejected with a readable message before it ever reaches `startup/update`.
 * 与宿主必填规则一致的客户端校验：不满足时先给出可读提示，不发出 `startup/update`。
 * @param draft - current draft values.
 * @param t - locale resolver for the error copy.
 * @returns the first violation's message, or `undefined` when the draft is valid.
 */
function validateDraft(draft: Draft, t: PropsLocale<'startup.panel'>['t']): string | undefined {
  if (draft.name.trim() === '') return t('panel.detail.error.nameRequired')
  // Session id is required by every action except creating a brand-new session.
  // 除新建会话外，其余动作都要求会话 id。
  if (draft.action !== 'new_session' && draft.sessionId.trim() === '') {
    return t('panel.detail.error.sessionRequired')
  }
  // The host requires a message body for wake and queue actions.
  // 宿主要求唤醒与投递动作必须携带消息正文。
  if ((draft.action === 'message_session' || draft.action === 'queue_message') && draft.message.trim() === '') {
    return t('panel.detail.error.messageRequired')
  }
  return undefined
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
  // The directory (cwd) input was removed: workspace is the only new-session
  // target the panel edits, so the mutual-exclusion dance is gone for good.
  // 目录输入已移除：工作区是面板编辑的唯一新会话目标，二选一的清空逻辑随之删除。
  const report = (failure: string | undefined, okText: string): void => {
    setBad(failure !== undefined)
    setNote(failure ?? okText)
  }

  /** Validate first, then persist the draft and re-seed it from the Host's answer. */
  const save = async (): Promise<void> => {
    // A required field left blank stops here with a readable message.
    // 必填字段为空时在这里停下并给出可读提示。
    const violation = validateDraft(draft, t)
    if (violation !== undefined) {
      setBad(true)
      setNote(violation)
      return
    }
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
        <label className="sa-field-label" htmlFor="sa-name">
          <FieldLabel required text={t('panel.detail.field.name')} t={t} />
        </label>
        <input id="sa-name" className="sa-field-input" value={draft.name}
          onChange={event => { edit('name', event.target.value) }} />
      </div>
      <Checkbox checked={draft.enabled} label={t('panel.detail.field.enabled')}
        onChange={next => { edit('enabled', next) }} />
      <div className="sa-field">
        <span className="sa-field-label" id="sa-action-label">{t('panel.detail.field.action')}</span>
        <SelectMenu ariaLabel={t('panel.detail.field.action')} value={draft.action}
          options={STARTUP_ACTIONS.map(action => ({ value: action, label: t(`panel.action.${action}`) }))}
          onChange={value => { edit('action', value as Draft['action']) }} />
      </div>
      {draft.action === 'new_session' && <>
        <div className="sa-field">
          <span className="sa-field-label" id="sa-ws-label">{t('panel.detail.field.workspace')}</span>
          <SelectMenu ariaLabel={t('panel.detail.field.workspace')} value={draft.workspaceId}
            onChange={value => { edit('workspaceId', value) }}
            options={[
              { value: '', label: t('panel.detail.unset') },
              // A stored id that no longer resolves (deleted workspace) stays selectable until edited.
              // 已存的 id 若已无法解析（工作区被删），在编辑前仍保持可选。
              ...(draft.workspaceId !== '' && !workspaces.some(workspace => workspace.value === draft.workspaceId)
                ? [{ value: draft.workspaceId, label: draft.workspaceId }]
                : []),
              ...workspaces,
            ]} />
        </div>
        <div className="sa-field">
          <span className="sa-field-label" id="sa-preset-label">{t('panel.detail.field.preset')}</span>
          <SelectMenu ariaLabel={t('panel.detail.field.preset')} value={draft.preset}
            onChange={value => { edit('preset', value) }}
            options={[
              { value: '', label: t('panel.detail.unset') },
              ...(draft.preset !== '' && !choices.presets.some(preset => preset.value === draft.preset)
                ? [{ value: draft.preset, label: draft.preset }]
                : []),
              ...choices.presets,
            ]} />
          {choices.status === 'loading' && <span className="sa-hint">{t('panel.detail.choicesLoading')}</span>}
          {choices.status === 'error' && <span className="sa-hint">{t('panel.detail.choicesFailed')}</span>}
        </div>
      </>}
      {draft.action !== 'new_session' && <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-session">
          <FieldLabel required text={t('panel.detail.field.session')} t={t} />
        </label>
        <input id="sa-session" className="sa-field-input" value={draft.sessionId}
          onChange={event => { edit('sessionId', event.target.value) }} />
      </div>}
      {draft.action !== 'resume_session' && <div className="sa-field">
        <label className="sa-field-label" htmlFor="sa-message">
          <FieldLabel required={draft.action === 'message_session' || draft.action === 'queue_message'}
            text={t('panel.detail.field.message')} t={t} />
        </label>
        <textarea id="sa-message" className="sa-field-textarea" value={draft.message}
          onChange={event => { edit('message', event.target.value) }} />
      </div>}
      <div className="sa-field">
        <span className="sa-field-label" id="sa-model-label">{t('panel.detail.field.model')}</span>
        <SelectMenu ariaLabel={t('panel.detail.field.model')} value={draft.modelKey}
          onChange={value => { edit('modelKey', value) }}
          options={[
            ...(item.model === undefined ? [{ value: '', label: t('panel.detail.unset') }] : []),
            ...(item.model !== undefined
              ? [{ value: modelKeyOf(item.model), label: `${item.model.provider} / ${item.model.model}` }]
              : []),
            ...choices.models
              .filter(option => modelKeyOf(option) !== modelKeyOf(item.model))
              .map(option => ({ value: modelKeyOf(option), label: option.label })),
          ]} />
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
