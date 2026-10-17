/**
 * The notebook page: an owner selector, a note list, and one editor.
 *
 * The page is a presentation component. It reads one observable through the
 * framework's `useNotebook` seat — synthesized from the inject face's `hooks`
 * compartment — and performs every mutation through the callbacks that face
 * supplies. It never touches `ctx`, never imports a Host service, and holds only
 * view state (the selected note, the draft, and transient feedback).
 *
 * 记事本页面：归属选择器、笔记列表，以及一个编辑器。
 *
 * 页面是展示组件。它通过框架的 `useNotebook` 座位（由注入面的 `hooks` 舱合成）读取一个
 * 可观察对象，所有写入都经注入面提供的回调完成——它不碰 `ctx`、不导入宿主服务，本地只持有
 * 视图状态（选中的笔记、草稿与瞬态反馈）。
 *
 * @module @veren/notebook-ui/client/panel
 */

import { useEffect, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { NotebookSnapshot } from './index.tsx'
import {
  MAX_BODY_CHARS, MAX_TITLE_CHARS, type NoteView,
} from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** Everything the page's inject face supplies: one observable and callbacks. */
export interface NotebookPanelInjected {
  /** The notebook observable, bound as `useNotebook`. */
  readonly hooks: {
    readonly notebook: HostObservable<NotebookSnapshot>
  }
  /** Choose whose notebook is on screen. */
  readonly onSelect: (owner: string) => void
  /** Re-read the owner list and the selected notebook. */
  readonly onRefresh: () => void
  /** Write one note into the selected notebook. */
  readonly onCreate: (input: NewNoteInput) => Promise<NoteView>
  /** Replace fields of one note in the selected notebook. */
  readonly onUpdate: (input: UpdateNoteInput) => Promise<NoteView>
  /** Delete one note from the selected notebook. */
  readonly onRemove: (input: { readonly owner: string; readonly id: string }) => Promise<{ readonly deleted: boolean }>
}

/** The one create payload the editor builds. */
export interface NewNoteInput {
  readonly owner: string
  readonly title: string
  readonly body: string
}

/** The one update payload the editor builds. */
export interface UpdateNoteInput {
  readonly owner: string
  readonly id: string
  readonly title: string
  readonly body: string
  readonly expectedUpdatedAt?: string
}

/** Props of {@link NotebookPanel}, derived from the framework shares. */
export type NotebookPanelProps = PropsRuntime<'main'>
  & InjectFace<NotebookPanelInjected>
  & PropsLocale<'notebook'>

/** One note's editable fields plus the update time the draft was read at. */
interface Draft {
  readonly title: string
  readonly body: string
  readonly updatedAt: string | undefined
}

/** The empty draft shared by "new note" and "nothing selected". */
const EMPTY_DRAFT: Draft = { title: '', body: '', updatedAt: undefined }

/** Everything the page body needs, with the inject face already resolved. */
interface BodyProps {
  readonly state: NotebookSnapshot
  readonly t: (key: NotebookKey) => string
  readonly actions: Omit<NotebookPanelInjected, 'hooks'>
}

/** Render the page shell and resolve the framework seat once. */
export function NotebookPanel(props: NotebookPanelProps) {
  const state = props.useNotebook(snapshot => snapshot)
  return <NotebookBody state={state} t={props.t} actions={props} />
}

/** The page body: it holds the view state, so only it re-renders on selection. */
function NotebookBody(props: BodyProps) {
  const { state, t, actions } = props
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editingNew, setEditingNew] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const openNote = (note: NoteView): void => {
    setSelectedId(note.id)
    setEditingNew(false)
    setDraft({ title: note.title, body: note.body, updatedAt: note.updatedAt })
    setDirty(false)
    setConfirmDelete(false)
    setError('')
  }

  // A different owner means a different notebook: drop the old draft first.
  useEffect(() => {
    setSelectedId(undefined)
    setEditingNew(false)
    setDraft(EMPTY_DRAFT)
    setDirty(false)
    setConfirmDelete(false)
    setError('')
    setNotice('')
  }, [state.owner])

  // Select the first note once a notebook has notes, and follow external edits
  // only while the draft is clean. A dirty draft is the user's, not the poll's.
  useEffect(() => {
    if (editingNew) return
    if (selectedId === undefined) {
      const first = state.notes[0]
      if (first !== undefined) openNote(first)
      return
    }
    const current = state.notes.find(note => note.id === selectedId)
    if (current !== undefined && !dirty && current.updatedAt !== draft.updatedAt) openNote(current)
    // `openNote` is a local setter bundle; the list identity is what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notes, selectedId, editingNew, dirty, draft.updatedAt])

  const startNew = (): void => {
    setEditingNew(true)
    setSelectedId(undefined)
    setDraft(EMPTY_DRAFT)
    setDirty(false)
    setConfirmDelete(false)
    setError('')
    setNotice('')
  }

  const chooseOwner = (owner: string): void => {
    actions.onSelect(owner)
    setSelectedId(undefined)
    setEditingNew(false)
    setDraft(EMPTY_DRAFT)
    setDirty(false)
    setConfirmDelete(false)
    setError('')
    setNotice('')
  }

  const edit = (patch: Partial<Pick<Draft, 'title' | 'body'>>): void => {
    setDraft(current => ({ ...current, ...patch }))
    setDirty(true)
    setConfirmDelete(false)
    setError('')
  }

  const save = async (): Promise<void> => {
    const owner = state.owner
    if (owner === undefined) return
    const title = draft.title.trim()
    if (title === '') {
      setError(t('titleRequired'))
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const note = editingNew
        ? await actions.onCreate({ owner, title, body: draft.body })
        : selectedId === undefined
          ? undefined
          : await actions.onUpdate({
            owner,
            id: selectedId,
            title,
            body: draft.body,
            ...draft.updatedAt === undefined ? {} : { expectedUpdatedAt: draft.updatedAt },
          })
      if (note === undefined) return
      openNote(note)
      setNotice(t('saved'))
      actions.onRefresh()
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const owner = state.owner
    if (owner === undefined || selectedId === undefined) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await actions.onRemove({ owner, id: selectedId })
      setSelectedId(undefined)
      setEditingNew(false)
      setDraft(EMPTY_DRAFT)
      setDirty(false)
      setConfirmDelete(false)
      setNotice(t('deleted'))
      actions.onRefresh()
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const active = editingNew || selectedId !== undefined
  return (
    <div className="notebook-page">
      <header className="notebook-header">
        <div className="notebook-heading">
          <div className="notebook-heading-row">
            <span className="notebook-mark" aria-hidden="true"><NotebookGlyph /></span>
            <h1>{t('panel')}</h1>
          </div>
          <p>{t('panelSubtitle')}</p>
        </div>
        <div className="notebook-actions">
          {state.owners.length > 0 && (
            <label className="notebook-owner" title={t('ownerHint')}>
              <span>{t('owner')}</span>
              <select
                value={state.owner ?? ''}
                aria-label={t('owner')}
                onChange={event => { chooseOwner(event.target.value) }}
              >
                {state.owners.map(owner => (
                  <option key={owner.id} value={owner.id}>
                    {owner.declared ? owner.id : `${owner.id} (${t('removed')})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="notebook-btn" onClick={() => { actions.onRefresh() }}>
            {t('refresh')}
          </button>
          <button
            type="button" className="notebook-btn is-primary"
            disabled={state.owner === undefined || busy}
            onClick={startNew}
          >
            {t('newNote')}
          </button>
        </div>
      </header>

      {state.status === 'error' && (
        <div className="notebook-banner" role="alert">
          <span>{t('failed')}: {state.error}</span>
          <button type="button" className="notebook-btn" onClick={() => { actions.onRefresh() }}>
            {t('retry')}
          </button>
        </div>
      )}

      <div className="notebook-layout">
        <section className="notebook-list" aria-label={t('notes')}>
          <div className="notebook-list-head">
            <span>{t('notes')}</span>
            <span className="notebook-count">{state.notes.length}</span>
          </div>
          {state.notes.length === 0
            ? (
              <div className="notebook-empty">
                <h3>{t('noNotes')}</h3>
                <p>{t('noNotesHint')}</p>
                <button
                  type="button" className="notebook-btn is-primary"
                  disabled={state.owner === undefined || busy}
                  onClick={startNew}
                >
                  {t('newNote')}
                </button>
              </div>
            )
            : (
              <div className="notebook-items">
                {state.notes.map(note => (
                  <button
                    key={note.id}
                    type="button"
                    className="notebook-item"
                    aria-current={note.id === selectedId}
                    onClick={() => { openNote(note) }}
                  >
                    <span className="notebook-item-title">{note.title}</span>
                    {note.body !== '' && <span className="notebook-item-excerpt">{note.body}</span>}
                    <span className="notebook-item-time">{formatTime(note.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
        </section>

        <section className="notebook-editor" aria-label={t('editNote')}>
          {state.owner === undefined
            ? (
              <div className="notebook-empty">
                <h3>{t('noOwners')}</h3>
                <p>{t('ownerHint')}</p>
              </div>
            )
            : !active
              ? (
                <div className="notebook-empty">
                  <h3>{t('emptyTitle')}</h3>
                  <p>{t('emptyBody')}</p>
                </div>
              )
              : (
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
                          disabled={busy} onClick={() => { void remove() }}
                        >
                          {confirmDelete ? t('confirmDelete') : t('delete')}
                        </button>
                      )}
                      <button
                        type="button" className="notebook-btn is-primary"
                        disabled={busy} onClick={() => { void save() }}
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
                        onChange={event => { edit({ title: event.target.value }) }}
                      />
                    </label>
                    <label className="notebook-field is-grow">
                      <span className="notebook-label">{t('body')}</span>
                      <textarea
                        className="notebook-textarea"
                        value={draft.body}
                        maxLength={MAX_BODY_CHARS}
                        placeholder={t('bodyPlaceholder')}
                        onChange={event => { edit({ body: event.target.value }) }}
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
              )}
        </section>
      </div>
    </div>
  )
}

/** Format one ISO instant in the reader's locale, or an empty string. */
function formatTime(value: string | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/** Render one failure as a single line. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

/** The page's own notebook glyph, used in the panel header. */
function NotebookGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 2.5h8v11h-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 9h5M5.5 11h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
