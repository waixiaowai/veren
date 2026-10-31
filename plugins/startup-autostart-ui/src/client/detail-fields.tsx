/**
 * The detail pane's shared display atoms and its first three form fields: the
 * header, the name input, the enabled checkbox, and the action dropdown.
 *
 * Every component here is a pure view over the pane's draft: values and change
 * callbacks arrive as props, and no component holds state of its own.
 *
 * 详情面板共享的展示原子与前三个表单字段：头部、名字输入、启用勾选与动作下拉。
 *
 * 这里的组件都是草稿之上的纯视图：取值与变更回调一律由 props 传入，组件自身不持有
 * 状态。
 *
 * @module @veren/startup-autostart/client/detail-fields
 */

import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupItemView } from './remote.ts'
import { STARTUP_ACTIONS } from './remote.ts'
import { SelectMenu } from './select.tsx'
import type { Draft, EditDraft } from './detail-draft.ts'

/** One read-only fact row. */
export function Field(props: { readonly label: string; readonly value: string }): React.ReactElement {
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
export function RequiredMark(props: { readonly t: PropsLocale<'startup.panel'>['t'] }): React.ReactElement {
  return <span className="sa-required" title={props.t('panel.detail.required')}> *</span>
}

/**
 * A required marker plus the localized label text, for the editable fields.
 * 可编辑字段的标签：必填标识 + 本地化文案。
 */
export function FieldLabel(props: {
  readonly required: boolean
  readonly text: string
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return <>{props.text}{props.required && <RequiredMark t={props.t} />}</>
}

/** The pane header: the localized title and the item's id as the hint line. */
export function DetailHeader(props: {
  readonly item: StartupItemView
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <header className="sa-detail-head">
      <h3 className="sa-detail-title">{props.t('panel.detail.title')}</h3>
      <span className="sa-hint">{props.item.id}</span>
    </header>
  )
}

/** The item name: a required, always-editable text input. */
export function NameField(props: {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <div className="sa-field">
      <label className="sa-field-label" htmlFor="sa-name">
        <FieldLabel required text={props.t('panel.detail.field.name')} t={props.t} />
      </label>
      <input id="sa-name" className="sa-field-input" value={props.draft.name}
        onChange={event => { props.edit('name', event.target.value) }} />
    </div>
  )
}

/** The enabled checkbox: the only gate a start consults. */
export function EnabledField(props: {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <Checkbox checked={props.draft.enabled} label={props.t('panel.detail.field.enabled')}
      onChange={next => { props.edit('enabled', next) }} />
  )
}

/** The action dropdown: the choice that reshapes the rest of the form. */
export function ActionField(props: {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  return (
    <div className="sa-field">
      <span className="sa-field-label" id="sa-action-label">{props.t('panel.detail.field.action')}</span>
      <SelectMenu ariaLabel={props.t('panel.detail.field.action')} value={props.draft.action}
        options={STARTUP_ACTIONS.map(action => ({ value: action, label: props.t(`panel.action.${action}`) }))}
        onChange={value => { props.edit('action', value as Draft['action']) }} />
    </div>
  )
}
