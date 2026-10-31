/**
 * The detail pane's target fields: where a new session is created (workspace,
 * preset), which existing session the other actions address, the message they
 * deliver, and the model route installed on the target.
 *
 * Which fields render is decided by the pane (the action chose them); these
 * components render one field each from the draft plus the option sources.
 *
 * 详情面板的目标字段：新会话在哪里创建（工作区、预设），其余动作寻址哪个既有会话，
 * 它们投递的消息，以及装到目标上的模型路由。
 *
 * 渲染哪些字段由面板决定（动作已经选好）；这里的组件各自依据草稿与选项源渲染一个
 * 字段。
 *
 * @module @veren/startup-autostart/client/detail-targets
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupChoicesSnapshot, StartupModelOption } from './choices.ts'
import type { StartupItemView } from './remote.ts'
import { SelectMenu } from './select.tsx'
import type { SelectOption } from './select.tsx'
import { modelKeyOf } from './detail-draft.ts'
import type { Draft, EditDraft } from './detail-draft.ts'
import { FieldLabel } from './detail-fields.tsx'

/** The dropdown options with an unset entry plus a stale stored id kept selectable. */
function keptOptions(current: string, options: readonly SelectOption[], unsetLabel: string): SelectOption[] {
  return [
    { value: '', label: unsetLabel },
    // A stored id that no longer resolves (deleted workspace) stays selectable until edited.
    // 已存的 id 若已无法解析（工作区被删），在编辑前仍保持可选。
    ...(current !== '' && !options.some(option => option.value === current)
      ? [{ value: current, label: current }]
      : []),
    ...options,
  ]
}

/** The model dropdown's options: the pinned route first, then every other route. */
function modelOptions(item: StartupItemView, models: readonly StartupModelOption[], unsetLabel: string): SelectOption[] {
  return [
    ...(item.model === undefined ? [{ value: '', label: unsetLabel }] : []),
    ...(item.model !== undefined
      ? [{ value: modelKeyOf(item.model), label: `${item.model.provider} / ${item.model.model}` }]
      : []),
    ...models
      .filter(option => modelKeyOf(option) !== modelKeyOf(item.model))
      .map(option => ({ value: modelKeyOf(option), label: option.label })),
  ]
}

/** The options-health hint shared by the dropdowns fed by the choices source. */
function ChoicesHints(props: {
  readonly choices: StartupChoicesSnapshot
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <>
      {props.choices.status === 'loading' && <span className="sa-hint">{props.t('panel.detail.choicesLoading')}</span>}
      {props.choices.status === 'error' && <span className="sa-hint">{props.t('panel.detail.choicesFailed')}</span>}
    </>
  )
}

/** The new-session targets: the workspace a session joins and the preset it runs. */
export function NewSessionTargets(props: {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
  readonly workspaces: readonly { readonly value: string; readonly label: string }[]
  readonly choices: StartupChoicesSnapshot
}): React.ReactElement {
  return (
    <>
      <div className="sa-field">
        <span className="sa-field-label" id="sa-ws-label">{props.t('panel.detail.field.workspace')}</span>
        <SelectMenu ariaLabel={props.t('panel.detail.field.workspace')} value={props.draft.workspaceId}
          onChange={value => { props.edit('workspaceId', value) }}
          options={keptOptions(props.draft.workspaceId, props.workspaces, props.t('panel.detail.unset'))} />
      </div>
      <div className="sa-field">
        <span className="sa-field-label" id="sa-preset-label">{props.t('panel.detail.field.preset')}</span>
        <SelectMenu ariaLabel={props.t('panel.detail.field.preset')} value={props.draft.preset}
          onChange={value => { props.edit('preset', value) }}
          options={keptOptions(props.draft.preset, props.choices.presets, props.t('panel.detail.unset'))} />
        <ChoicesHints choices={props.choices} t={props.t} />
      </div>
    </>
  )
}

/** The target session id every action except new_session requires. */
export function SessionField(props: {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <div className="sa-field">
      <label className="sa-field-label" htmlFor="sa-session">
        <FieldLabel required text={props.t('panel.detail.field.session')} t={props.t} />
      </label>
      <input id="sa-session" className="sa-field-input" value={props.draft.sessionId}
        onChange={event => { props.edit('sessionId', event.target.value) }} />
    </div>
  )
}

/** The message a wake or queue action delivers; required by those, hidden on resume. */
export function MessageField(props: {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <div className="sa-field">
      <label className="sa-field-label" htmlFor="sa-message">
        <FieldLabel required={props.draft.action === 'message_session' || props.draft.action === 'queue_message'}
          text={props.t('panel.detail.field.message')} t={props.t} />
      </label>
      <textarea id="sa-message" className="sa-field-textarea" value={props.draft.message}
        onChange={event => { props.edit('message', event.target.value) }} />
    </div>
  )
}

/** The model route installed on the target Session after it becomes live. */
export function ModelField(props: {
  readonly item: StartupItemView
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
  readonly choices: StartupChoicesSnapshot
}): React.ReactElement {
  return (
    <div className="sa-field">
      <span className="sa-field-label" id="sa-model-label">{props.t('panel.detail.field.model')}</span>
      <SelectMenu ariaLabel={props.t('panel.detail.field.model')} value={props.draft.modelKey}
        onChange={value => { props.edit('modelKey', value) }}
        options={modelOptions(props.item, props.choices.models, props.t('panel.detail.unset'))} />
      <ChoicesHints choices={props.choices} t={props.t} />
    </div>
  )
}
