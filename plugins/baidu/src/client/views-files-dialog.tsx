/**
 * 文件页签的表单弹层（§11.6 的表单形态）：通用字段表单弹层 + 删除确认弹层
 * 的宿主。表单字段全部是已格式化的文案与值；提交回调由文件视图接线。
 * The files tab's form dialogs (§11.6's form shape): the generic field-form
 * dialog plus the delete-confirm dialog host. Form fields are pre-formatted
 * copy and values; the submit callbacks are wired by the files view.
 *
 * @module @veren/baidu-pan/client/views-files-dialog
 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ConfirmDialog } from './composites.tsx'

/** 表单字段（type: text/password；select 带闭集选项）。One form field (text/password; select with a closed option set). */
export interface FormField {
  readonly key: string
  readonly label: string
  readonly placeholder?: string
  readonly type?: 'text' | 'password'
  readonly select?: readonly { readonly value: string; readonly label: string }[]
  readonly value?: string
}

/** 弹层（闭集）：无 / 通用表单 / 删除确认。The dialog (closed set): none / generic form / delete confirm. */
export type FilesDialog =
  | { readonly kind: 'none' }
  | {
    readonly kind: 'form'
    readonly title: string
    readonly fields: readonly FormField[]
    readonly confirmLabel: string
    readonly cancelLabel: string
    readonly busyLabel: string
    readonly onSubmit: (values: Record<string, string>) => Promise<void>
  }
  | { readonly kind: 'delete'; readonly paths: readonly string[]; readonly confirmLabel: string; readonly cancelLabel: string; readonly consequence: string; readonly busyLabel: string; readonly onConfirm: () => Promise<void> }

/** 弹层宿主：按种类渲染确认或表单。The dialog host: renders the confirm or the form by kind. */
export function DialogHost(props: { readonly dialog: FilesDialog; readonly onClose: () => void }): JSX.Element {
  if (props.dialog.kind === 'none') return <div className="bdp-none" />
  if (props.dialog.kind === 'delete') return <DeleteConfirm dialog={props.dialog} onClose={props.onClose} />
  return <FormDialog dialog={props.dialog} onClose={props.onClose} />
}

/** 删除确认：对象清单 + 后果，确认即执行。The delete confirm: object list + consequence; confirming executes. */
function DeleteConfirm(props: {
  readonly dialog: Extract<FilesDialog, { readonly kind: 'delete' }>
  readonly onClose: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    await props.dialog.onConfirm()
    setBusy(false)
  }
  return (
    <ConfirmDialog question={props.dialog.confirmLabel} objects={props.dialog.paths.map(path => ({ text: path, kind: 'path' }))}
      consequence={props.dialog.consequence} confirmLabel={props.dialog.busyLabel}
      cancelLabel={props.dialog.cancelLabel} busy={busy}
      onConfirm={() => { void run() }} onCancel={props.onClose} />
  )
}

/** 字段初值表。The fields' initial value map. */
function initialValues(fields: readonly FormField[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) values[field.key] = field.value ?? ''
  return values
}

/** 通用表单弹层：字段渲染 + 提交中原地切换文案。The generic form dialog: field rendering plus pending-copy swap in place. */
function FormDialog(props: {
  readonly dialog: Extract<FilesDialog, { readonly kind: 'form' }>
  readonly onClose: () => void
}): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(props.dialog.fields))
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => { globalThis.removeEventListener('keydown', onKey) }
  }, [props])
  const submit = async (): Promise<void> => {
    setBusy(true)
    await props.dialog.onSubmit(values)
    setBusy(false)
  }
  return (
    <div className="bdp-dialog-backdrop" role="presentation">
      <div className="bdp-dialog" role="dialog" aria-modal="true" aria-label={props.dialog.title}>
        <p className="bdp-dialog-question">{props.dialog.title}</p>
        <FormFields fields={props.dialog.fields} values={values} busy={busy} onChange={setValues} />
        <FormActionsRow cancelRef={cancelRef} busy={busy} cancelLabel={props.dialog.cancelLabel}
          confirmLabel={props.dialog.confirmLabel} busyLabel={props.dialog.busyLabel}
          onClose={props.onClose} onSubmit={() => { void submit() }} />
      </div>
    </div>
  )
}

/** 表单动作行：取消在左、执行在右，提交中原地切换文案（设计 §11.9）。The form's action row: Cancel left, execute right, pending copy swaps in place (design §11.9). */
function FormActionsRow(props: {
  readonly cancelRef: React.RefObject<HTMLButtonElement | null>
  readonly busy: boolean
  readonly cancelLabel: string
  readonly confirmLabel: string
  readonly busyLabel: string
  readonly onClose: () => void
  readonly onSubmit: () => void
}): JSX.Element {
  return (
    <div className="bdp-dialog-actions">
      <button type="button" ref={props.cancelRef} className="bdp-button" disabled={props.busy} onClick={props.onClose}>{props.cancelLabel}</button>
      <button type="button" className="bdp-button bdp-button-primary" disabled={props.busy} onClick={props.onSubmit}>
        {props.busy ? props.busyLabel : props.confirmLabel}
      </button>
    </div>
  )
}

/** 弹层字段组（标签 + 输入）。The dialog's field group (labels + inputs). */
function FormFields(props: {
  readonly fields: readonly FormField[]
  readonly values: Record<string, string>
  readonly busy: boolean
  readonly onChange: (values: Record<string, string>) => void
}): JSX.Element {
  return (
    <>
      {props.fields.map(field => (
        <label key={field.key} className="bdp-form-label">
          <span>{field.label}</span>
          <FieldInput field={field} value={props.values[field.key] ?? ''} busy={props.busy}
            onChange={next => { props.onChange({ ...props.values, [field.key]: next }) }} />
        </label>
      ))}
    </>
  )
}

/** 单个字段输入（text/password/select）。One field input (text/password/select). */
function FieldInput(props: {
  readonly field: FormField
  readonly value: string
  readonly busy: boolean
  readonly onChange: (next: string) => void
}): JSX.Element {
  if (props.field.select !== undefined) {
    return (
      <select className="bdp-input" disabled={props.busy} value={props.value} onChange={event => { props.onChange(event.target.value) }}>
        {props.field.select.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    )
  }
  return (
    <input className="bdp-input" type={props.field.type ?? 'text'} autoComplete="off" disabled={props.busy}
      placeholder={props.field.placeholder} value={props.value} onChange={event => { props.onChange(event.target.value) }} />
  )
}
