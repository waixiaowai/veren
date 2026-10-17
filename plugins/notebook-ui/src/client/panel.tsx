/**
 * The notebook page: an owner selector, a note list, and one editor.
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`.
 *
 * 记事本页面：归属选择器、笔记列表与一个编辑器。
 *
 * 由可观察对象和注入面回调驱动的展示组件；只持有视图状态，不碰 `ctx`。
 *
 * @module @veren/notebook-ui/client/panel
 */

import { useEffect, useRef, useState } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { EMPTY_DRAFT, NoteEditor, type Draft } from './editor.tsx'
import { NoteList } from './note-list.tsx'
import type {
  NoteView, NotebookPanelInjected, NotebookSnapshot,
} from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** Props of {@link NotebookPanel}, derived from the framework shares. */
export type NotebookPanelProps = PropsRuntime<'main'>
  & InjectFace<NotebookPanelInjected>
  & PropsLocale<'notebook'>

/** Everything the page body needs, with the inject face already resolved. */interface BodyProps {
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
  /** The note this page just deleted, until the refreshed list drops it. */
  const deleted = useRef<string | undefined>(undefined)
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
    if (current === undefined) {
      // A note this page deleted disappears from the refreshed list; pick the next one.
      if (deleted.current !== undefined && !state.notes.some(note => note.id === deleted.current)) {
        deleted.current = undefined
        setNotice('')
        const first = state.notes[0]
        if (first !== undefined) openNote(first)
        else {
          setSelectedId(undefined)
          setEditingNew(false)
          setDraft(EMPTY_DRAFT)
          setDirty(false)
        }
      }
      return
    }
    if (!dirty && current.updatedAt !== draft.updatedAt) openNote(current)
  }, [state.notes, selectedId, editingNew, dirty, draft.updatedAt])
  const startNew = (): void => {
    deleted.current = undefined
    setEditingNew(true)
    setSelectedId(undefined)
    setDraft(EMPTY_DRAFT)
    setDirty(false)
    setConfirmDelete(false)
    setError('')
    setNotice('')
  }
  const chooseOwner = (owner: string): void => {
    deleted.current = undefined
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
    const id = selectedId
    if (owner === undefined || id === undefined) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await actions.onRemove({ owner, id })
      deleted.current = id
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
        <NoteList
          t={t}
          notes={state.notes}
          selectedId={selectedId}
          busy={busy}
          canCreate={state.owner !== undefined}
          onOpen={(note) => { deleted.current = undefined; openNote(note) }}
          onCreate={startNew}
        />

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
                <NoteEditor
                  t={t}
                  editingNew={editingNew}
                  draft={draft}
                  busy={busy}
                  dirty={dirty}
                  error={error}
                  notice={notice}
                  confirmDelete={confirmDelete}
                  onEdit={edit}
                  onSave={() => { void save() }}
                  onRemove={() => { void remove() }}
                />
              )}
        </section>
      </div>
    </div>
  )
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
