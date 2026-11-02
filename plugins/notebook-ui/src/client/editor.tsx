/**
 * The note editor: title, body, save, delete, and transient feedback.
 *
 * A presentation component with no state of its own. The panel owns the draft
 * and the write lifecycle; this file only renders what the panel hands it.
 *
 * 笔记编辑器：标题、正文、保存、删除与瞬态反馈。
 *
 * 自身不持有状态的展示组件。草稿与写入生命周期由面板持有；本文件只渲染面板交给它的东西。
 *
 * 组合拆分：头部（标题行与动作按钮）在 EditorHead，表单（标题/正文输入与
 * 元信息行）在 EditorForm。
 * Composition split: the header (title row and action buttons) lives in
 * EditorHead, the form (title/body inputs and the meta line) in EditorForm.
 *
 * @module @veren/notebook-ui/client/editor
 */

import { MAX_BODY_CHARS, MAX_TITLE_CHARS } from './remote.ts'
import type { NoteKind } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** One note's editable fields plus the update time the draft was read at. */
export interface Draft {
  readonly title: string
  readonly body: string
  readonly updatedAt: string | undefined
}

/** The empty draft shared by "new note" and "nothing selected". */
export const EMPTY_DRAFT: Draft = { title: '', body: '', updatedAt: undefined }

/** Everything the editor renders and the actions it triggers. */
export interface NoteEditorProps {
  readonly t: (key: NotebookKey) => string
  readonly editingNew: boolean
  /** The open card's kind — a fleeting card gets the promote action. 所开卡的类别——闪念卡获得炼成动作。 */
  readonly kind: NoteKind | undefined
  readonly draft: Draft
  readonly busy: boolean
  readonly dirty: boolean
  readonly error: string
  readonly notice: string
  readonly confirmDelete: boolean
  readonly onEdit: (patch: Partial<Pick<Draft, 'title' | 'body'>>) => void
  readonly onSave: () => void
  readonly onRemove: () => void
  readonly onPromote: () => void
}

/** Props of {@link EditorHead}: the title row and the action buttons. */
interface EditorHeadProps {
  readonly t: (key: NotebookKey) => string
  readonly editingNew: boolean
  readonly kind: NoteKind | undefined
  readonly draft: Draft
  readonly busy: boolean
  readonly confirmDelete: boolean
  readonly onRemove: () => void
  readonly onSave: () => void
  readonly onPromote: () => void
}

/** 炼成按钮：仅闪念卡有。The promote button: fleeting cards only. */
function PromoteButton({ t, busy, onPromote }: {
  readonly t: (key: NotebookKey) => string
  readonly busy: boolean
  readonly onPromote: () => void
}): React.ReactElement {
  return (
    <button type="button" className="notebook-btn is-accent" disabled={busy} onClick={onPromote}>
      {t('promote')}
    </button>
  )
}

/** 删除按钮：两次点击确认。The delete button: two clicks to confirm. */
function DeleteButton({ t, busy, confirmDelete, onRemove }: {
  readonly t: (key: NotebookKey) => string
  readonly busy: boolean
  readonly confirmDelete: boolean
  readonly onRemove: () => void
}): React.ReactElement {
  return (
    <button type="button" className="notebook-btn is-danger" disabled={busy} onClick={onRemove}>
      {confirmDelete ? t('confirmDelete') : t('delete')}
    </button>
  )
}

/** 编辑器头部：标题行与保存/删除/炼成按钮。The editor header: the title row and the save/delete/promote buttons. */
function EditorHead(props: EditorHeadProps): React.ReactElement {
  const { t, editingNew, kind, draft, busy, confirmDelete, onRemove, onSave, onPromote } = props
  return (
    <div className="notebook-editor-head">
      <div>
        <h2>{editingNew ? t('newNote') : t('editNote')}</h2>
        <p>
          {editingNew
            ? t('newNoteHint')
            : `${t('updatedAt')} ${formatTime(draft.updatedAt)}`}
        </p>
      </div>
      <div className="notebook-editor-actions">
        {!editingNew && kind === 'fleeting' && <PromoteButton t={t} busy={busy} onPromote={onPromote} />}
        {!editingNew && <DeleteButton t={t} busy={busy} confirmDelete={confirmDelete} onRemove={onRemove} />}
        <button
          type="button" className="notebook-btn is-primary"
          disabled={busy} onClick={onSave}
        >
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}

/** Props of {@link EditorForm}: the two inputs and the meta line. */
interface EditorFormProps {
  readonly t: (key: NotebookKey) => string
  readonly draft: Draft
  readonly dirty: boolean
  readonly error: string
  readonly notice: string
  readonly onEdit: (patch: Partial<Pick<Draft, 'title' | 'body'>>) => void
}

/** 编辑器表单：标题/正文输入与元信息行。The editor form: the title/body inputs and the meta line. */
function EditorForm(props: EditorFormProps): React.ReactElement {
  const { t, draft, dirty, error, notice, onEdit } = props
  return (
    <div className="notebook-form">
      <label className="notebook-field">
        <span className="notebook-label">{t('title')}</span>
        <input className="notebook-input" value={draft.title} maxLength={MAX_TITLE_CHARS}
          placeholder={t('titlePlaceholder')} onChange={event => { onEdit({ title: event.target.value }) }} />
      </label>
      <label className="notebook-field is-grow">
        <span className="notebook-label">{t('body')}</span>
        <textarea className="notebook-textarea" value={draft.body} maxLength={MAX_BODY_CHARS}
          placeholder={t('bodyPlaceholder')} onChange={event => { onEdit({ body: event.target.value }) }} />
      </label>
      <div className="notebook-meta">
        <span>{draft.body.length} / {MAX_BODY_CHARS}</span>
        {dirty && <span>{t('unsaved')}</span>}
        {notice !== '' && <span className="notebook-notice">{notice}</span>}
        {error !== '' && <span className="notebook-error">{error}</span>}
      </div>
    </div>
  )
}

/** Render one note's editor. */
export function NoteEditor(props: NoteEditorProps) {
  const { t, editingNew, kind, draft, busy, dirty, error, notice, confirmDelete } = props
  return (
    <>
      <EditorHead t={t} editingNew={editingNew} kind={kind} draft={draft} busy={busy} confirmDelete={confirmDelete}
        onRemove={props.onRemove} onSave={props.onSave} onPromote={props.onPromote} />
      <EditorForm t={t} draft={draft} dirty={dirty} error={error} notice={notice} onEdit={props.onEdit} />
    </>
  )
}

/** Format one ISO instant in the reader's locale, or an empty string. */
export function formatTime(value: string | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
