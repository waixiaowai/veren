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
 * @module @veren/notebook-ui/client/editor
 */

import { MAX_BODY_CHARS, MAX_TITLE_CHARS } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** One note's editable fields plus the update time the draft was read at. */
export interface Draft {
  readonly title: string
  readonly body: string
  readonly updatedAt: string | undefined
}

/** The empty draft shared by "new note" and "nothing selected". */
export const EMPTY_DRAFT: Draft = { title: '', body: '', updatedAt: undefined }

/** Everything the editor renders and the two actions it triggers. */
export interface NoteEditorProps {
  readonly t: (key: NotebookKey) => string
  readonly editingNew: boolean
  readonly draft: Draft
  readonly busy: boolean
  readonly dirty: boolean
  readonly error: string
  readonly notice: string
  readonly confirmDelete: boolean
  readonly onEdit: (patch: Partial<Pick<Draft, 'title' | 'body'>>) => void
  readonly onSave: () => void
  readonly onRemove: () => void
}

/** Render one note's editor. */
export function NoteEditor(props: NoteEditorProps) {
  const { t, editingNew, draft, busy, dirty, error, notice, confirmDelete } = props
  return (
    <>
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
          {!editingNew && (
            <button
              type="button" className="notebook-btn is-danger"
              disabled={busy} onClick={props.onRemove}
            >
              {confirmDelete ? t('confirmDelete') : t('delete')}
            </button>
          )}
          <button
            type="button" className="notebook-btn is-primary"
            disabled={busy} onClick={props.onSave}
          >
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </div>
      <div className="notebook-form">
        <label className="notebook-field">
          <span className="notebook-label">{t('title')}</span>
          <input
            className="notebook-input"
            value={draft.title}
            maxLength={MAX_TITLE_CHARS}
            placeholder={t('titlePlaceholder')}
            onChange={event => { props.onEdit({ title: event.target.value }) }}
          />
        </label>
        <label className="notebook-field is-grow">
          <span className="notebook-label">{t('body')}</span>
          <textarea
            className="notebook-textarea"
            value={draft.body}
            maxLength={MAX_BODY_CHARS}
            placeholder={t('bodyPlaceholder')}
            onChange={event => { props.onEdit({ body: event.target.value }) }}
          />
        </label>
        <div className="notebook-meta">
          <span>{draft.body.length} / {MAX_BODY_CHARS}</span>
          {dirty && <span>{t('unsaved')}</span>}
          {notice !== '' && <span className="notebook-notice">{notice}</span>}
          {error !== '' && <span className="notebook-error">{error}</span>}
        </div>
      </div>
    </>
  )
}

/** Format one ISO instant in the reader's locale, or an empty string. */
export function formatTime(value: string | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
